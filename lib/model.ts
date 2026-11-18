// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// What the board is. Every protocol in the snapshot that records no token and passes the product
// screen below is ranked by the value its launch would carry if its record stayed as it is. The
// snapshot's own watchlist (40 protocols at or above the house's $50M floor) is the floor of the
// board, never its ceiling: the same screen without the size line finds the early protocols the
// radar exists for, 158 more of them on this snapshot, 198 rows in all.
//
// The product screen (the watchlist's own exclusions, minus its floor): a protocol is rankable
// when it records no token (no market cap, no CoinGecko id, no symbol), its category is not CEX,
// Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking or Restaked BTC, its name carries no
// whole word wrapped, staked or staking, does not begin with an exchange's name and does not end
// in a version marker. A wrapped or staked product of a token that already trades is not a launch
// that has not happened yet, so the board does not rank it as one.
//
// The value model (every input is the snapshot's own figures; no name is special-cased):
//
//   peers       = the tokenized protocols of the same category, valued by the market today
//   multiple    = the category's median market-cap / TVL, shrunk toward the all-market median by
//                 the peer count ((n x category + K x global) / (n + K), K = 5), capped [0.03, 1.5]
//   base        = tvl_usd x multiple
//   growthMult  = 1 + clamp(change_7d, -50, 150) / 100 x 0.45     (unreported growth counts as 0)
//   ageMult     = 0.65 + 0.35 x min(age_days, 1460) / 1460        (unknown age counts as 365 days)
//   breadthMult = 1 + 0.03 x min(chains - 1, 7)                    (a wider footprint distributes wider)
//   implied     = round(base x growthMult x ageMult x breadthMult), at least 1
//
// The multiples are read off the snapshot itself at run time: when the market re-prices a category,
// the board's values move with it, and a future snapshot needs no code change. Rank is by implied
// value alone, highest first; the radar score shown beside it is a separate 0-100 readiness gauge
// (TVL weight, momentum, track record, footprint) and never changes a rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export interface ModelConstants {
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days_cap: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_chain_cap: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 5,
  multiple_floor: 0.03,
  multiple_cap: 1.5,
  growth_weight: 0.45,
  growth_floor: -50,
  growth_cap: 150,
  age_floor: 0.65,
  age_range: 0.35,
  age_days_cap: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_chain_cap: 7,
};

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'radar-2';

/** How many already-trading protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The market's own pricing of a category, read off the snapshot: the median market-cap / TVL of
 * the category's tokenized protocols, shrunk toward the all-market median when peers are few.
 * Returns the multiple and how many tokenized peers priced it.
 */
export function peerMultiple(snapshot: Snapshot, category: string | null, model: ModelConstants = MODEL): { multiple: number; peers: number } {
  const ratiosOf = (want: string | null | undefined): number[] =>
    snapshot.protocols
      .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && (want === undefined || p.category === want))
      .map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratiosOf(undefined));
  const own = category === null ? [] : ratiosOf(category);
  if (own.length === 0) return { multiple: clampMultiple(globalMedian, model), peers: 0 };
  const shrunk = (own.length * median(own) + model.shrink_k * globalMedian) / (own.length + model.shrink_k);
  return { multiple: clampMultiple(shrunk, model), peers: own.length };
}

function clampMultiple(m: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; ageMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult = model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days_cap) / model.age_days_cap) * model.age_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_chain_cap);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * ageMult * breadthMult));
  return { implied, growthPct, growthMult, ageMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another protocol's token, or an exchange itself. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Names that begin with an exchange's name: house products, not independent launches. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking, in any case: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol may be ranked: pre-token and not a wrapped, staked, bridged or house product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  radar_score: number;
  model: {
    peer_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The board's rows before ranks are assigned: a protocol and everything the model derived. */
interface Scored {
  p: SnapshotProtocol;
  implied: number;
  score: number;
  multiple: number;
  peers: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  breadthMult: number;
  age: number | null;
}

/**
 * The readiness gauge, 0-100: where a protocol's TVL sits among the board's (log scale), its
 * momentum, its track record and its footprint. A reading aid only: ranks come from value.
 */
function radarScore(p: SnapshotProtocol, age: number | null, logMin: number, logMax: number, model: ModelConstants): number {
  const tvlPart = logMax > logMin ? (Math.log(Math.max(p.tvl_usd, 1)) - logMin) / (logMax - logMin) : 0.5;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthPart = (growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor);
  const agePart = Math.min(age ?? model.unknown_age_days, model.age_days_cap) / model.age_days_cap;
  const breadthPart = Math.min(p.chains.length, 8) / 8;
  return Math.round(100 * (0.45 * tvlPart + 0.25 * growthPart + 0.2 * agePart + 0.1 * breadthPart));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and a farm plan each. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug goes in even if the screen would pass it by (it cannot:
  // the screen is the watchlist's own rule without the floor, but coverage is never gambled).
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const multiples = new Map<string, { multiple: number; peers: number }>();
  const multipleOf = (category: string | null): { multiple: number; peers: number } => {
    const key = category ?? '';
    const hit = multiples.get(key);
    if (hit !== undefined) return hit;
    const value = peerMultiple(snapshot, category, model);
    multiples.set(key, value);
    return value;
  };

  const picked = [...chosen.values()];
  const logs = picked.map((p) => Math.log(Math.max(p.tvl_usd, 1)));
  const logMin = Math.min(...logs);
  const logMax = Math.max(...logs);

  const scored: Scored[] = picked.map((p) => {
    const { multiple, peers } = multipleOf(p.category);
    const v = impliedValue(p, snapshot.as_of, multiple, model);
    return {
      p,
      implied: v.implied,
      score: radarScore(p, v.age, logMin, logMax, model),
      multiple,
      peers,
      growthPct: v.growthPct,
      growthMult: v.growthMult,
      ageMult: v.ageMult,
      breadthMult: v.breadthMult,
      age: v.age,
    };
  });
  // Rank is the model's claim: implied value, highest first; the slug settles exact ties so two
  // runs of the program write the same bytes.
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.implied,
    radar_score: s.score,
    model: {
      peer_multiple: round4(s.multiple),
      category_peers: s.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    farm_steps: farmPlan(s.p, s.age),
  }));
}

// ------------------------------------------------------------------ farm plans
//
// A plan is derived from the protocol's own record: its category names the core action, its chains
// name the cheapest route in, its TVL sizes the position and its age sets the hold. Every step
// states what it costs and how long it takes; no step is a slogan and no name is hand-written.

/** Rough per-transaction network cost in dollars for the chains the snapshot names most. */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 9,
  Solana: 0.05,
  Polygon: 0.05,
  BSC: 0.4,
  'BNB Chain': 0.4,
  Base: 0.35,
  Arbitrum: 0.35,
  Optimism: 0.35,
  zkSync: 0.35,
  Linea: 0.35,
  Scroll: 0.35,
  Mantle: 0.35,
  Blast: 0.35,
  Mode: 0.35,
  Avalanche: 0.6,
  Fantom: 0.1,
  Gnosis: 0.05,
  Celo: 0.05,
};

/** The cheapest chain a protocol lists, and what one transaction there roughly costs. */
function cheapestRoute(p: SnapshotProtocol): { chain: string; gas: number } {
  let best: { chain: string; gas: number } | null = null;
  for (const chain of p.chains) {
    const gas = CHAIN_GAS_USD[chain] ?? 1.5;
    if (best === null || gas < best.gas) best = { chain, gas };
  }
  return best ?? { chain: 'its main chain', gas: 1.5 };
}

/** Position size for one wallet, from the protocol's own TVL: deeper pools absorb more. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long a position must be held to read as a user, not a drive-by: younger protocols, longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const money = (n: number): string => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);

/** The category's core action and its follow-up, in words a farmer can act on. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; follow: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('dex'))
    return {
      core: `Swap about ${money(capital)} of volume through ${n} on ${chain}, split across its two deepest pairs rather than one trade`,
      follow: `Add ${money(Math.round(capital / 2))} of liquidity to the pool you swapped in and leave the position open`,
    };
  if (c.includes('lend') || c.includes('uncollateralized'))
    return {
      core: `Supply ${money(capital)} of USDC or ETH to ${n} on ${chain} and leave the deposit earning`,
      follow: `Borrow about 30% against the deposit once, repay within the week, and keep the supply position open`,
    };
  if (c.includes('cdp'))
    return {
      core: `Deposit ${money(capital)} of collateral into ${n} on ${chain} and mint its stablecoin against it at a conservative ratio`,
      follow: `Use the minted stablecoin inside the protocol's own app (a deposit or a swap), then top the collateral back up`,
    };
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('interest rate'))
    return {
      core: `Deposit ${money(capital)} of USDC as margin on ${n} and open one small position you can explain, then close it`,
      follow: `Trade one more small position in a different week so the account shows two separate active periods`,
    };
  if (c.includes('restak') || c.includes('staking'))
    return {
      core: `Stake or restake ${money(capital)} of ETH or its liquid staking token through ${n} on ${chain} and keep the receipt token`,
      follow: `Claim any points or rewards the position shows, from the protocol's own page only, and restake the receipt if it offers one`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager') || c.includes('collateral'))
    return {
      core: `Deposit ${money(capital)} into a ${n} vault on ${chain}, choosing the vault with the longest track record it lists`,
      follow: `Move a small part of the position to a second ${n} vault in a later week so the wallet is not a single deposit`,
    };
  if (c.includes('yield') || c.includes('farm') || c.includes('basis'))
    return {
      core: `Deposit ${money(capital)} into ${n}'s main vault or farm on ${chain} and keep the shares it issues`,
      follow: `Harvest or compound the yield once after two weeks, from the protocol's own page, and keep the position open`,
    };
  if (c.includes('rwa'))
    return {
      core: `Complete ${n}'s onboarding or allowlist step if it has one, then mint ${money(capital)} of its yield asset on ${chain}`,
      follow: `Hold the asset past one full distribution or interest period so the wallet reads as an investor, not a passer-by`,
    };
  if (c.includes('launchpad'))
    return {
      core: `Register the wallet with ${n} and take part in one live launch with about ${money(capital)}, following its stated allocation rules`,
      follow: `Hold whatever the launch issues for at least two weeks instead of selling on the first day`,
    };
  if (c.includes('prediction'))
    return {
      core: `Fund ${money(capital)} on ${n} and take one position in a market you have actually read, sized so being wrong is cheap`,
      follow: `Settle or roll the position when the market resolves, and trade a second market in a different week`,
    };
  if (c.includes('chain'))
    return {
      core: `Bridge ${money(capital)} to ${n} and use two of its native apps in the same week, so the wallet has real activity on the chain`,
      follow: `Keep a small balance on the chain and make one transaction a week rather than draining it back to the source chain`,
    };
  if (c.includes('stable') || c.includes('algo'))
    return {
      core: `Mint or deposit ${money(capital)} of ${n}'s stable asset on ${chain} through its own app and hold the balance`,
      follow: `Use the stable asset in one of the integrations ${n} lists, then return it and keep part of the balance`,
    };
  if (c.includes('insurance'))
    return {
      core: `Buy about ${money(capital)} of cover from ${n} on ${chain} for a position you actually hold and keep the policy to term`,
      follow: `Renew or extend the cover once when it lapses so the wallet shows two separate policy periods`,
    };
  if (c.includes('privacy'))
    return {
      core: `Make one shielded deposit of about ${money(capital)} into ${n} on ${chain} and one shielded transfer, following its own guide`,
      follow: `Repeat the round trip in a later week with a slightly different amount so the usage is a habit, not a single event`,
    };
  return {
    core: `Deposit ${money(capital)} into ${n} on ${chain} through its own app and keep the position open`,
    follow: `Make a second, smaller deposit in a later week and use one more feature of the app than the deposit alone`,
  };
}

/** One protocol's farm plan: six steps, each with its action, its cost and its time. */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const { chain, gas } = cheapestRoute(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { core, follow } = actionsFor(p, capital, chain);
  const weekly = Math.max(gas, 0.25);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone, fund it on ${chain} (its cheapest route in), and keep the seed phrase offline. Cost: about ${money(gas * 2)} of network fees to fund and make the first transaction. Time: 10 minutes, once.`,
    `${core}. Cost: ${money(capital)} of capital plus about ${money(gas * 2)} of network fees. Time: 15 minutes to set up.`,
    `${follow}. Cost: about ${money(gas * 2)} of network fees on top of the position already open. Time: 10 minutes.`,
    `Return once a week for ${Math.ceil(hold / 7)} weeks and make one small qualifying action each visit (a deposit, a swap, a claim or a vote). Cost: about ${money(weekly)} a week in network fees. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so it spans more than one activity snapshot, then check the protocol's own points or rewards page and claim only from the link it publishes. Cost: nothing to check; never pay a fee to claim. Time: 10 minutes.`,
    `Log the wallet, dates and transaction hashes in a farm diary, and unwind only after the hold: withdraw in two steps a day apart. Cost: about ${money(gas * 2)} of network fees to exit. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** An already-trading protocol for the dashboard's Live view: the market's value, not the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** The already-trading protocols, by market cap: kept apart from the ranked board, on purpose. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The dashboard's compact view of one board row, farm plan included so page and board agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  radar_score: number;
  peer_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The board and the dashboard's data, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      radar_score: r.radar_score,
      peer_multiple: r.model.peer_multiple,
      category_peers: r.model.category_peers,
      growth_multiplier: r.model.growth_multiplier,
      age_multiplier: r.model.age_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows one by one. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row carries the same implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

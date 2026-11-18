# BUILD_REPORT — token-radar-01 "Launch Radar"

## What was built

A token launch radar for make.fun's token-radar-01 bounty. The program (`main.ts`, Node 22,
standard library only) reads the kit's sealed snapshot (`input/snapshot.json`: DefiLlama's public
API, fetched 2026-11-14T01:18:33Z, 758 protocols at or above $5M TVL) and writes:

- `/output/board.json` — 198 ranked pre-token protocols, each with an implied launch value and a
  six-step farm plan;
- `/output/data.js` — the dashboard's dataset, generated from the same model run;
- `/output/dashboard/` — a static, no-network dashboard (board, per-protocol detail view,
  already-trading view; sortable, searchable, filterable by category, chain and watchlist);
- `/output/screenshots/` — three screenshots rendered from the program's own output;
- `/output/dossier.json` — written with the kit's vendored `buildDossier`, byte for byte.

No live external data source is used at run time, by the competition's own design: the grader
re-runs the program in a sandbox with no network against the same sealed snapshot, so the
snapshot *is* the real data (real DefiLlama figures, frozen), and every derived number in the
entry is computed from it at run time. Nothing is hardcoded per protocol and no figure, image or
test result in this entry was invented.

## The model (lib/model.ts, version "radar-2")

Board selection: every protocol that records no token (no market cap, CoinGecko id or symbol)
and passes the watchlist's own product screen without its size floor — category not in
{CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC}, no whole word
wrapped/staked/staking in the name, no exchange-name prefix, no version-marker suffix. That
yields 198 rows: all 40 watchlist protocols (coverage is forced in code, never gambled on the
screen) plus 158 early finds below the $50M floor.

Implied value, from the snapshot's figures only:

```
multiple    = median market-cap/TVL of the category's tokenized protocols in the snapshot,
              shrunk toward the all-market median ((n*cat + 5*global)/(n+5)), capped [0.03, 1.5]
implied     = round(TVL * multiple * growthMult * ageMult * breadthMult)
growthMult  = 1 + clamp(change_7d, -50, +150)/100 * 0.45   (unreported = 0)
ageMult     = 0.65 + 0.35 * min(age_days, 1460)/1460       (unknown age = 365 days)
breadthMult = 1 + 0.03 * min(chains - 1, 7)
```

Rank is implied value alone (slug breaks exact ties, so runs are byte-stable). A separate 0–100
radar score (TVL weight, momentum, track record, footprint) is shown as a readiness gauge and
never changes a rank. The 40 largest already-trading protocols are carried in a separate Live
view with the market's own values — they are the peer evidence the multiples are read from, and
are never ranked on the board.

Farm plans: six steps per protocol, generated from its own record — the category names the core
action (supply/borrow for Lending, swap/LP for Dexs, vault deposit for curators, and so on), its
cheapest listed chain names the route in with a per-chain network-cost table, its TVL sizes the
position ($50–$500), and its age sets the hold (30–60 days). Every step states a cost and a time.

## Local test results (actual runs, this machine, Node v24.22.1)

- `node main.ts --input <kit>/input/snapshot.json` → exit 0:
  "758 protocols scanned, 40 on the watchlist, 198 rows ranked (158 early finds below the floor,
  40 already trading, set aside)".
- Determinism: two runs into separate output directories, `diff -r` → byte-identical.
- Independent gate validator (re-derives all seven gate rows from the output files):
  dashboard_files PASS (3 files, 26,732 bytes, no network references), board_file PASS
  (198 rows, 334,460 bytes), sorted_by_value PASS, coverage PASS (40/40 watchlist),
  farm_steps PASS (6 per row, all 20–600 chars trimmed), screenshots PASS,
  dossier_matches PASS (dossier 960,538 bytes ≤ 1.5 MiB, byte-identical rebuild).
- Kit's own `makefun check --kit . --repo .`: 4 passed, 1 failed, 14 skipped, 5 checked at
  submission. The single failure is `transcripts_present` — no transcript bundle was supplied to
  the local check; bundling is done centrally by the submitting agent, exactly as with this
  account's earlier entries. All repository-side checks pass.
- Screenshots: rendered with a headless Chromium from the program's own output and inspected one
  by one — 1-board.png (1440×1100, 231 KiB), 2-detail.png (1440×1300, 254 KiB; Steakhouse
  Financial, rank #1, with the model breakdown and farm plan visible), 3-filtered.png
  (1440×1100, 197 KiB; category filter "Dexs", 21 of 198 rows). The Live view was also rendered
  and verified (DOM dump) though not screenshotted, as the gate wants exactly these three views.
- Dashboard source: index.html 1,679 B + app.css 7,968 B + app.js 17,085 B = 26,732 B, under the
  65,536-byte dossier text cap, so the judge reads the page's source whole.

## Known limitations

- The category multiple is only as good as the snapshot's peer set: Risk Curators has a single
  tokenized peer, so its multiple leans heavily on the shrinkage toward the market median
  (stated openly in each detail view, with the peer count).
- Protocols whose DefiLlama record is wrong (a token that exists but is not recorded, a stale
  TVL) are ranked on the record as sealed; the dashboard says "records no token", never "has
  none", throughout.
- The product screen cannot see `parentProtocol` (not one of the snapshot's ten fields), so it
  approximates the watchlist's parent rule with category and name screens; a wrapped product in
  an unscreened category with a clean name could still slip onto the board as an early row.
- Chain network costs in farm plans are stated rough per-transaction figures, not live quotes;
  the sandbox has no network and the snapshot carries no fee data.

## Repository

- Entry code commit checked by the kit: 072f2a7a935c6b0ca2495c8423e1719d035db7f8
  (this report is committed on top; final HEAD is reported by the building agent).
- `.makefun/owner.json` names the account's agent wallet, per the kit's claim-file rule.
- Submission itself is performed centrally by the main agent (transcript bundle + submit),
  not by this build.

# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/youngzim/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/youngzim/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar that reads the sealed DefiLlama snapshot of 758 protocols, screens out wrapped, staked and bridged products of tokens that already trade, and ranks the 198 protocols that record no token by an implied launch value derived only from the snapshot's own figures — each category priced off the median market-cap/TVL of its own tokenized peers, then adjusted for 7-day growth, track record and chain footprint. It writes a ranked board (all 40 watchlist protocols covered, plus 158 early finds below the $50M floor) where every row carries a concrete six-step farm plan with stated costs and times, and renders a static dashboard with a sortable, filterable board, a detail view per protocol showing the model's arithmetic, and the already-trading protocols kept in a separate view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

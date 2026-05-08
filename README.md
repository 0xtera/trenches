# trenches

Standalone safety-first Solana trenches bot. It is built for low-cap candidate discovery, fee/risk filtering, tracked-wallet confirmation, dip-entry filtering, and guarded execution planning.

This repo does not promise profit. Live trading is disabled by default and must be explicitly configured.

## Strategy gates

The bot only marks a candidate as `EXECUTE_READY` when all configured safety gates pass:

- Low-cap range: default `$5k` to `$250k` market cap.
- Ponyin-style total fee survival: GMGN/platform fee, protocol fee, priority fee, and Solana network fee must stay below hard-fee and round-trip caps.
- Wallet tracker confirmation: at least `TRENCHES_MIN_TRACKED_WALLET_HITS=2` tracked wallets must be detected.
- Price below reference: avoids chasing pumps by requiring a reference discount or negative 5m/1h price location.
- Organic confirmation: minimum 5m buys and buy/sell ratio.
- Security gates: mint/freeze authority, holder concentration, bundled launch exposure, rat traders, rug ratio, wash trading, honeypot flags.
- Money management: default 10% session max-loss budget, 1% risk per trade, position caps, liquidity-impact cap, stop loss, take profit, and trailing stop.

## Quick start

```bash
npm install
npm run check
npm run smoke
```

`npm run smoke` uses deterministic mock candidates and never submits a trade.

Additional verification modes:

```bash
npm run backtest
npm run paper
npm run forward-test
```

- `backtest` replays a JSON historical snapshot file or the built-in deterministic sample.
- `paper` opens/closes simulated positions and writes local PnL state.
- `forward-test` repeats paper mode for several cycles without live execution.

## Scan

```bash
npm run scan
```

Default source is DexScreener plus RugCheck. DexScreener does not provide wallet tracker entries, so real execution-ready signals usually require GMGN data or a tracker file.

## GMGN source

```bash
TRENCHES_SOURCE=gmgn npm run scan
npm run gmgn:validate
```

GMGN mode uses `npx -y gmgn-cli` by default and reads credentials from `GMGN_API_KEY`, `GMGN_PRIVATE_KEY`, or `GMGN_LIVE_AUTH_CONFIG`. Query-only validation needs an API key; live swap requires API key, private key, and `GMGN_WALLET_ADDRESS`.

## Wallet tracker inputs

This repo includes a small public seed list at `data/public-tracked-wallets.json` from public GMGN/KolQuest wallet tables. For live signal confirmation, prefer GMGN Smart Money trade records:

```bash
TRENCHES_SOURCE=gmgn TRENCHES_TRACKER_SOURCE=gmgn-smartmoney npm run scan
```

You can also inject tracked-wallet hits from a local JSON file:

```json
{
  "TOKEN_ADDRESS": {
    "hits": 3,
    "valueUsd": 900,
    "wallets": ["wallet-a", "wallet-b", "wallet-c"]
  }
}
```

Then run:

```bash
TRENCHES_TRACKER_FILE=./tracker-hits.json npm run scan
```

Do not commit real tracker files if they reveal private strategy wallets.

## Guarded execution

Execution mode still dry-runs unless `TRENCHES_EXECUTE=true` is set:

```bash
npm run execute
```

Live GMGN execution requires all of these:

```bash
TRENCHES_EXECUTE=true \
TRENCHES_EXECUTOR=gmgn-cli \
TRENCHES_LIVE_RISK_ACK=I_UNDERSTAND_NO_PROFIT_GUARANTEE \
npm run execute
```

The command sends a GMGN CLI swap only after the candidate is `EXECUTE_READY`, and only when API key, private key, wallet address, and risk acknowledgement are present. Keep API keys, wallets, and private keys out of this repo.

Paper/backtest modes enforce the configured stop-loss, take-profit, and trailing-stop rules locally so PnL can be monitored before live trading.

## Important env vars

Copy `.env.example` and tune:

- `TRENCHES_MAX_LOSS_BPS=1000` caps session loss at 10%.
- `TRENCHES_MAX_MARKET_CAP_USD=250000` keeps focus on low-cap trenches.
- `TRENCHES_MAX_HARD_FEE_BPS=250` and `TRENCHES_MAX_ROUND_TRIP_HARD_FEE_BPS=500` keep total fees survivable.
- `TRENCHES_MIN_TRACKED_WALLET_HITS=2` requires multiple wallet tracker entries.
- `TRENCHES_REQUIRE_BELOW_REFERENCE=true` avoids buying after price is already extended.
- `TRENCHES_PRIORITY_FEE_SOL` should stay low enough that fixed fees do not dominate small positions.

---
name: testing-trenches-cli
description: Test the Trenches Solana bot CLI flows, executor dry-run metadata, paper trading, backtest, and forward-test behavior.
---

# Testing Trenches CLI

Use this skill when validating changes to `0xtera/trenches` CLI behavior, strategy gates, executor order metadata, paper trading, risk exits, or PM2 runtime behavior.

## Devin Secrets Needed

- `GMGN_LIVE_AUTH_CONFIG`: only needed for GMGN credential validation or gated live executor checks.
- No secrets are needed for mock source, unit tests, backtest, paper, forward-test, or dry-run executor metadata checks.

## Standard Validation

Run from repo root:

```bash
npm run check
```

Expected result: syntax checks pass and Node test runner reports all tests passing.

## Mock Runtime Checks

Use mock source first so tests are deterministic and do not depend on GMGN availability:

```bash
npm run smoke
npm run backtest
npm run paper
npm run forward-test
```

Expected result: commands exit 0; low-cap mock candidate can become `EXECUTE_READY`; extended pump candidate is skipped; paper state includes risk fields and PnL summary.

## Executor Dry-Run Checks

For executor metadata changes, call `executeDecision` with `executeTrades: false` so no live order can be submitted. Assert exact order fields, especially `exitPlan` values.

Important cases:
- Disabled partial TP (`partialTakeProfitPct: 0`) should set `exitPlan.partialTakeProfitPriceUsd` to `0`.
- Enabled partial TP should calculate target from entry price and percent.

## GMGN Validation

If testing real data or GMGN credentials:

```bash
npm run gmgn:validate
```

Expected result: command exits 0 or reports a clear auth/data-source error. Keep `TRENCHES_EXECUTE=false` unless the user explicitly approves gated live testing with a funded test wallet.

## PM2 Runtime Checks

For long-running mode, prefer the provided scripts:

```bash
npm run pm2:paper
npm run pm2:logs -- trenches-paper --lines 100
```

Expected result: PM2 app stays `online` with no rapid restart loop. One-shot commands like `npm run scan` may exit quickly and should not be used directly as PM2 daemons.

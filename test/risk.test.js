import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBacktest } from "../src/backtest.js";
import { loadConfig } from "../src/config.js";
import { runPaperTrading } from "../src/paper.js";
import { openPaperPosition, applyExitRules, summarizePositions } from "../src/risk.js";

const config = loadConfig({ TRENCHES_BANKROLL_USD: "500" });

function result() {
  return {
    token: { address: "Token1111111111111111111111111111111111", symbol: "LOW" },
    metrics: { priceUsd: 1 },
    position: { sizeUsd: 25, stopLossPct: 15, takeProfitPct: 30, trailingStopPct: 12 },
  };
}

test("paper position closes at take profit", () => {
  const opened = openPaperPosition(result(), config, "2026-05-08T00:00:00.000Z");
  const closed = applyExitRules(opened, 1.31, "2026-05-08T00:05:00.000Z");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.exitReason, "TAKE_PROFIT");
  assert.ok(closed.realizedPnlUsd > 0);
});

test("paper position harvests partial profit before full exit", () => {
  const opened = openPaperPosition(result(), config, "2026-05-08T00:00:00.000Z");
  const partial = applyExitRules(opened, 1.21, "2026-05-08T00:05:00.000Z");
  assert.equal(partial.status, "OPEN");
  assert.equal(partial.partialTakeProfitTaken, true);
  assert.equal(partial.remainingQuantity, 12.5);
  assert.ok(partial.realizedPnlUsd > 0);

  const closed = applyExitRules(partial, 1.31, "2026-05-08T00:10:00.000Z");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.exitReason, "TAKE_PROFIT");
  assert.ok(closed.realizedPnlUsd > partial.realizedPnlUsd);
});

test("paper position closes at stop loss", () => {
  const opened = openPaperPosition(result(), config, "2026-05-08T00:00:00.000Z");
  const closed = applyExitRules(opened, 0.84, "2026-05-08T00:05:00.000Z");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.exitReason, "STOP_LOSS");
  assert.ok(closed.realizedPnlUsd < 0);
});

test("paper position closes after configured max hold time", () => {
  const holdConfig = loadConfig({ TRENCHES_BANKROLL_USD: "500", TRENCHES_MAX_HOLD_MS: "60000" });
  const opened = openPaperPosition(result(), holdConfig, "2026-05-08T00:00:00.000Z");
  const closed = applyExitRules(opened, 1.01, "2026-05-08T00:01:01.000Z");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.exitReason, "MAX_HOLD");
});

test("summary flags 10 percent loss budget breach", () => {
  const breached = summarizePositions([{ status: "CLOSED", realizedPnlUsd: -60, unrealizedPnlUsd: 0 }], config);
  assert.equal(breached.lossBudgetBreached, true);
  assert.equal(breached.maxLossUsd, 50);
});

test("backtest treats zero price as stop-loss event", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trenches-backtest-"));
  const historicalFile = join(dir, "history.json");
  const tokenAddress = "ZeroPrice111111111111111111111111111111111";
  await writeFile(historicalFile, JSON.stringify([
    { timestamp: "2026-05-08T00:00:00.000Z", prices: { [tokenAddress]: 1 }, candidates: [candidate(tokenAddress)] },
    { timestamp: "2026-05-08T00:01:00.000Z", prices: { [tokenAddress]: 0 }, candidates: [] },
  ]));

  const backtest = await runBacktest(loadConfig({ TRENCHES_BANKROLL_USD: "500", TRENCHES_HISTORICAL_FILE: historicalFile }));
  assert.equal(backtest.positions[0].status, "CLOSED");
  assert.equal(backtest.positions[0].exitReason, "STOP_LOSS");
  assert.equal(backtest.positions[0].currentPriceUsd, 0);
});

test("paper trading sizes entries against accumulated paper losses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trenches-paper-"));
  const paperStateFile = join(dir, "state.json");
  await writeFile(paperStateFile, JSON.stringify({ positions: [{ status: "CLOSED", realizedPnlUsd: -49, unrealizedPnlUsd: 0 }] }));

  const paper = await runPaperTrading(loadConfig({
    TRENCHES_SOURCE: "mock",
    TRENCHES_BANKROLL_USD: "500",
    TRENCHES_OUTPUT_LIMIT: "1",
    TRENCHES_PAPER_STATE_FILE: paperStateFile,
    TRENCHES_PRIORITY_FEE_SOL: "0",
    TRENCHES_NETWORK_FEE_SOL: "0",
  }));

  assert.equal(paper.decisions[0].position.remainingLossBudgetUsd, 1);
  assert.equal(paper.decisions[0].position.riskUsd, 1);
  assert.ok(paper.decisions[0].position.sizeUsd < 25);
});

test("paper trading respects max open position cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trenches-paper-max-open-"));
  const paperStateFile = join(dir, "state.json");
  const open = openPaperPosition(result(), config, "2026-05-08T00:00:00.000Z");
  await writeFile(paperStateFile, JSON.stringify({ positions: [open] }));

  const paper = await runPaperTrading(loadConfig({
    TRENCHES_SOURCE: "mock",
    TRENCHES_BANKROLL_USD: "500",
    TRENCHES_MAX_OPEN_POSITIONS: "1",
    TRENCHES_OUTPUT_LIMIT: "1",
    TRENCHES_PAPER_STATE_FILE: paperStateFile,
    TRENCHES_PRIORITY_FEE_SOL: "0",
    TRENCHES_NETWORK_FEE_SOL: "0",
  }));

  assert.equal(paper.positions.length, 1);
  assert.equal(paper.summary.openPositions, 1);
});

test("paper trading hydrates legacy open positions with new exit rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trenches-paper-hydrate-"));
  const paperStateFile = join(dir, "state.json");
  await writeFile(paperStateFile, JSON.stringify({
    positions: [{
      tokenAddress: "MockLowCap1111111111111111111111111111111",
      symbol: "LOW",
      status: "OPEN",
      openedAt: "2026-05-08T00:00:00.000Z",
      entryPriceUsd: 0.0008,
      currentPriceUsd: 0.0008,
      highestPriceUsd: 0.0008,
      sizeUsd: 25,
      quantity: 31250,
      stopLossPct: 15,
      takeProfitPct: 30,
      trailingStopPct: 12,
      stopLossPriceUsd: 0.00068,
      takeProfitPriceUsd: 0.00104,
      trailingStopPriceUsd: 0.000704,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
    }],
  }));

  const paper = await runPaperTrading(loadConfig({
    TRENCHES_SOURCE: "mock",
    TRENCHES_BANKROLL_USD: "500",
    TRENCHES_MAX_HOLD_MS: "1",
    TRENCHES_OUTPUT_LIMIT: "1",
    TRENCHES_PAPER_STATE_FILE: paperStateFile,
    TRENCHES_PRIORITY_FEE_SOL: "0",
    TRENCHES_NETWORK_FEE_SOL: "0",
  }));

  assert.equal(paper.positions[0].status, "CLOSED");
  assert.equal(paper.positions[0].exitReason, "MAX_HOLD");
  assert.equal(paper.positions[0].partialTakeProfitPct, 20);
});

function candidate(tokenAddress) {
  return {
    source: "test",
    tokenAddress,
    symbol: "ZERO",
    name: "Zero Price",
    priceUsd: 1,
    priceReferenceUsd: 1.25,
    liquidityUsd: 18000,
    marketCapUsd: 85000,
    volumeM5Usd: 6500,
    volumeH1Usd: 42000,
    priceChangeM5Pct: -3.5,
    priceChangeH1Pct: -11,
    buys5m: 32,
    sells5m: 18,
    pairAgeMs: 12 * 60 * 1000,
    dexPaid: false,
    boostActive: 0,
    trackedWalletHits: 3,
    trackedWalletValueUsd: 900,
    trackedWallets: ["wallet-a", "wallet-b", "wallet-c"],
    security: { renouncedMint: true, renouncedFreeze: true, topHolderPct: 9, top10HolderPct: 31 },
    links: {},
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
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

test("paper position closes at stop loss", () => {
  const opened = openPaperPosition(result(), config, "2026-05-08T00:00:00.000Z");
  const closed = applyExitRules(opened, 0.84, "2026-05-08T00:05:00.000Z");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.exitReason, "STOP_LOSS");
  assert.ok(closed.realizedPnlUsd < 0);
});

test("summary flags 10 percent loss budget breach", () => {
  const breached = summarizePositions([{ status: "CLOSED", realizedPnlUsd: -60, unrealizedPnlUsd: 0 }], config);
  assert.equal(breached.lossBudgetBreached, true);
  assert.equal(breached.maxLossUsd, 50);
});

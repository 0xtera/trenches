import test from "node:test";
import assert from "node:assert/strict";

import { executeDecision } from "../src/executor.js";

test("dry-run exit plan hides partial take profit target when disabled", async () => {
  const execution = await executeDecision(result({ partialTakeProfitPct: 0 }), config());

  assert.equal(execution.status, "DRY_RUN");
  assert.equal(execution.order.exitPlan.partialTakeProfitPriceUsd, 0);
});

test("dry-run exit plan includes partial take profit target when enabled", async () => {
  const execution = await executeDecision(result({ partialTakeProfitPct: 20 }), config());

  assert.equal(execution.status, "DRY_RUN");
  assert.equal(execution.order.exitPlan.partialTakeProfitPriceUsd, 1.2);
});

function config() {
  return {
    executeTrades: false,
    slippageBps: 700,
    priorityFeeSol: 0.0005,
  };
}

function result(positionOverrides = {}) {
  return {
    decision: "EXECUTE_READY",
    token: {
      address: "Token1111111111111111111111111111111111111",
      symbol: "TEST",
    },
    metrics: {
      priceUsd: 1,
    },
    position: {
      sizeUsd: 25,
      riskUsd: 3.75,
      stopLossPct: 15,
      takeProfitPct: 30,
      trailingStopPct: 12,
      partialTakeProfitPct: 20,
      partialTakeProfitSizePct: 50,
      ...positionOverrides,
    },
    checks: {
      fees: { safe: true },
    },
    links: {},
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { evaluateCandidate, estimateFeeSafety } from "../src/strategy.js";

const baseConfig = loadConfig({
  TRENCHES_BANKROLL_USD: "500",
  TRENCHES_MIN_TRACKED_WALLET_HITS: "2",
  TRENCHES_MIN_TRACKED_WALLET_VALUE_USD: "0",
  TRENCHES_PRIORITY_FEE_SOL: "0.0005",
  SOL_USD_PRICE: "150",
});

function candidate(overrides = {}) {
  return {
    source: "test",
    tokenAddress: "Token1111111111111111111111111111111111",
    symbol: "LOW",
    name: "Low Cap",
    priceUsd: 0.0008,
    priceReferenceUsd: 0.001,
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
    trackedWallets: ["a", "b", "c"],
    security: { renouncedMint: true, renouncedFreeze: true, topHolderPct: 9, top10HolderPct: 31 },
    links: {},
    ...overrides,
  };
}

test("marks low-cap dip with tracked wallets and safe fees as execution-ready", () => {
  const result = evaluateCandidate(candidate(), baseConfig, 10);
  assert.equal(result.decision, "EXECUTE_READY");
  assert.equal(result.checks.rejects.length, 0);
  assert.equal(result.checks.fees.safe, true);
  assert.equal(result.checks.price.belowReference, true);
});

test("rejects when total hard fees are unsafe", () => {
  const expensiveConfig = { ...baseConfig, priorityFeeSol: 0.006 };
  const result = evaluateCandidate(candidate(), expensiveConfig, 10);
  assert.equal(result.decision, "SKIP");
  assert.ok(result.checks.rejects.includes("total hard fees above safety cap"));
});

test("requires multiple tracked wallets before execution", () => {
  const result = evaluateCandidate(candidate({ trackedWalletHits: 1, trackedWallets: ["a"] }), baseConfig, 10);
  assert.equal(result.decision, "SKIP");
  assert.ok(result.checks.rejects.includes("not enough tracked wallets entered"));
});

test("rejects extended price instead of chasing pump", () => {
  const result = evaluateCandidate(candidate({ priceReferenceUsd: 0, priceChangeM5Pct: 22, priceChangeH1Pct: 55 }), baseConfig, 10);
  assert.equal(result.decision, "SKIP");
  assert.ok(result.checks.rejects.includes("price is not below reference/dip zone"));
  assert.ok(result.checks.rejects.includes("5m price is extended above entry ceiling"));
});

test("fixed low-cap fees get more expensive as position size shrinks", () => {
  const small = estimateFeeSafety(5, baseConfig);
  const large = estimateFeeSafety(25, baseConfig);
  assert.ok(small.hardFeeBps > large.hardFeeBps);
});

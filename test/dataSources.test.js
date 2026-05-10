import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { loadConfig } from "../src/config.js";
import { loadCandidates } from "../src/dataSources.js";
import { evaluateCandidate } from "../src/strategy.js";

test("loads Charon signal-server candidates with configured API key", async () => {
  const signal = {
    mint: "CharonMint1111111111111111111111111111111111",
    symbol: "CHARON",
    name: "Charon Signal",
    priceUsd: 0.8,
    liquidityUsd: 22000,
    marketCapUsd: 85000,
    volume5m: 6500,
    volume1h: 42000,
    buys5m: 34,
    sells5m: 12,
    ageMs: 20 * 60 * 1000,
    sources: ["feeClaim", "graduated", "trending"],
    sourceCount: 3,
    trending: {
      smart_degen_count: 3,
      smart_wallets: ["wallet-a", "wallet-b", "wallet-c"],
      rug_ratio: 0.12,
      bundler_rate: 0.04,
      rat_trader_amount_rate: 0.03,
      is_wash_trading: false,
      is_honeypot: false,
    },
    graduated: {
      distanceFromAthPercent: -20,
    },
    renouncedMint: true,
    renouncedFreeze: true,
    topHolderPct: 9,
    top10HolderPct: 31,
    devHoldPct: 2,
  };
  let request;
  const server = createServer((req, res) => {
    request = { url: req.url, apiKey: req.headers["x-api-key"] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ signals: [signal] }));
  });
  await listen(server);
  try {
    const { port } = server.address();
    const config = loadConfig({
      TRENCHES_SOURCE: "charon-signal",
      SIGNAL_SERVER_URL: `http://127.0.0.1:${port}`,
      SIGNAL_SERVER_KEY: "test-key",
      SIGNAL_SERVER_LIMIT: "7",
      SIGNAL_SERVER_MIN_SOURCES: "2",
      TRENCHES_USE_RUGCHECK: "false",
      TRENCHES_CANDIDATE_LIMIT: "5",
      TRENCHES_MIN_SIGNAL_OVERLAP: "4",
      TRENCHES_MIN_TRACKED_WALLETS: "2",
    });

    const [candidate] = await loadCandidates(config);
    assert.equal(request.apiKey, "test-key");
    assert.match(request.url, /\/api\/signals\?/);
    assert.match(request.url, /minSources=2/);
    assert.match(request.url, /limit=7/);
    assert.equal(candidate.source, "charon-signal");
    assert.equal(candidate.tokenAddress, signal.mint);
    assert.equal(candidate.trackedWalletHits, 3);
    assert.deepEqual(candidate.trackedWallets, ["wallet-a", "wallet-b", "wallet-c"]);
    assert.equal(candidate.security.isHoneypot, false);
    assert.equal(candidate.priceReferenceUsd, 1);

    const result = evaluateCandidate(candidate, config, 50);
    assert.deepEqual(result.checks.rejects, []);
    assert.equal(result.decision, "EXECUTE_READY");
  } finally {
    await close(server);
  }
});

test("requires Charon signal-server URL when selected", async () => {
  const config = loadConfig({
    TRENCHES_SOURCE: "charon-signal",
    TRENCHES_USE_RUGCHECK: "false",
  });
  await assert.rejects(() => loadCandidates(config), /SIGNAL_SERVER_URL/);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

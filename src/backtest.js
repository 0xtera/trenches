import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { openPaperPosition, applyExitRules, summarizePositions } from "./risk.js";
import { evaluateCandidate } from "./strategy.js";

export async function runBacktest(config = loadConfig()) {
  const snapshots = config.historicalFile ? await loadHistoricalSnapshots(config.historicalFile) : mockSnapshots();
  const positions = [];
  const maxLossUsd = (config.startingBankrollUsd * config.maxLossBudgetBps) / 10000;
  let realizedLossUsd = Math.max(0, config.realizedLossUsd);

  for (const snapshot of snapshots) {
    for (const position of positions) {
      if (position.status !== "OPEN") continue;
      const priceUsd = snapshot.prices?.[position.tokenAddress] || position.currentPriceUsd;
      const updated = applyExitRules(position, priceUsd, snapshot.timestamp);
      Object.assign(position, updated);
    }

    const remainingLossBudgetUsd = Math.max(0, maxLossUsd - realizedLossUsd);
    for (const candidate of snapshot.candidates || []) {
      const result = evaluateCandidate(candidate, config, remainingLossBudgetUsd);
      if (result.decision !== "EXECUTE_READY") continue;
      if (positions.some((position) => position.tokenAddress === result.token.address)) continue;
      positions.push(openPaperPosition(result, config, snapshot.timestamp));
    }
    realizedLossUsd = Math.abs(Math.min(0, positions.reduce((sum, position) => sum + (position.realizedPnlUsd || 0), 0)));
  }

  return {
    mode: "backtest",
    snapshots: snapshots.length,
    summary: summarizePositions(positions, config),
    positions,
  };
}

async function loadHistoricalSnapshots(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("TRENCHES_HISTORICAL_FILE must be a JSON array of snapshots");
  return parsed;
}

function mockSnapshots() {
  const tokenAddress = "MockLowCap1111111111111111111111111111111";
  const baseCandidate = {
    source: "backtest-mock",
    tokenAddress,
    symbol: "LOW",
    name: "Low Cap Dip",
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
    trackedWallets: ["wallet-a", "wallet-b", "wallet-c"],
    security: { renouncedMint: true, renouncedFreeze: true, topHolderPct: 9, top10HolderPct: 31 },
    links: { gmgn: `https://gmgn.ai/sol/token/${tokenAddress}` },
  };
  return [
    { timestamp: "2026-05-08T00:00:00.000Z", prices: { [tokenAddress]: 0.0008 }, candidates: [baseCandidate] },
    { timestamp: "2026-05-08T00:05:00.000Z", prices: { [tokenAddress]: 0.00092 }, candidates: [] },
    { timestamp: "2026-05-08T00:10:00.000Z", prices: { [tokenAddress]: 0.00105 }, candidates: [] },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBacktest().then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { loadCandidates } from "./dataSources.js";
import { openPaperPosition, applyExitRules, summarizePositions } from "./risk.js";
import { scoreCandidates } from "./strategy.js";

export async function runPaperTrading(config = loadConfig()) {
  const state = await readPaperState(config.paperStateFile);
  const candidates = await loadCandidates(config);
  const priceByToken = new Map(candidates.map((candidate) => [candidate.tokenAddress, candidate.priceUsd]));
  const updatedPositions = state.positions.map((position) => {
    const priceUsd = priceByToken.get(position.tokenAddress) || position.currentPriceUsd;
    return applyExitRules(position, priceUsd);
  });

  const openTokens = new Set(updatedPositions.filter((position) => position.status === "OPEN").map((position) => position.tokenAddress));
  const results = scoreCandidates(candidates, config).slice(0, config.outputLimit);
  for (const result of results) {
    if (result.decision !== "EXECUTE_READY") continue;
    if (openTokens.has(result.token.address)) continue;
    if (summarizePositions(updatedPositions, config).lossBudgetBreached) break;
    const position = openPaperPosition(result, config);
    updatedPositions.push(position);
    openTokens.add(position.tokenAddress);
  }

  const nextState = {
    updatedAt: new Date().toISOString(),
    positions: updatedPositions,
    summary: summarizePositions(updatedPositions, config),
  };
  await writePaperState(config.paperStateFile, nextState);
  return { mode: "paper", candidates: candidates.length, decisions: results, ...nextState };
}

export async function readPaperState(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { positions: Array.isArray(parsed.positions) ? parsed.positions : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { positions: [] };
    throw error;
  }
}

async function writePaperState(filePath, state) {
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPaperTrading().then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

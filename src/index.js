import { setTimeout as delay } from "node:timers/promises";
import { runBacktest } from "./backtest.js";
import { loadConfig } from "./config.js";
import { loadCandidates } from "./dataSources.js";
import { executeDecision } from "./executor.js";
import { runPaperTrading } from "./paper.js";
import { scoreCandidates } from "./strategy.js";

async function main() {
  const argMode = process.argv[2];
  const loadedConfig = loadConfig();
  const config = { ...loadedConfig, mode: argMode || loadedConfig.mode };
  console.log(`trenches bot started; source=${config.source}; mode=${config.mode}; maxLoss=${config.maxLossBudgetBps / 100}% bankroll; execute=${config.executeTrades}`);

  if (config.mode === "backtest") {
    console.log(JSON.stringify(await runBacktest(config)));
    return;
  }
  if (config.mode === "paper") {
    console.log(JSON.stringify(await runPaperTrading(config)));
    return;
  }
  if (config.mode === "forward-test") {
    for (let cycle = 0; cycle < config.forwardTestCycles; cycle += 1) {
      console.log(JSON.stringify({ cycle: cycle + 1, ...(await runPaperTrading(config)) }));
      if (cycle + 1 < config.forwardTestCycles) await delay(config.scanIntervalMs);
    }
    return;
  }

  do {
    const candidates = await loadCandidates(config);
    const results = scoreCandidates(candidates, config).slice(0, config.outputLimit);
    for (const result of results) {
      if (config.mode === "execute") {
        const execution = await executeDecision(result, config);
        console.log(JSON.stringify({ ...result, execution }));
      } else {
        console.log(JSON.stringify(result));
      }
    }
    if (!config.scanOnce) await delay(config.scanIntervalMs);
  } while (!config.scanOnce);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

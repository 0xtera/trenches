import { loadConfig } from "./config.js";
import { loadCandidates } from "./dataSources.js";
import { executeDecision } from "./executor.js";
import { scoreCandidates } from "./strategy.js";

async function main() {
  const argMode = process.argv[2];
  const config = { ...loadConfig(), mode: argMode || loadConfig().mode };
  console.log(`trenches bot started; source=${config.source}; mode=${config.mode}; maxLoss=${config.maxLossBudgetBps / 100}% bankroll; execute=${config.executeTrades}`);

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
    if (!config.scanOnce) await new Promise((resolve) => setTimeout(resolve, config.scanIntervalMs));
  } while (!config.scanOnce);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

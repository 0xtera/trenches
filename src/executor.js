import { runJsonCommand } from "./dataSources.js";

const LIVE_RISK_ACK = "I_UNDERSTAND_NO_PROFIT_GUARANTEE";

export async function executeDecision(result, config) {
  if (result.decision !== "EXECUTE_READY") {
    return { status: "SKIPPED", reason: "candidate is not execution-ready" };
  }

  const order = buildOrder(result, config);
  if (!config.executeTrades) {
    return { status: "DRY_RUN", reason: "TRENCHES_EXECUTE=false", order };
  }
  if (config.liveRiskAck !== LIVE_RISK_ACK) {
    throw new Error(`Live execution requires TRENCHES_LIVE_RISK_ACK=${LIVE_RISK_ACK}`);
  }
  if (config.executor !== "gmgn-cli") {
    throw new Error("Live execution currently supports TRENCHES_EXECUTOR=gmgn-cli only");
  }

  const args = [
    "trade",
    "buy",
    "--chain",
    "sol",
    "--token",
    result.token.address,
    "--amount-usd",
    String(order.sizeUsd),
    "--slippage-bps",
    String(config.slippageBps),
    "--priority-fee-sol",
    String(config.priorityFeeSol),
    "--raw",
  ];
  const response = await runJsonCommand(config.gmgnCliBin, args);
  return { status: "SUBMITTED", order, response };
}

function buildOrder(result, config) {
  return {
    side: "BUY",
    tokenAddress: result.token.address,
    symbol: result.token.symbol,
    sizeUsd: result.position.sizeUsd,
    maxRiskUsd: result.position.riskUsd,
    stopLossPct: result.position.stopLossPct,
    takeProfitPct: result.position.takeProfitPct,
    trailingStopPct: result.position.trailingStopPct,
    maxSlippageBps: config.slippageBps,
    priorityFeeSol: config.priorityFeeSol,
    feeEstimate: result.checks.fees,
    links: result.links,
  };
}

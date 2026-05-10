import { runJsonCommand } from "./dataSources.js";

const LIVE_RISK_ACK = "I_UNDERSTAND_NO_PROFIT_GUARANTEE";
const SOL_MINT = "So11111111111111111111111111111111111111112";

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
  if (!config.gmgnApiKey || !config.gmgnPrivateKey || !config.gmgnWalletAddress) {
    throw new Error("GMGN live swap requires GMGN_API_KEY or GMGN_LIVE_AUTH_CONFIG, GMGN_PRIVATE_KEY, and GMGN_WALLET_ADDRESS");
  }

  const args = [
    ...config.gmgnCliArgsPrefix,
    "swap",
    "--chain",
    "sol",
    "--from",
    config.gmgnWalletAddress,
    "--input-token",
    SOL_MINT,
    "--output-token",
    result.token.address,
    "--amount",
    String(solLamports(order.sizeUsd, config.solUsdPrice)),
    "--slippage",
    String(config.slippageBps / 10000),
    "--priority-fee",
    String(config.priorityFeeSol),
    "--anti-mev",
    "--raw",
  ];
  const response = await runJsonCommand(config.gmgnCliBin, args, gmgnEnv(config));
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
    partialTakeProfitPct: result.position.partialTakeProfitPct,
    partialTakeProfitSizePct: result.position.partialTakeProfitSizePct,
    maxSlippageBps: config.slippageBps,
    priorityFeeSol: config.priorityFeeSol,
    feeEstimate: result.checks.fees,
    links: result.links,
    exitPlan: {
      stopLossPriceUsd: priceAt(result.metrics.priceUsd, -result.position.stopLossPct),
      partialTakeProfitPriceUsd: result.position.partialTakeProfitPct > 0 ? priceAt(result.metrics.priceUsd, result.position.partialTakeProfitPct) : 0,
      takeProfitPriceUsd: priceAt(result.metrics.priceUsd, result.position.takeProfitPct),
      trailingStopPct: result.position.trailingStopPct,
    },
  };
}

function solLamports(sizeUsd, solUsdPrice) {
  if (sizeUsd <= 0 || solUsdPrice <= 0) return 0;
  return Math.floor((sizeUsd / solUsdPrice) * 1_000_000_000);
}

function priceAt(entryPriceUsd, pctChange) {
  if (!entryPriceUsd) return 0;
  return Math.round(entryPriceUsd * (1 + pctChange / 100) * 1_000_000_000_000) / 1_000_000_000_000;
}

function gmgnEnv(config) {
  return {
    GMGN_API_KEY: config.gmgnApiKey,
    GMGN_PRIVATE_KEY: config.gmgnPrivateKey,
  };
}

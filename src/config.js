export function loadConfig(env = process.env) {
  return {
    source: env.TRENCHES_SOURCE || "dexscreener",
    mode: env.TRENCHES_MODE || "scan",
    scanOnce: boolEnv(env, "TRENCHES_SCAN_ONCE", true),
    scanIntervalMs: numberEnv(env, "TRENCHES_SCAN_INTERVAL_MS", 15000),
    forwardTestCycles: numberEnv(env, "TRENCHES_FORWARD_TEST_CYCLES", 3),
    candidateLimit: numberEnv(env, "TRENCHES_CANDIDATE_LIMIT", 30),
    outputLimit: numberEnv(env, "TRENCHES_OUTPUT_LIMIT", 10),
    startingBankrollUsd: numberEnv(env, "TRENCHES_BANKROLL_USD", 100),
    realizedLossUsd: numberEnv(env, "TRENCHES_REALIZED_LOSS_USD", 0),
    maxLossBudgetBps: numberEnv(env, "TRENCHES_MAX_LOSS_BPS", 1000),
    riskPerTradeBps: numberEnv(env, "TRENCHES_RISK_PER_TRADE_BPS", 100),
    maxPositionBps: numberEnv(env, "TRENCHES_MAX_POSITION_BPS", 1000),
    maxPositionUsd: numberEnv(env, "TRENCHES_MAX_POSITION_USD", 25),
    stopLossBps: numberEnv(env, "TRENCHES_STOP_LOSS_BPS", 1500),
    takeProfitBps: numberEnv(env, "TRENCHES_TAKE_PROFIT_BPS", 3000),
    trailingStopBps: numberEnv(env, "TRENCHES_TRAILING_STOP_BPS", 1200),
    maxLiquidityImpactBps: numberEnv(env, "TRENCHES_MAX_LIQUIDITY_IMPACT_BPS", 75),
    minMarketCapUsd: numberEnv(env, "TRENCHES_MIN_MARKET_CAP_USD", 5000),
    maxMarketCapUsd: numberEnv(env, "TRENCHES_MAX_MARKET_CAP_USD", 250000),
    minLiquidityUsd: numberEnv(env, "TRENCHES_MIN_LIQUIDITY_USD", 3000),
    maxLiquidityUsd: numberEnv(env, "TRENCHES_MAX_LIQUIDITY_USD", 200000),
    minM5Buys: numberEnv(env, "TRENCHES_MIN_M5_BUYS", 12),
    minBuySellRatio: numberEnv(env, "TRENCHES_MIN_BUY_SELL_RATIO", 1.15),
    minPairAgeMs: numberEnv(env, "TRENCHES_MIN_PAIR_AGE_MS", 180000),
    maxPairAgeMs: numberEnv(env, "TRENCHES_MAX_PAIR_AGE_MS", 86400000),
    maxTopHolderPct: numberEnv(env, "TRENCHES_MAX_TOP_HOLDER_PCT", 15),
    maxTop10HolderPct: numberEnv(env, "TRENCHES_MAX_TOP10_HOLDER_PCT", 45),
    maxBundlerRate: numberEnv(env, "TRENCHES_MAX_BUNDLER_RATE", 0.3),
    maxRatTraderRate: numberEnv(env, "TRENCHES_MAX_RAT_TRADER_RATE", 0.3),
    maxRugRatio: numberEnv(env, "TRENCHES_MAX_RUG_RATIO", 0.3),
    maxRugScore: numberEnv(env, "TRENCHES_MAX_RUG_SCORE", 6000),
    useRugcheck: boolEnv(env, "TRENCHES_USE_RUGCHECK", true),
    allowDexAds: boolEnv(env, "TRENCHES_ALLOW_DEX_ADS", false),
    allowBoostedTokens: boolEnv(env, "TRENCHES_ALLOW_BOOSTED_TOKENS", false),
    trackedWallets: listEnv(env, "TRACKED_WALLETS"),
    trackerFile: env.TRENCHES_TRACKER_FILE || "",
    trackerSource: env.TRENCHES_TRACKER_SOURCE || "file",
    trackerLimit: numberEnv(env, "TRENCHES_TRACKER_LIMIT", 100),
    minTrackedWalletHits: numberEnv(env, "TRENCHES_MIN_TRACKED_WALLET_HITS", 2),
    minTrackedWalletValueUsd: numberEnv(env, "TRENCHES_MIN_TRACKED_WALLET_VALUE_USD", 0),
    requireBelowReference: boolEnv(env, "TRENCHES_REQUIRE_BELOW_REFERENCE", true),
    maxM5PriceChangePct: numberEnv(env, "TRENCHES_MAX_M5_PRICE_CHANGE_PCT", 8),
    maxH1PriceChangePct: numberEnv(env, "TRENCHES_MAX_H1_PRICE_CHANGE_PCT", 20),
    minReferenceDiscountPct: numberEnv(env, "TRENCHES_MIN_REFERENCE_DISCOUNT_PCT", 3),
    solUsdPrice: numberEnv(env, "SOL_USD_PRICE", 150),
    platformFeeBps: numberEnv(env, "TRENCHES_PLATFORM_FEE_BPS", 100),
    protocolFeeBps: numberEnv(env, "TRENCHES_PROTOCOL_FEE_BPS", 25),
    priorityFeeSol: numberEnv(env, "TRENCHES_PRIORITY_FEE_SOL", 0.0005),
    networkFeeSol: numberEnv(env, "TRENCHES_NETWORK_FEE_SOL", 0.00025),
    maxHardFeeBps: numberEnv(env, "TRENCHES_MAX_HARD_FEE_BPS", 250),
    maxRoundTripHardFeeBps: numberEnv(env, "TRENCHES_MAX_ROUND_TRIP_HARD_FEE_BPS", 500),
    slippageBps: numberEnv(env, "TRENCHES_SLIPPAGE_BPS", 700),
    maxSlippageBps: numberEnv(env, "TRENCHES_MAX_SLIPPAGE_BPS", 1200),
    executeTrades: boolEnv(env, "TRENCHES_EXECUTE", false),
    executor: env.TRENCHES_EXECUTOR || "dry-run",
    liveRiskAck: env.TRENCHES_LIVE_RISK_ACK || "",
    gmgnCliBin: env.GMGN_CLI_BIN || "npx",
    gmgnCliArgsPrefix: listEnv(env, "GMGN_CLI_ARGS_PREFIX", ["-y", "gmgn-cli"]),
    gmgnTypes: listEnv(env, "GMGN_TRENCHES_TYPES", ["new_creation", "near_completion", "completed"]),
    gmgnPlatforms: listEnv(env, "GMGN_TRENCHES_PLATFORMS"),
    gmgnApiKey: gmgnAuth(env).apiKey,
    gmgnPrivateKey: gmgnAuth(env).privateKey,
    gmgnWalletAddress: env.GMGN_WALLET_ADDRESS || "",
    historicalFile: env.TRENCHES_HISTORICAL_FILE || "",
    paperStateFile: env.TRENCHES_PAPER_STATE_FILE || ".trenches-paper-state.json",
    publicTrackerFile: env.TRENCHES_PUBLIC_TRACKER_FILE || "data/public-tracked-wallets.json",
  };
}

function gmgnAuth(env) {
  const raw = env.GMGN_LIVE_AUTH_CONFIG || "";
  let apiKey = env.GMGN_API_KEY || "";
  let privateKey = env.GMGN_PRIVATE_KEY || "";
  if (!raw) return { apiKey, privateKey };
  try {
    const parsed = JSON.parse(raw);
    apiKey = apiKey || parsed.GMGN_API_KEY || parsed.apiKey || parsed.api_key || parsed.token || "";
    privateKey = privateKey || parsed.GMGN_PRIVATE_KEY || parsed.privateKey || parsed.private_key || "";
  } catch {
    apiKey = apiKey || raw;
  }
  return { apiKey, privateKey };
}

export function numberEnv(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

export function boolEnv(env, name, fallback = false) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

export function listEnv(env, name, fallback = []) {
  const value = env[name];
  if (!value) return fallback;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export function scoreCandidates(candidates, config) {
  const maxLossUsd = (config.startingBankrollUsd * config.maxLossBudgetBps) / 10000;
  const remainingLossBudgetUsd = Math.max(0, maxLossUsd - config.realizedLossUsd);
  return candidates
    .map((candidate) => evaluateCandidate(candidate, config, remainingLossBudgetUsd))
    .sort((a, b) => b.score - a.score);
}

export function evaluateCandidate(candidate, config, remainingLossBudgetUsd) {
  const position = planPosition(candidate, config, remainingLossBudgetUsd, true);
  const fees = estimateFeeSafety(position.sizeUsd || config.maxPositionUsd, config);
  const price = evaluatePriceLocation(candidate, config);
  const security = normalizeSecurity(candidate.security);
  const rejects = [];
  const warnings = [];
  const confirmations = [];

  if (remainingLossBudgetUsd <= 0) rejects.push("10% max loss budget exhausted");
  if (!candidate.tokenAddress) rejects.push("missing token address");
  if (candidate.marketCapUsd < config.minMarketCapUsd) rejects.push("market cap below low-cap floor");
  if (candidate.marketCapUsd > config.maxMarketCapUsd) rejects.push("market cap above low-cap execution range");
  if (candidate.liquidityUsd < config.minLiquidityUsd) rejects.push("liquidity below execution floor");
  if (candidate.liquidityUsd > config.maxLiquidityUsd) warnings.push("liquidity above target low-cap trench");
  if (candidate.pairAgeMs && candidate.pairAgeMs < config.minPairAgeMs) rejects.push("less than 3-candle confirmation window");
  if (candidate.pairAgeMs && candidate.pairAgeMs > config.maxPairAgeMs) warnings.push("older than target trenches window");

  const buySellRatio = candidate.sells5m === 0 ? candidate.buys5m : candidate.buys5m / candidate.sells5m;
  if (candidate.buys5m < config.minM5Buys) rejects.push("5m buy count below confirmation floor");
  if (buySellRatio < config.minBuySellRatio) rejects.push("5m buy/sell ratio below confirmation floor");
  if (candidate.trackedWalletHits < config.minTrackedWalletHits) rejects.push("not enough tracked wallets entered");
  if (candidate.trackedWalletValueUsd < config.minTrackedWalletValueUsd) rejects.push("tracked wallet value below floor");

  if (fees.hardFeeBps > config.maxHardFeeBps) rejects.push("total hard fees above safety cap");
  if (fees.roundTripHardFeeBps > config.maxRoundTripHardFeeBps) rejects.push("round-trip fees above survival cap");
  if (config.slippageBps > config.maxSlippageBps) rejects.push("slippage above safety cap");

  if (config.requireBelowReference && !price.belowReference) rejects.push("price is not below reference/dip zone");
  if (candidate.priceChangeM5Pct > config.maxM5PriceChangePct) rejects.push("5m price is extended above entry ceiling");
  if (candidate.priceChangeH1Pct > config.maxH1PriceChangePct) rejects.push("1h price is extended above entry ceiling");

  if (security.rugged) rejects.push("rugcheck flagged rugged");
  if (security.riskScore > config.maxRugScore) rejects.push("rugcheck risk score too high");
  if (security.mintAuthorityActive) rejects.push("mint authority still active");
  if (security.freezeAuthorityActive) rejects.push("freeze authority still active");
  if (security.topHolderPct > config.maxTopHolderPct) rejects.push("top holder concentration too high");
  if (security.top10HolderPct > config.maxTop10HolderPct) rejects.push("top 10 holder concentration too high");
  if (security.devHoldPct > config.maxTopHolderPct) rejects.push("developer/team holding too high");
  if (security.bundlerRate > config.maxBundlerRate) rejects.push("bundled launch exposure too high");
  if (security.ratTraderRate > config.maxRatTraderRate) rejects.push("insider/rat trader exposure too high");
  if (security.rugRatio > config.maxRugRatio) rejects.push("rug ratio too high");
  if (security.isWashTrading) rejects.push("wash trading detected");
  if (security.isHoneypot) rejects.push("honeypot token detected");
  if (security.error) warnings.push(`security source unavailable: ${security.error}`);
  if (!config.allowDexAds && candidate.dexPaid) warnings.push("DEX ad is marketing, not quality confirmation");
  if (!config.allowBoostedTokens && candidate.boostActive > 0) warnings.push("boosted token needs organic confirmation");

  if (candidate.trackedWalletHits >= config.minTrackedWalletHits) confirmations.push("tracked wallets entered");
  if (fees.safe) confirmations.push("total fees safe for configured position");
  if (price.belowReference) confirmations.push("price is below reference/dip zone");
  if (security.renouncedMint) confirmations.push("mint authority renounced");
  if (security.renouncedFreeze) confirmations.push("freeze authority renounced");
  if (candidate.volumeH1Usd > candidate.liquidityUsd && candidate.liquidityUsd > 0) confirmations.push("volume/liquidity shows active flow");

  const signalOverlap = {
    count: confirmations.length,
    min: config.minSignalOverlap,
    labels: confirmations,
  };
  if (signalOverlap.count < signalOverlap.min) rejects.push("not enough independent signal overlap");

  const eligiblePosition = rejects.length === 0 ? position : emptyPosition(config, remainingLossBudgetUsd);
  const score = scoreCandidate(candidate, { rejects, warnings, confirmations, signalOverlap, security, fees, price });
  const decision = rejects.length === 0 && score >= 75 && eligiblePosition.sizeUsd > 0 ? "EXECUTE_READY" : "SKIP";

  return {
    decision,
    score,
    token: {
      symbol: candidate.symbol,
      name: candidate.name,
      address: candidate.tokenAddress,
    },
    metrics: {
      priceUsd: candidate.priceUsd,
      priceReferenceUsd: candidate.priceReferenceUsd,
      liquidityUsd: candidate.liquidityUsd,
      marketCapUsd: candidate.marketCapUsd,
      volumeM5Usd: candidate.volumeM5Usd,
      volumeH1Usd: candidate.volumeH1Usd,
      priceChangeM5Pct: candidate.priceChangeM5Pct,
      priceChangeH1Pct: candidate.priceChangeH1Pct,
      buys5m: candidate.buys5m,
      sells5m: candidate.sells5m,
      buySellRatio: round(buySellRatio, 2),
      pairAgeMinutes: round(candidate.pairAgeMs / 60000, 1),
      trackedWalletHits: candidate.trackedWalletHits,
      trackedWalletValueUsd: candidate.trackedWalletValueUsd,
      trackedWallets: candidate.trackedWallets,
      signalOverlap: signalOverlap.count,
      dexPaid: candidate.dexPaid,
      boostActive: candidate.boostActive,
    },
    position: eligiblePosition,
    checks: { rejects, warnings, confirmations, signalOverlap, security, fees, price },
    links: candidate.links,
    source: candidate.source,
  };
}

export function estimateFeeSafety(positionUsd, config) {
  const fixedFeeUsd = (config.priorityFeeSol + config.networkFeeSol) * config.solUsdPrice;
  const fixedFeeBps = positionUsd > 0 ? (fixedFeeUsd / positionUsd) * 10000 : Number.POSITIVE_INFINITY;
  const hardFeeBps = config.platformFeeBps + config.protocolFeeBps + fixedFeeBps;
  const roundTripHardFeeBps = hardFeeBps * 2;
  return {
    safe: hardFeeBps <= config.maxHardFeeBps && roundTripHardFeeBps <= config.maxRoundTripHardFeeBps,
    hardFeeBps: round(hardFeeBps, 2),
    roundTripHardFeeBps: round(roundTripHardFeeBps, 2),
    fixedFeeUsd: roundUsd(fixedFeeUsd),
    platformFeeBps: config.platformFeeBps,
    protocolFeeBps: config.protocolFeeBps,
    priorityFeeSol: config.priorityFeeSol,
    networkFeeSol: config.networkFeeSol,
    slippageBps: config.slippageBps,
  };
}

export function evaluatePriceLocation(candidate, config) {
  const referencePriceUsd = candidate.priceReferenceUsd;
  const hasReference = referencePriceUsd > 0 && candidate.priceUsd > 0;
  const referenceDiscountPct = hasReference ? ((referencePriceUsd - candidate.priceUsd) / referencePriceUsd) * 100 : 0;
  const belowReference = hasReference
    ? referenceDiscountPct >= config.minReferenceDiscountPct
    : candidate.priceChangeM5Pct <= 0 || candidate.priceChangeH1Pct <= 0;
  return {
    belowReference,
    referenceDiscountPct: round(referenceDiscountPct, 2),
    maxM5PriceChangePct: config.maxM5PriceChangePct,
    maxH1PriceChangePct: config.maxH1PriceChangePct,
  };
}

function scoreCandidate(candidate, checks) {
  let score = 45;
  if (candidate.marketCapUsd >= 10000 && candidate.marketCapUsd <= 150000) score += 12;
  if (candidate.liquidityUsd >= 5000 && candidate.liquidityUsd <= 100000) score += 8;
  if (candidate.volumeH1Usd > candidate.liquidityUsd && candidate.liquidityUsd > 0) score += 8;
  if (candidate.buys5m > candidate.sells5m) score += 8;
  if (candidate.trackedWalletHits >= 2) score += 14;
  if (checks.fees.safe) score += 12;
  if (checks.price.belowReference) score += 10;
  if (checks.signalOverlap.count >= checks.signalOverlap.min) score += 8;
  else score -= (checks.signalOverlap.min - checks.signalOverlap.count) * 6;
  if (checks.security.renouncedMint) score += 5;
  if (checks.security.renouncedFreeze) score += 3;
  if (candidate.dexPaid) score -= 4;
  if (candidate.boostActive > 0) score -= 3;
  score -= checks.rejects.length * 18;
  score -= checks.warnings.length * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function planPosition(candidate, config, remainingLossBudgetUsd, eligible) {
  if (!eligible) return emptyPosition(config, remainingLossBudgetUsd);
  const riskUsd = Math.min(remainingLossBudgetUsd, (config.startingBankrollUsd * config.riskPerTradeBps) / 10000);
  const stopLossPct = config.stopLossBps / 10000;
  const byRisk = stopLossPct > 0 ? riskUsd / stopLossPct : 0;
  const byBankroll = (config.startingBankrollUsd * config.maxPositionBps) / 10000;
  const byLiquidity = (candidate.liquidityUsd * config.maxLiquidityImpactBps) / 10000;
  const sizeUsd = Math.max(0, Math.min(byRisk, byBankroll, byLiquidity, config.maxPositionUsd));
  return {
    sizeUsd: roundUsd(sizeUsd),
    riskUsd: roundUsd(Math.min(riskUsd, sizeUsd * stopLossPct)),
    stopLossPct: config.stopLossBps / 100,
    takeProfitPct: config.takeProfitBps / 100,
    trailingStopPct: config.trailingStopBps / 100,
    partialTakeProfitPct: config.partialTakeProfitBps / 100,
    partialTakeProfitSizePct: config.partialTakeProfitSizeBps / 100,
    maxHoldMinutes: config.maxHoldMs > 0 ? round(config.maxHoldMs / 60000, 1) : 0,
    remainingLossBudgetUsd: roundUsd(remainingLossBudgetUsd),
    maxSessionLossUsd: roundUsd((config.startingBankrollUsd * config.maxLossBudgetBps) / 10000),
  };
}

function emptyPosition(config, remainingLossBudgetUsd) {
  return {
    sizeUsd: 0,
    riskUsd: 0,
    stopLossPct: config.stopLossBps / 100,
    takeProfitPct: config.takeProfitBps / 100,
    trailingStopPct: config.trailingStopBps / 100,
    partialTakeProfitPct: config.partialTakeProfitBps / 100,
    partialTakeProfitSizePct: config.partialTakeProfitSizeBps / 100,
    maxHoldMinutes: config.maxHoldMs > 0 ? round(config.maxHoldMs / 60000, 1) : 0,
    remainingLossBudgetUsd: roundUsd(remainingLossBudgetUsd),
    maxSessionLossUsd: roundUsd((config.startingBankrollUsd * config.maxLossBudgetBps) / 10000),
  };
}

function normalizeSecurity(security) {
  if (!security) return {};
  if (security.error) return { error: security.error };
  const token = security.token || {};
  const holders = security.topHolders || security.holders || [];
  const risks = Array.isArray(security.risks) ? security.risks : [];
  const mintAuthority = token.mintAuthority ?? security.mintAuthority;
  const freezeAuthority = token.freezeAuthority ?? security.freezeAuthority;
  const mintAuthorityRisk = risks.some((risk) => /mint authority/i.test(String(risk.name || risk.description || risk.message || "")));
  const freezeAuthorityRisk = risks.some((risk) => /freeze authority/i.test(String(risk.name || risk.description || risk.message || "")));
  const mintAuthorityActive = mintAuthorityRisk || activeAddress(mintAuthority);
  const freezeAuthorityActive = freezeAuthorityRisk || activeAddress(freezeAuthority);
  return {
    error: security.error,
    rugged: asBoolean(security.rugged),
    riskScore: numeric(security.score || security.riskScore),
    mintAuthorityActive,
    freezeAuthorityActive,
    renouncedMint: security.renouncedMint === true || (mintAuthority !== undefined && !activeAddress(mintAuthority)),
    renouncedFreeze: security.renouncedFreeze === true || (freezeAuthority !== undefined && !activeAddress(freezeAuthority)),
    topHolderPct: numeric(security.topHolderPct) || maxHolderPct(holders),
    top10HolderPct: numeric(security.top10HolderPct) || top10Pct(holders),
    devHoldPct: numeric(security.devHoldPct),
    bundlerRate: numeric(security.bundlerRate),
    ratTraderRate: numeric(security.ratTraderRate),
    rugRatio: numeric(security.rugRatio),
    isWashTrading: asBoolean(security.isWashTrading),
    isHoneypot: asBoolean(security.isHoneypot),
  };
}

function maxHolderPct(holders) {
  return holders.reduce((max, holder) => Math.max(max, holderPct(holder)), 0);
}

function top10Pct(holders) {
  return Math.min(100, holders.slice(0, 10).reduce((sum, holder) => sum + holderPct(holder), 0));
}

function holderPct(holder) {
  return pct(holder.pct || holder.percentage || holder.percent || holder.uiAmountPct || holder.amountPct);
}

function activeAddress(value) {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "string") return value !== "11111111111111111111111111111111" && value !== "0x0000000000000000000000000000000000000000";
  return Boolean(value);
}

function numeric(value) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value) {
  const parsed = numeric(value);
  if (parsed <= 1) return parsed * 100;
  return Math.min(100, parsed);
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "y"].includes(value.toLowerCase());
  return Boolean(value);
}

function roundUsd(value) {
  return round(value, 2);
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

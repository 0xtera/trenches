export function openPaperPosition(result, config, openedAt = new Date().toISOString()) {
  const entryPriceUsd = result.metrics.priceUsd;
  const sizeUsd = result.position.sizeUsd;
  return {
    tokenAddress: result.token.address,
    symbol: result.token.symbol,
    status: "OPEN",
    openedAt,
    entryPriceUsd,
    currentPriceUsd: entryPriceUsd,
    highestPriceUsd: entryPriceUsd,
    sizeUsd,
    quantity: entryPriceUsd > 0 ? sizeUsd / entryPriceUsd : 0,
    stopLossPct: result.position.stopLossPct,
    takeProfitPct: result.position.takeProfitPct,
    trailingStopPct: result.position.trailingStopPct,
    stopLossPriceUsd: priceAt(entryPriceUsd, -result.position.stopLossPct),
    takeProfitPriceUsd: priceAt(entryPriceUsd, result.position.takeProfitPct),
    trailingStopPriceUsd: priceAt(entryPriceUsd, -result.position.trailingStopPct),
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
  };
}

export function applyExitRules(position, priceUsd, checkedAt = new Date().toISOString()) {
  if (position.status !== "OPEN") return position;
  const highestPriceUsd = Math.max(position.highestPriceUsd, priceUsd);
  const trailingStopPriceUsd = priceAt(highestPriceUsd, -position.trailingStopPct);
  const updated = {
    ...position,
    checkedAt,
    currentPriceUsd: priceUsd,
    highestPriceUsd,
    trailingStopPriceUsd,
    unrealizedPnlUsd: pnlUsd(position, priceUsd),
  };

  if (priceUsd <= position.stopLossPriceUsd) return closePosition(updated, "STOP_LOSS", priceUsd, checkedAt);
  if (priceUsd >= position.takeProfitPriceUsd) return closePosition(updated, "TAKE_PROFIT", priceUsd, checkedAt);
  if (highestPriceUsd > position.entryPriceUsd && priceUsd <= trailingStopPriceUsd) return closePosition(updated, "TRAILING_STOP", priceUsd, checkedAt);
  return updated;
}

export function summarizePositions(positions, config) {
  const realizedPnlUsd = roundUsd(positions.reduce((sum, position) => sum + (position.realizedPnlUsd || 0), 0));
  const unrealizedPnlUsd = roundUsd(positions.reduce((sum, position) => sum + (position.unrealizedPnlUsd || 0), 0));
  const openPositions = positions.filter((position) => position.status === "OPEN").length;
  const closedPositions = positions.length - openPositions;
  const maxLossUsd = roundUsd((config.startingBankrollUsd * config.maxLossBudgetBps) / 10000);
  return {
    positions: positions.length,
    openPositions,
    closedPositions,
    realizedPnlUsd,
    unrealizedPnlUsd,
    maxLossUsd,
    lossBudgetRemainingUsd: roundUsd(Math.max(0, maxLossUsd + realizedPnlUsd)),
    lossBudgetBreached: realizedPnlUsd < -maxLossUsd,
  };
}

function closePosition(position, exitReason, exitPriceUsd, closedAt) {
  return {
    ...position,
    status: "CLOSED",
    exitReason,
    exitPriceUsd,
    closedAt,
    realizedPnlUsd: pnlUsd(position, exitPriceUsd),
    unrealizedPnlUsd: 0,
  };
}

function pnlUsd(position, priceUsd) {
  return roundUsd((priceUsd - position.entryPriceUsd) * position.quantity);
}

function priceAt(entryPriceUsd, pctChange) {
  if (!entryPriceUsd) return 0;
  return round(entryPriceUsd * (1 + pctChange / 100), 12);
}

function roundUsd(value) {
  return round(value, 2);
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function openPaperPosition(result, config, openedAt = new Date().toISOString()) {
  const entryPriceUsd = result.metrics.priceUsd;
  const sizeUsd = result.position.sizeUsd;
  const quantity = entryPriceUsd > 0 ? sizeUsd / entryPriceUsd : 0;
  const partialTakeProfitPct = result.position.partialTakeProfitPct ?? (config.partialTakeProfitBps || 0) / 100;
  const partialTakeProfitSizePct = result.position.partialTakeProfitSizePct ?? (config.partialTakeProfitSizeBps || 0) / 100;
  return {
    tokenAddress: result.token.address,
    symbol: result.token.symbol,
    status: "OPEN",
    openedAt,
    entryPriceUsd,
    currentPriceUsd: entryPriceUsd,
    highestPriceUsd: entryPriceUsd,
    sizeUsd,
    quantity,
    remainingQuantity: quantity,
    stopLossPct: result.position.stopLossPct,
    takeProfitPct: result.position.takeProfitPct,
    trailingStopPct: result.position.trailingStopPct,
    partialTakeProfitPct,
    partialTakeProfitSizePct,
    partialTakeProfitTaken: false,
    maxHoldMs: config.maxHoldMs || 0,
    stopLossPriceUsd: priceAt(entryPriceUsd, -result.position.stopLossPct),
    takeProfitPriceUsd: priceAt(entryPriceUsd, result.position.takeProfitPct),
    trailingStopPriceUsd: priceAt(entryPriceUsd, -result.position.trailingStopPct),
    partialTakeProfitPriceUsd: partialTakeProfitPct > 0 ? priceAt(entryPriceUsd, partialTakeProfitPct) : 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
  };
}

export function applyExitRules(position, priceUsd, checkedAt = new Date().toISOString()) {
  if (position.status !== "OPEN") return position;
  const highestPriceUsd = Math.max(position.highestPriceUsd, priceUsd);
  const trailingStopPriceUsd = priceAt(highestPriceUsd, -position.trailingStopPct);
  let updated = {
    ...position,
    checkedAt,
    currentPriceUsd: priceUsd,
    highestPriceUsd,
    trailingStopPriceUsd,
    unrealizedPnlUsd: pnlUsd(position, priceUsd),
  };

  updated = applyPartialTakeProfit(updated, priceUsd, checkedAt);

  if (priceUsd <= updated.stopLossPriceUsd) return closePosition(updated, "STOP_LOSS", priceUsd, checkedAt);
  if (priceUsd >= updated.takeProfitPriceUsd) return closePosition(updated, "TAKE_PROFIT", priceUsd, checkedAt);
  if (highestPriceUsd > updated.entryPriceUsd && priceUsd <= trailingStopPriceUsd) return closePosition(updated, "TRAILING_STOP", priceUsd, checkedAt);
  if (maxHoldExceeded(updated, checkedAt)) return closePosition(updated, "MAX_HOLD", priceUsd, checkedAt);
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

function applyPartialTakeProfit(position, priceUsd, checkedAt) {
  if (position.partialTakeProfitTaken) return position;
  if (!position.partialTakeProfitPct || !position.partialTakeProfitSizePct) return position;
  if (!position.partialTakeProfitPriceUsd || priceUsd < position.partialTakeProfitPriceUsd) return position;

  const sellPct = Math.max(0, Math.min(100, position.partialTakeProfitSizePct)) / 100;
  const soldQuantity = position.quantity * sellPct;
  if (soldQuantity <= 0) return position;
  const remainingQuantity = Math.max(0, position.quantity - soldQuantity);
  const partialPnlUsd = roundUsd((priceUsd - position.entryPriceUsd) * soldQuantity);
  const updated = {
    ...position,
    checkedAt,
    quantity: remainingQuantity,
    remainingQuantity,
    partialTakeProfitTaken: true,
    partialTakeProfitAt: checkedAt,
    partialTakeProfitPriceUsd: priceUsd,
    partialTakeProfitSoldQuantity: soldQuantity,
    realizedPnlUsd: roundUsd((position.realizedPnlUsd || 0) + partialPnlUsd),
  };
  return {
    ...updated,
    unrealizedPnlUsd: pnlUsd(updated, priceUsd),
  };
}

function maxHoldExceeded(position, checkedAt) {
  if (!position.maxHoldMs || position.maxHoldMs <= 0) return false;
  const opened = Date.parse(position.openedAt);
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(opened) || !Number.isFinite(checked)) return false;
  return checked - opened >= position.maxHoldMs;
}

function closePosition(position, exitReason, exitPriceUsd, closedAt) {
  const realizedPnlUsd = roundUsd((position.realizedPnlUsd || 0) + pnlUsd(position, exitPriceUsd));
  return {
    ...position,
    status: "CLOSED",
    exitReason,
    exitPriceUsd,
    closedAt,
    realizedPnlUsd,
    unrealizedPnlUsd: 0,
    quantity: 0,
    remainingQuantity: 0,
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

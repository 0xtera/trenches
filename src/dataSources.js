import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const RUGCHECK_BASE_URL = "https://api.rugcheck.xyz";
const SOL_CHAIN_ID = "solana";

export async function loadCandidates(config) {
  const trackerHits = await loadTrackerHits(config);
  const candidates = await loadRawCandidates(config);
  return candidates.map((candidate) => mergeTrackerHits(candidate, trackerHits));
}

async function loadRawCandidates(config) {
  if (config.source === "mock") return mockCandidates();
  if (config.source === "gmgn") return loadGmgnCandidates(config);
  return loadDexScreenerCandidates(config);
}

async function loadDexScreenerCandidates(config) {
  const [profiles, ads, boosts] = await Promise.all([
    fetchJson(`${DEXSCREENER_BASE_URL}/token-profiles/latest/v1`),
    fetchJson(`${DEXSCREENER_BASE_URL}/ads/latest/v1`).catch(() => []),
    fetchJson(`${DEXSCREENER_BASE_URL}/token-boosts/latest/v1`).catch(() => []),
  ]);
  const solProfiles = profiles
    .filter((profile) => profile.chainId === SOL_CHAIN_ID && profile.tokenAddress)
    .slice(0, config.candidateLimit * 2);
  if (solProfiles.length === 0) return [];

  const adSet = new Set(ads.filter((ad) => ad.chainId === SOL_CHAIN_ID).map((ad) => ad.tokenAddress));
  const boostMap = new Map(boosts.filter((boost) => boost.chainId === SOL_CHAIN_ID).map((boost) => [boost.tokenAddress, boost]));
  const addresses = solProfiles.map((profile) => profile.tokenAddress).slice(0, 30);
  const pairs = await fetchJson(`${DEXSCREENER_BASE_URL}/tokens/v1/solana/${addresses.join(",")}`);
  const bestPairs = new Map();

  for (const pair of pairs) {
    const tokenAddress = pair.baseToken?.address;
    if (!tokenAddress) continue;
    const current = bestPairs.get(tokenAddress);
    const currentLiquidity = current?.liquidity?.usd || 0;
    const pairLiquidity = pair.liquidity?.usd || 0;
    if (!current || pairLiquidity > currentLiquidity) bestPairs.set(tokenAddress, pair);
  }

  const candidates = [];
  for (const profile of solProfiles) {
    const pair = bestPairs.get(profile.tokenAddress);
    if (!pair) continue;
    candidates.push(normalizeDexScreenerCandidate(profile, pair, adSet, boostMap.get(profile.tokenAddress)));
  }

  const limited = candidates.slice(0, config.candidateLimit);
  if (!config.useRugcheck) return limited;

  for (const candidate of limited) {
    candidate.security = await fetchRugcheckReport(candidate.tokenAddress);
    await delay(150);
  }
  return limited;
}

async function loadGmgnCandidates(config) {
  const args = [...config.gmgnCliArgsPrefix, "market", "trenches", "--chain", "sol", "--limit", String(config.candidateLimit), "--raw"];
  for (const type of config.gmgnTypes) args.push("--type", type);
  for (const platform of config.gmgnPlatforms) args.push("--launchpad-platform", platform);

  if (config.minMarketCapUsd) args.push("--min-marketcap", String(config.minMarketCapUsd));
  if (config.maxMarketCapUsd) args.push("--max-marketcap", String(config.maxMarketCapUsd));
  if (config.minLiquidityUsd) args.push("--min-liquidity", String(config.minLiquidityUsd));
  if (config.maxRugRatio) args.push("--max-rug-ratio", String(config.maxRugRatio));

  const json = await runJsonCommand(config.gmgnCliBin, args, gmgnEnv(config));
  const data = json.data || json;
  const buckets = [data.new_creation, data.pump, data.near_completion, data.completed, data.tokens].filter(Array.isArray);
  return dedupeCandidates(buckets.flat().map(normalizeGmgnCandidate).filter((candidate) => candidate.tokenAddress));
}

async function loadTrackerHits(config) {
  const hits = new Map();
  if (config.trackerFile) mergeHitMaps(hits, await loadTrackerFile(config.trackerFile));
  if (config.trackerSource === "gmgn-smartmoney") mergeHitMaps(hits, await loadGmgnSmartMoneyHits(config));
  return hits;
}

async function loadTrackerFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([tokenAddress, value]) => ({ tokenAddress, ...value }));
  const hits = new Map();
  for (const row of rows) addTrackerHit(hits, row);
  return hits;
}

async function loadGmgnSmartMoneyHits(config) {
  const args = [...config.gmgnCliArgsPrefix, "track", "smartmoney", "--chain", "sol", "--limit", String(config.trackerLimit), "--side", "buy", "--raw"];
  const json = await runJsonCommand(config.gmgnCliBin, args, gmgnEnv(config));
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const hits = new Map();
  for (const row of rows) addTrackerHit(hits, normalizeTrackerTrade(row));
  return hits;
}

function normalizeTrackerTrade(row) {
  const token = row.token || row.to_token || row.buy_token || {};
  const wallet = row.wallet || row.wallet_address || row.address || row.trader || row.maker || "gmgn-smartmoney";
  return {
    tokenAddress: token.address || row.token_address || row.to_token_address || row.contract_address || row.mint,
    valueUsd: row.usd_value || row.value_usd || row.amount_usd || row.total_usd,
    wallets: [wallet].filter(Boolean),
  };
}

function addTrackerHit(hits, row) {
  const tokenAddress = row.tokenAddress || row.address || row.mint;
  if (!tokenAddress) return;
  const wallets = Array.isArray(row.wallets) ? row.wallets.map(String).filter(Boolean) : [];
  const current = hits.get(tokenAddress) || { trackedWalletHits: 0, trackedWalletValueUsd: 0, trackedWallets: [] };
  const walletSet = new Set([...current.trackedWallets, ...wallets]);
  const explicitHits = numeric(row.trackedWalletHits ?? row.hits);
  hits.set(tokenAddress, {
    trackedWalletHits: Math.max(current.trackedWalletHits, explicitHits || walletSet.size),
    trackedWalletValueUsd: current.trackedWalletValueUsd + numeric(row.trackedWalletValueUsd ?? row.valueUsd ?? row.usdValue),
    trackedWallets: [...walletSet],
  });
}

function mergeHitMaps(target, source) {
  for (const [tokenAddress, hit] of source.entries()) addTrackerHit(target, {
    tokenAddress,
    trackedWalletHits: hit.trackedWalletHits,
    trackedWalletValueUsd: hit.trackedWalletValueUsd,
    wallets: hit.trackedWallets,
  });
}

function mergeTrackerHits(candidate, trackerHits) {
  const hit = trackerHits.get(candidate.tokenAddress);
  if (!hit) return candidate;
  const wallets = new Set([...(candidate.trackedWallets || []), ...hit.trackedWallets]);
  return {
    ...candidate,
    trackedWalletHits: Math.max(candidate.trackedWalletHits, hit.trackedWalletHits),
    trackedWalletValueUsd: Math.max(candidate.trackedWalletValueUsd, hit.trackedWalletValueUsd),
    trackedWallets: [...wallets],
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRugcheckReport(tokenAddress) {
  try {
    return await fetchJson(`${RUGCHECK_BASE_URL}/v1/tokens/${tokenAddress}/report`);
  } catch (error) {
    return { error: error.message };
  }
}

export function runJsonCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Unable to parse ${command} JSON output: ${error.message}`));
      }
    });
  });
}

function gmgnEnv(config) {
  const env = {};
  if (config.gmgnApiKey) env.GMGN_API_KEY = config.gmgnApiKey;
  if (config.gmgnPrivateKey) env.GMGN_PRIVATE_KEY = config.gmgnPrivateKey;
  return env;
}

function normalizeDexScreenerCandidate(profile, pair, adSet, boost) {
  const tokenAddress = profile.tokenAddress;
  return baseCandidate({
    source: "dexscreener",
    tokenAddress,
    symbol: pair.baseToken?.symbol || tokenAddress,
    name: pair.baseToken?.name || pair.baseToken?.symbol || tokenAddress,
    priceUsd: numeric(pair.priceUsd),
    liquidityUsd: numeric(pair.liquidity?.usd),
    marketCapUsd: numeric(pair.marketCap || pair.fdv),
    volumeM5Usd: numeric(pair.volume?.m5),
    volumeH1Usd: numeric(pair.volume?.h1),
    priceChangeM5Pct: numeric(pair.priceChange?.m5),
    priceChangeH1Pct: numeric(pair.priceChange?.h1),
    buys5m: numeric(pair.txns?.m5?.buys),
    sells5m: numeric(pair.txns?.m5?.sells),
    pairAgeMs: pair.pairCreatedAt ? Date.now() - Number(pair.pairCreatedAt) : 0,
    dexPaid: adSet.has(tokenAddress),
    boostActive: numeric(pair.boosts?.active || boost?.totalAmount || boost?.amount),
    links: {
      gmgn: `https://gmgn.ai/sol/token/${tokenAddress}`,
      dexscreener: pair.url || profile.url,
    },
  });
}

function normalizeGmgnCandidate(item) {
  const tokenAddress = item.address || item.token_address || item.tokenAddress || item.mint || item.contract_address;
  const trackedWallets = arrayValue(item.tracked_wallets || item.smart_wallets || item.wallets);
  return baseCandidate({
    source: "gmgn",
    tokenAddress,
    symbol: item.symbol || item.token_symbol || item.name || tokenAddress,
    name: item.name || item.token_name || item.symbol || tokenAddress,
    priceUsd: numeric(item.price || item.price_usd || item.usd_price) || priceFromMarketCap(item),
    priceReferenceUsd: numeric(item.avg_price_1h || item.reference_price || item.vwap_1h),
    liquidityUsd: numeric(item.liquidity || item.liquidity_usd || item.pool_liquidity || item.usd_liquidity),
    marketCapUsd: numeric(item.market_cap || item.usd_market_cap || item.marketcap || item.mc || item.fdv),
    volumeM5Usd: numeric(item.volume_5m || item.volume5m || item.volume) || numeric(item.volume_24h),
    volumeH1Usd: numeric(item.volume_1h || item.volume1h || item.volume) || numeric(item.volume_24h),
    priceChangeM5Pct: numeric(item.change5m || item.price_change_5m || item.price_change_m5),
    priceChangeH1Pct: numeric(item.change1h || item.price_change_1h || item.price_change_h1),
    buys5m: numeric(item.buys_5m || item.buy_count_5m || item.buys || item.swaps_5m_buy) || numeric(item.buys_24h),
    sells5m: numeric(item.sells_5m || item.sell_count_5m || item.sells || item.swaps_5m_sell) || numeric(item.sells_24h),
    pairAgeMs: ageMsFromTimestamp(item.creation_timestamp || item.open_timestamp || item.created_at),
    dexPaid: Boolean(item.dex_paid || item.has_dex_ad || item.is_dex_paid),
    boostActive: numeric(item.hot_level || item.boosts || item.boost_active),
    trackedWalletHits: numeric(item.tracked_wallet_hits || item.smart_degen_count || item.renowned_count || trackedWallets.length),
    trackedWalletValueUsd: numeric(item.tracked_wallet_value_usd || item.smart_money_value_usd),
    trackedWallets,
    security: {
      renouncedMint: asBoolean(item.renounced_mint),
      renouncedFreeze: asBoolean(item.renounced_freeze_account),
      top10HolderPct: pct(item.top_10_holder_rate),
      devHoldPct: pct(item.dev_team_hold_rate || item.creator_hold_rate),
      bundlerRate: numeric(item.bundler_rate),
      ratTraderRate: numeric(item.rat_trader_amount_rate),
      rugRatio: numeric(item.rug_ratio),
      isWashTrading: asBoolean(item.is_wash_trading || item.wash_trading),
      isHoneypot: asBoolean(item.is_honeypot),
    },
    links: {
      gmgn: `https://gmgn.ai/sol/token/${tokenAddress}`,
    },
  });
}

function dedupeCandidates(candidates) {
  const byToken = new Map();
  for (const candidate of candidates) {
    const current = byToken.get(candidate.tokenAddress);
    if (!current || candidate.trackedWalletHits > current.trackedWalletHits) byToken.set(candidate.tokenAddress, candidate);
  }
  return [...byToken.values()];
}

function baseCandidate(candidate) {
  return {
    source: candidate.source,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    priceUsd: numeric(candidate.priceUsd),
    priceReferenceUsd: numeric(candidate.priceReferenceUsd),
    liquidityUsd: numeric(candidate.liquidityUsd),
    marketCapUsd: numeric(candidate.marketCapUsd),
    volumeM5Usd: numeric(candidate.volumeM5Usd),
    volumeH1Usd: numeric(candidate.volumeH1Usd),
    priceChangeM5Pct: numeric(candidate.priceChangeM5Pct),
    priceChangeH1Pct: numeric(candidate.priceChangeH1Pct),
    buys5m: numeric(candidate.buys5m),
    sells5m: numeric(candidate.sells5m),
    pairAgeMs: numeric(candidate.pairAgeMs),
    dexPaid: Boolean(candidate.dexPaid),
    boostActive: numeric(candidate.boostActive),
    trackedWalletHits: numeric(candidate.trackedWalletHits),
    trackedWalletValueUsd: numeric(candidate.trackedWalletValueUsd),
    trackedWallets: arrayValue(candidate.trackedWallets),
    security: candidate.security || null,
    links: candidate.links || {},
  };
}

function mockCandidates() {
  return [
    baseCandidate({
      source: "mock",
      tokenAddress: "MockLowCap1111111111111111111111111111111",
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
      trackedWalletHits: 3,
      trackedWalletValueUsd: 900,
      trackedWallets: ["wallet-a", "wallet-b", "wallet-c"],
      security: { renouncedMint: true, renouncedFreeze: true, topHolderPct: 9, top10HolderPct: 31 },
      links: { gmgn: "https://gmgn.ai/sol/token/MockLowCap1111111111111111111111111111111" },
    }),
    baseCandidate({
      source: "mock",
      tokenAddress: "MockExtended111111111111111111111111111111",
      symbol: "PUMP",
      name: "Extended Pump",
      priceUsd: 0.002,
      liquidityUsd: 20000,
      marketCapUsd: 90000,
      volumeM5Usd: 8500,
      volumeH1Usd: 50000,
      priceChangeM5Pct: 24,
      priceChangeH1Pct: 66,
      buys5m: 44,
      sells5m: 20,
      pairAgeMs: 20 * 60 * 1000,
      trackedWalletHits: 3,
      security: { renouncedMint: true, renouncedFreeze: true, topHolderPct: 8, top10HolderPct: 29 },
    }),
  ];
}

function priceFromMarketCap(item) {
  const marketCapUsd = numeric(item.market_cap || item.usd_market_cap || item.fdv);
  const supply = numeric(item.total_supply || item.supply || item.circulating_supply);
  return marketCapUsd > 0 && supply > 0 ? marketCapUsd / supply : 0;
}

function ageMsFromTimestamp(timestamp) {
  const value = numeric(timestamp);
  if (!value) return 0;
  const millis = value > 1000000000000 ? value : value * 1000;
  return Date.now() - millis;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
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

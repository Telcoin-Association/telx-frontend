import "server-only";

import { CHAINS } from "./chains";
import { readState, type RpcRedis } from "./store";

/**
 * Tokens taken from the pipeline's Polygon prices: eUSD and eMXN, which the Telcoin rates API does not price, and
 * TEL, which it prices at legacy TEL's exchange rate rather than TEL3's on-chain one.
 */
export const PIPELINE_RATE_SYMBOLS: readonly string[] = ["eUSD", "eMXN", "TEL"];

/** Polygon state older than this (the v3 payload's age limit) is not used for rates. */
export const PIPELINE_RATE_MAX_AGE_SECONDS = 60 * 60;

/**
 * USD rates for PIPELINE_RATE_SYMBOLS from the pipeline's latest Polygon prices, keyed and shaped like the
 * Telcoin rates in GET /api/market-rate (`{ EUSD: { USD: "1" } }`). eUSD is the pipeline's fixed $1, eMXN its
 * Chainlink MXN/USD answer and TEL the median of Polygon's TEL pool routes. A price the pipeline flagged stale,
 * which includes a TEL price taken from Merkl or the last run because no route was usable, and every price when the state is missing
 * or older than PIPELINE_RATE_MAX_AGE_SECONDS at `now` (unix seconds), is left out, so a position reads as
 * unpriced rather than showing an old value.
 */
export async function pipelineRates(redis: RpcRedis, now: number = Math.floor(Date.now() / 1000)): Promise<Record<string, { USD: string }>> {
  const state = await readState(redis, "polygon");
  if (!state.prices || state.timestamp === null || now - state.timestamp > PIPELINE_RATE_MAX_AGE_SECONDS) return {};

  const rates: Record<string, { USD: string }> = {};
  for (const [address, token] of Object.entries(CHAINS.polygon.tokens)) {
    if (!PIPELINE_RATE_SYMBOLS.includes(token.symbol)) continue;
    const price = state.prices.tokens[address.toLowerCase()];
    if (!price || price.stale || !Number.isFinite(price.usd) || price.usd <= 0) continue;
    rates[token.symbol.toUpperCase()] = { USD: String(price.usd) };
  }
  return rates;
}

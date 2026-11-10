import { LEGACY_TEL_RATE } from "./tokens";

/**
 * GET /api/market-rate's rates, from the Telcoin rates API (`telcoin`) and the pool pipeline (`pipeline`). The
 * Telcoin rates API quotes TEL at legacy TEL's exchange price, so that price is served as LEGACY_TEL_RATE, and `TEL`
 * is the pipeline's on-chain TEL3 price when the pipeline has one. For every other ticker a Telcoin rate is kept
 * over the pipeline's.
 */
export function mergeMarketRates(telcoin: Record<string, unknown>, pipeline: Record<string, { USD: string }>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...pipeline, ...telcoin };
  if (telcoin.TEL !== undefined) merged[LEGACY_TEL_RATE] = telcoin.TEL;
  if (pipeline.TEL) merged.TEL = pipeline.TEL;
  return merged;
}

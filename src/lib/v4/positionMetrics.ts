/**
 * Figures a positions list shows for each Uniswap v4 position, from its ticks, the pool's `sqrtPriceX96` and its
 * token amounts. Everything is computed in floating point in tick space, which is exact enough for display.
 */

const LOG_TICK_BASE = Math.log(1.0001);

/** The pool's current tick as a real number, from `sqrtPriceX96`. Null when the price is missing or unreadable. */
export function currentTick(sqrtPriceX96: string | bigint | null | undefined): number | null {
  if (sqrtPriceX96 === null || sqrtPriceX96 === undefined || sqrtPriceX96 === "") return null;
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) return null;
  return (2 * Math.log(sqrtPrice)) / LOG_TICK_BASE;
}

/** 1.0001^(ticks / 2): the ratio of square-root prices `ticks` apart. */
const sqrtRatio = (ticks: number) => Math.exp((ticks / 2) * LOG_TICK_BASE);

/**
 * The liquidity multiplier (LM): how much more liquidity the position provides at the current price than a
 * full-range position holding the same value would.
 *
 * Holding liquidity L over [pa, pb] at a price P inside the range is worth L(2√P − √pa − P/√pb) in token1, while
 * full range is worth 2L√P. For equal value the ratio of liquidities is
 *
 *   LM = 2 / (2 − √(pa/P) − √(P/pb))
 *
 * which for a range centred on the price reduces to the familiar 1 / (1 − (pa/pb)^¼). Full range is 1. Out of
 * range the position earns nothing at the current price, so LM describes the range's width instead, with the
 * centred form. Returns null when the price or ticks are unreadable.
 */
export function liquidityMultiplier(tickLower: number, tickUpper: number, sqrtPriceX96: string | bigint | null | undefined): number | null {
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickUpper <= tickLower) return null;
  const tick = currentTick(sqrtPriceX96);
  if (tick === null) return null;
  if (tick >= tickLower && tick < tickUpper) {
    const below = sqrtRatio(tickLower - tick);
    const above = sqrtRatio(tick - tickUpper);
    return 2 / (2 - below - above);
  }
  return 1 / (1 - sqrtRatio((tickLower - tickUpper) / 2));
}

/** Highest LM shown as a number; anything above reads as ">10,000x". One tick spacing on a stable pair is about 4,000x. */
export const LM_DISPLAY_CAP = 10_000;

/** An LM for display: "1x" for full range, one decimal below 10, whole numbers up to the cap, then ">10,000x". */
export function formatMultiplier(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value > LM_DISPLAY_CAP) return `>${LM_DISPLAY_CAP.toLocaleString("en-US")}x`;
  if (value < 1.05) return "1x";
  if (value < 10) return `${value.toFixed(1)}x`;
  return `${Math.round(value).toLocaleString("en-US")}x`;
}

/**
 * Where the current price sits within the range, as a fraction of the range in tick space from 0 (lower bound)
 * to 1 (upper bound), clamped, with whether it is inside. Null when the price or ticks are unreadable.
 */
export function rangeMarker(tickLower: number, tickUpper: number, sqrtPriceX96: string | bigint | null | undefined): { fraction: number; inRange: boolean } | null {
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickUpper <= tickLower) return null;
  const tick = currentTick(sqrtPriceX96);
  if (tick === null) return null;
  const fraction = Math.min(1, Math.max(0, (tick - tickLower) / (tickUpper - tickLower)));
  return { fraction, inRange: tick >= tickLower && tick < tickUpper };
}

/**
 * The share of the position's value in each token, as whole percentages that add up to 100, valuing token0 in
 * token1 at the pool's price. Null when the amounts or price are unreadable or the position holds nothing.
 */
export function tokenSplit(amount0: string | number, amount1: string | number, price1Per0: number): [number, number] | null {
  const value0 = Number(amount0) * price1Per0;
  const value1 = Number(amount1);
  if (!Number.isFinite(value0) || !Number.isFinite(value1) || value0 < 0 || value1 < 0) return null;
  const total = value0 + value1;
  if (total <= 0) return null;
  const share0 = Math.round((value0 / total) * 100);
  return [share0, 100 - share0];
}

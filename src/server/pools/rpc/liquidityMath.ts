import "server-only";

import { getAmountsForLiquidity, getSqrtPriceAtTick } from "@/lib/v4/liquidityMath";

// The concentrated-liquidity math is shared with the browser (src/lib/v4/liquidityMath.ts); the pipeline's own
// helpers below build on it.
export {
  Q96,
  MIN_TICK,
  MAX_TICK,
  getSqrtPriceAtTick,
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  getAmountsForLiquidity,
  priceOfToken0InToken1,
} from "@/lib/v4/liquidityMath";

/**
 * Token amounts of every range in `ranges` (keyed `"<tickLower>:<tickUpper>"`, net liquidity) at `sqrtPrice`.
 * This is the principal the positions hold; fees they have earned but not collected are not included.
 */
export function amountsForRanges(ranges: ReadonlyMap<string, bigint>, sqrtPrice: bigint): { amount0: bigint; amount1: bigint } {
  let amount0 = 0n;
  let amount1 = 0n;
  for (const [key, liquidity] of ranges) {
    if (liquidity <= 0n) continue;
    const [lower, upper] = key.split(":").map(Number);
    const amounts = getAmountsForLiquidity(sqrtPrice, getSqrtPriceAtTick(lower), getSqrtPriceAtTick(upper), liquidity);
    amount0 += amounts.amount0;
    amount1 += amounts.amount1;
  }
  return { amount0, amount1 };
}

/** A raw token amount in whole-token units. */
export function toUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

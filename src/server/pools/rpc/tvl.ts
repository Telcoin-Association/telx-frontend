import "server-only";

import { amountsForRanges } from "./liquidityMath";
import type { PoolSnapshot } from "./snapshot";

/**
 * Pool reserves for TVL. The primary source is ReservesLens (core amounts the PoolManager holds for the pool);
 * the fallback is the position sum: the net liquidity of every tick range, rebuilt from ModifyLiquidity events
 * since the pool's creation, converted to token amounts at the current price. Neither counts fees LPs have
 * earned but not collected.
 */

export type Reserves = { amount0: bigint; amount1: bigint; source: "lens" | "positions" };

/** Token amounts of the pool's positions at the snapshot price, or null without a price. */
export function positionSum(ranges: ReadonlyMap<string, bigint>, snapshot: PoolSnapshot | undefined): { amount0: bigint; amount1: bigint } | null {
  const sqrtPrice = snapshot?.slot0?.sqrtPriceX96;
  if (!sqrtPrice) return null;
  return amountsForRanges(ranges, sqrtPrice);
}

/** Reserves from the lens when `useLens` and the lens answered, else from the position sum. */
export function poolReserves(ranges: ReadonlyMap<string, bigint>, snapshot: PoolSnapshot | undefined, useLens: boolean): Reserves | null {
  if (useLens && snapshot?.reserves) return { ...snapshot.reserves, source: "lens" };
  const sum = positionSum(ranges, snapshot);
  return sum && { ...sum, source: "positions" };
}

export function reservesUsd(
  reserves: Pick<Reserves, "amount0" | "amount1">,
  decimals: readonly [number, number],
  prices: readonly [number, number],
): number {
  return (Number(reserves.amount0) / 10 ** decimals[0]) * prices[0] + (Number(reserves.amount1) / 10 ** decimals[1]) * prices[1];
}

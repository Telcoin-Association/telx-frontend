import "server-only";

/**
 * Concentrated-liquidity math shared by Uniswap v3 and v4, in bigint so that it matches the contracts:
 * `getSqrtPriceAtTick` is TickMath, and the amount helpers are LiquidityAmounts from v3-periphery.
 */

export const Q96 = 2n ** 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

const MAX_UINT256 = 2n ** 256n - 1n;

/** sqrt(1.0001^tick) as a Q64.96, exactly as TickMath.getSqrtPriceAtTick computes it. */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new RangeError(`tick ${tick} out of range`);
  const absTick = BigInt(Math.abs(tick));

  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const steps: [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, factor] of steps) {
    if ((absTick & bit) !== 0n) ratio = (ratio * factor) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;

  // Q128.128 to Q64.96, rounding up.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function ordered(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b];
}

/** Token0 held by `liquidity` between two sqrt prices, rounded down. */
export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (lower === 0n) return 0n;
  return ((liquidity << 96n) * (upper - lower)) / upper / lower;
}

/** Token1 held by `liquidity` between two sqrt prices, rounded down. */
export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  return (liquidity * (upper - lower)) / Q96;
}

/** Token amounts of a position with `liquidity` in `[sqrtA, sqrtB]` at the pool price `sqrtPrice`. */
export function getAmountsForLiquidity(sqrtPrice: bigint, sqrtA: bigint, sqrtB: bigint, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (sqrtPrice <= lower) return { amount0: getAmount0ForLiquidity(lower, upper, liquidity), amount1: 0n };
  if (sqrtPrice < upper) {
    return { amount0: getAmount0ForLiquidity(sqrtPrice, upper, liquidity), amount1: getAmount1ForLiquidity(lower, sqrtPrice, liquidity) };
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(lower, upper, liquidity) };
}

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

/** Token1 per token0 in whole-token units, from a Q64.96 sqrt price. Null for a zero (uninitialized) price. */
export function priceOfToken0InToken1(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  // A uint160 converts to a double with full relative precision, so the ratio keeps ~16 significant digits.
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  const price = sqrt * sqrt * 10 ** (decimals0 - decimals1);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** A raw token amount in whole-token units. */
export function toUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

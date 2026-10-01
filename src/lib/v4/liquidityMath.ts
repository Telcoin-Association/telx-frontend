/**
 * Concentrated-liquidity math shared by Uniswap v3 and v4, in bigint so that it matches the contracts:
 * `getSqrtPriceAtTick` is TickMath, and the liquidity and amount helpers are LiquidityAmounts from v3-periphery.
 * Pure functions, safe in the browser and on the server.
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

/** a * b / denominator, rounded up. */
function mulDivUp(a: bigint, b: bigint, denominator: bigint): bigint {
  const product = a * b;
  return product / denominator + (product % denominator === 0n ? 0n : 1n);
}

/** Token0 held by `liquidity` between two sqrt prices, rounded down, or up with `roundUp` (what a mint pays). */
export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp = false): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (lower === 0n) return 0n;
  if (!roundUp) return ((liquidity << 96n) * (upper - lower)) / upper / lower;
  return mulDivUp(mulDivUp(liquidity << 96n, upper - lower, upper), 1n, lower);
}

/** Token1 held by `liquidity` between two sqrt prices, rounded down, or up with `roundUp` (what a mint pays). */
export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp = false): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  return roundUp ? mulDivUp(liquidity, upper - lower, Q96) : (liquidity * (upper - lower)) / Q96;
}

/** Token amounts of a position with `liquidity` in `[sqrtA, sqrtB]` at the pool price `sqrtPrice`. */
export function getAmountsForLiquidity(
  sqrtPrice: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
  roundUp = false,
): { amount0: bigint; amount1: bigint } {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (sqrtPrice <= lower) return { amount0: getAmount0ForLiquidity(lower, upper, liquidity, roundUp), amount1: 0n };
  if (sqrtPrice < upper) {
    return {
      amount0: getAmount0ForLiquidity(sqrtPrice, upper, liquidity, roundUp),
      amount1: getAmount1ForLiquidity(lower, sqrtPrice, liquidity, roundUp),
    };
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(lower, upper, liquidity, roundUp) };
}

/** The liquidity `amount0` of token0 buys between two sqrt prices, rounded down. */
export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (upper === lower) return 0n;
  return (amount0 * ((lower * upper) / Q96)) / (upper - lower);
}

/** The liquidity `amount1` of token1 buys between two sqrt prices, rounded down. */
export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (upper === lower) return 0n;
  return (amount1 * Q96) / (upper - lower);
}

/** The most liquidity `amount0` and `amount1` can both pay for in `[sqrtA, sqrtB]` at `sqrtPrice`. */
export function getLiquidityForAmounts(sqrtPrice: bigint, sqrtA: bigint, sqrtB: bigint, amount0: bigint, amount1: bigint): bigint {
  const [lower, upper] = ordered(sqrtA, sqrtB);
  if (sqrtPrice <= lower) return getLiquidityForAmount0(lower, upper, amount0);
  if (sqrtPrice < upper) {
    const liquidity0 = getLiquidityForAmount0(sqrtPrice, upper, amount0);
    const liquidity1 = getLiquidityForAmount1(lower, sqrtPrice, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }
  return getLiquidityForAmount1(lower, upper, amount1);
}

/** Token1 per token0 in whole-token units, from a Q64.96 sqrt price. Null for a zero (uninitialized) price. */
export function priceOfToken0InToken1(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  // A uint160 converts to a double with full relative precision, so the ratio keeps ~16 significant digits.
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  const price = sqrt * sqrt * 10 ** (decimals0 - decimals1);
  return Number.isFinite(price) && price > 0 ? price : null;
}

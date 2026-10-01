import {
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  getAmountsForLiquidity,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getLiquidityForAmounts,
  getSqrtPriceAtTick,
  MAX_TICK,
  MIN_TICK,
  priceOfToken0InToken1,
  Q96,
} from "./liquidityMath";

describe("getSqrtPriceAtTick", () => {
  it("matches TickMath at tick 0 and the bounds", () => {
    expect(getSqrtPriceAtTick(0)).toBe(Q96);
    expect(getSqrtPriceAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("rejects ticks outside the bounds", () => {
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow(RangeError);
    expect(() => getSqrtPriceAtTick(0.5)).toThrow(RangeError);
  });
});

describe("liquidity from amounts", () => {
  const sqrtA = getSqrtPriceAtTick(-600);
  const sqrtB = getSqrtPriceAtTick(600);
  const sqrtP = Q96; // tick 0, inside the range

  it("matches LiquidityAmounts on each side", () => {
    // L0 = amount0 * (sqrtA * sqrtB / Q96) / (sqrtB - sqrtA); L1 = amount1 * Q96 / (sqrtB - sqrtA)
    expect(getLiquidityForAmount0(sqrtA, sqrtB, 10n ** 18n)).toBe((10n ** 18n * ((sqrtA * sqrtB) / Q96)) / (sqrtB - sqrtA));
    expect(getLiquidityForAmount1(sqrtA, sqrtB, 10n ** 18n)).toBe((10n ** 18n * Q96) / (sqrtB - sqrtA));
    expect(getLiquidityForAmount0(sqrtA, sqrtA, 1n)).toBe(0n);
  });

  it("takes the smaller side inside the range, and one side outside it", () => {
    const l = getLiquidityForAmounts(sqrtP, sqrtA, sqrtB, 10n ** 18n, 5n * 10n ** 17n);
    expect(l).toBe(getLiquidityForAmount1(sqrtA, sqrtP, 5n * 10n ** 17n));
    expect(getLiquidityForAmounts(getSqrtPriceAtTick(-1000), sqrtA, sqrtB, 10n ** 18n, 0n)).toBe(getLiquidityForAmount0(sqrtA, sqrtB, 10n ** 18n));
    expect(getLiquidityForAmounts(getSqrtPriceAtTick(1000), sqrtA, sqrtB, 0n, 10n ** 18n)).toBe(getLiquidityForAmount1(sqrtA, sqrtB, 10n ** 18n));
  });

  it("round trips: the amounts a mint pays for that liquidity fit within what was offered", () => {
    for (const [a0, a1] of [
      [10n ** 18n, 10n ** 18n],
      [123456789n, 987654321987654321n],
      [5n * 10n ** 6n, 7n * 10n ** 21n],
    ]) {
      const l = getLiquidityForAmounts(sqrtP, sqrtA, sqrtB, a0, a1);
      const paid = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, l, true);
      expect(paid.amount0).toBeLessThanOrEqual(a0);
      expect(paid.amount1).toBeLessThanOrEqual(a1);
      // The limiting side is used almost entirely.
      const limiting = paid.amount0 * a1 <= paid.amount1 * a0 ? paid.amount1 * 1000n >= a1 * 999n : paid.amount0 * 1000n >= a0 * 999n;
      expect(limiting).toBe(true);
    }
  });

  it("rounds a mint's payment up and a holding down", () => {
    const l = 10n ** 12n + 7n;
    expect(getAmount0ForLiquidity(sqrtA, sqrtB, l, true)).toBeGreaterThanOrEqual(getAmount0ForLiquidity(sqrtA, sqrtB, l));
    expect(getAmount1ForLiquidity(sqrtA, sqrtB, l, true) - getAmount1ForLiquidity(sqrtA, sqrtB, l)).toBeLessThanOrEqual(1n);
  });
});

describe("priceOfToken0InToken1", () => {
  it("scales by the decimals", () => {
    expect(priceOfToken0InToken1(Q96, 18, 18)).toBe(1);
    expect(priceOfToken0InToken1(Q96, 18, 6)).toBeCloseTo(1e12);
    expect(priceOfToken0InToken1(0n, 18, 18)).toBeNull();
  });
});

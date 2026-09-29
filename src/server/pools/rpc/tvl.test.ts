/**
 * @jest-environment node
 */
import { MAX_TICK, MIN_TICK, Q96, amountsForRanges, getAmountsForLiquidity, getSqrtPriceAtTick, priceOfToken0InToken1 } from "./liquidityMath";
import type { PoolSnapshot } from "./snapshot";
import { poolReserves, positionSum, reservesUsd } from "./tvl";

/** sqrt(reserve1 / reserve0) as a Q64.96, as v3-periphery's tests encode prices. */
function encodePriceSqrt(reserve1: bigint, reserve0: bigint): bigint {
  const value = (reserve1 << 192n) / reserve0;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

describe("getSqrtPriceAtTick", () => {
  it("matches TickMath at the ends of the range and at zero", () => {
    expect(getSqrtPriceAtTick(0)).toBe(Q96);
    expect(getSqrtPriceAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("matches sqrt(1.0001^tick) for every bit of the tick", () => {
    for (let bit = 0; bit < 20; bit++) {
      for (const tick of [1 << bit, -(1 << bit)]) {
        if (tick > MAX_TICK || tick < MIN_TICK) continue;
        const expected = Math.sqrt(1.0001 ** tick);
        expect(Number(getSqrtPriceAtTick(tick)) / 2 ** 96 / expected).toBeCloseTo(1, 9);
      }
    }
  });

  it("rejects ticks outside the range", () => {
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow(RangeError);
  });
});

describe("getAmountsForLiquidity (v3-periphery LiquidityAmounts vectors)", () => {
  const sqrtA = encodePriceSqrt(100n, 110n);
  const sqrtB = encodePriceSqrt(110n, 100n);

  it("holds both tokens when the price is inside the range", () => {
    expect(getAmountsForLiquidity(encodePriceSqrt(1n, 1n), sqrtA, sqrtB, 2148n)).toEqual({ amount0: 99n, amount1: 99n });
  });

  it("holds only token0 below the range", () => {
    expect(getAmountsForLiquidity(encodePriceSqrt(99n, 110n), sqrtA, sqrtB, 1048n)).toEqual({ amount0: 99n, amount1: 0n });
  });

  it("holds only token1 above the range", () => {
    expect(getAmountsForLiquidity(encodePriceSqrt(111n, 100n), sqrtA, sqrtB, 2097n)).toEqual({ amount0: 0n, amount1: 199n });
  });

  it("gives the same amounts whichever order the bounds come in", () => {
    expect(getAmountsForLiquidity(encodePriceSqrt(1n, 1n), sqrtB, sqrtA, 2148n)).toEqual({ amount0: 99n, amount1: 99n });
  });
});

describe("position sum", () => {
  // A range below, one around and one above tick 0.
  const ranges = new Map([
    ["-120:-60", 10n ** 18n],
    ["-60:60", 2n * 10n ** 18n],
    ["60:120", 10n ** 18n],
  ]);
  const at = (sqrtPriceX96: bigint | null, reserves: PoolSnapshot["reserves"] = null): PoolSnapshot => ({
    reserves,
    slot0: sqrtPriceX96 === null ? null : { sqrtPriceX96, tick: 0, protocolFee: 0, lpFee: 3000 },
    liquidity: null,
  });

  it("adds the ranges' amounts at the current price: token1 below, both around, token0 above", () => {
    const sum = positionSum(ranges, at(Q96))!;
    const below = getAmountsForLiquidity(Q96, getSqrtPriceAtTick(-120), getSqrtPriceAtTick(-60), 10n ** 18n);
    const around = getAmountsForLiquidity(Q96, getSqrtPriceAtTick(-60), getSqrtPriceAtTick(60), 2n * 10n ** 18n);
    const above = getAmountsForLiquidity(Q96, getSqrtPriceAtTick(60), getSqrtPriceAtTick(120), 10n ** 18n);

    expect(below.amount0).toBe(0n);
    expect(above.amount1).toBe(0n);
    expect(sum).toEqual({ amount0: around.amount0 + above.amount0, amount1: below.amount1 + around.amount1 });
    expect(amountsForRanges(new Map([["-60:60", 0n]]), Q96)).toEqual({ amount0: 0n, amount1: 0n });
  });

  it("is unknown without a price", () => {
    expect(positionSum(ranges, at(null))).toBeNull();
    expect(positionSum(ranges, undefined)).toBeNull();
  });

  it("takes reserves from the lens when asked and it answered, else from the position sum", () => {
    const lens = { amount0: 5n, amount1: 7n };
    expect(poolReserves(ranges, at(Q96, lens), true)).toEqual({ ...lens, source: "lens" });
    expect(poolReserves(ranges, at(Q96, lens), false)?.source).toBe("positions");
    expect(poolReserves(ranges, at(Q96, null), true)?.source).toBe("positions");
    expect(poolReserves(ranges, at(null, null), true)).toBeNull();
  });

  it("values reserves in USD", () => {
    expect(reservesUsd({ amount0: 2n * 10n ** 18n, amount1: 3n * 10n ** 6n }, [18, 6], [2000, 1])).toBeCloseTo(4003, 9);
  });
});

describe("priceOfToken0InToken1", () => {
  it("converts a sqrt price to whole-token units", () => {
    expect(priceOfToken0InToken1(1000n * Q96, 18, 18)).toBeCloseTo(1_000_000, 6);
    expect(priceOfToken0InToken1(Q96, 6, 18)).toBeCloseTo(1e-12, 24);
    expect(priceOfToken0InToken1(0n, 18, 18)).toBeNull();
  });
});

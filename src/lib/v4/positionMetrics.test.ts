import { formatSqrtPriceX96 } from "@/app/api/backendHelpers/helpers";
import { currentTick, formatMultiplier, isFullRangeTicks, liquidityMultiplier, rangeMarker, rangePrices, rangeState } from "./positionMetrics";
import { priceAtTick } from "./range";

const Q96 = 2 ** 96;
/** sqrtPriceX96 for a pool sitting exactly at `tick`. */
const atTick = (tick: number) => BigInt(Math.round(Math.sqrt(1.0001 ** tick) * Q96)).toString();
const MIN_TICK = -887220;
const MAX_TICK = 887220;

describe("currentTick", () => {
  it("reads the tick from sqrtPriceX96, and null when unreadable", () => {
    expect(currentTick(atTick(0))).toBeCloseTo(0, 6);
    expect(currentTick(atTick(28_753))).toBeCloseTo(28_753, 3);
    expect(currentTick(null)).toBeNull();
    expect(currentTick("0")).toBeNull();
    expect(currentTick("not a number")).toBeNull();
  });
});

describe("liquidityMultiplier", () => {
  it("is 1 for full range", () => {
    expect(liquidityMultiplier(MIN_TICK, MAX_TICK, atTick(0))).toBeCloseTo(1, 6);
  });

  it("matches 1 / (1 - (pa/pb)^(1/4)) for a range centred on the price", () => {
    const width = 1_000;
    const centred = 1 / (1 - 1.0001 ** (-width / 2 / 2));
    expect(liquidityMultiplier(-width / 2, width / 2, atTick(0))).toBeCloseTo(centred, 6);
  });

  it("is about 20x for a ±10% range, the usual figure", () => {
    // pa = 0.9P, pb = 1.1P: 2 / (2 - √0.9 - √(1/1.1)) ≈ 20.4
    const lower = Math.log(0.9) / Math.log(1.0001);
    const upper = Math.log(1.1) / Math.log(1.0001);
    expect(liquidityMultiplier(lower, upper, atTick(0))).toBeCloseTo(20.4, 1);
  });

  it("uses the exact form for the position's actual range when the price is off centre", () => {
    expect(liquidityMultiplier(-900, 100, atTick(0))).toBeCloseTo(2 / (2 - 1.0001 ** (-900 / 2) - 1.0001 ** (-100 / 2)), 6);
    expect(liquidityMultiplier(-900, 100, atTick(-400))).toBeCloseTo(2 / (2 - 1.0001 ** (-500 / 2) - 1.0001 ** (-500 / 2)), 4);
  });

  it("falls back to the range's width when the price is outside it", () => {
    expect(liquidityMultiplier(60, 120, atTick(0))).toBeCloseTo(1 / (1 - 1.0001 ** -15), 6);
    expect(liquidityMultiplier(-120, -60, atTick(0))).toBeCloseTo(1 / (1 - 1.0001 ** -15), 6);
  });

  it("is null for unreadable input", () => {
    expect(liquidityMultiplier(10, 10, atTick(0))).toBeNull();
    expect(liquidityMultiplier(20, 10, atTick(0))).toBeNull();
    expect(liquidityMultiplier(-10, 10, null)).toBeNull();
  });
});

describe("formatMultiplier", () => {
  it("reads 1x for full range, one decimal below 10, whole numbers up to the cap, and caps above it", () => {
    expect(formatMultiplier(1.0000001)).toBe("1x");
    expect(formatMultiplier(3.24)).toBe("3.2x");
    expect(formatMultiplier(20.4)).toBe("20x");
    expect(formatMultiplier(4_000.4)).toBe("4,000x");
    expect(formatMultiplier(10_000)).toBe("10,000x");
    expect(formatMultiplier(10_001)).toBe(">10,000x");
    expect(formatMultiplier(null)).toBeNull();
    expect(formatMultiplier(Number.NaN)).toBeNull();
  });
});

describe("rangeMarker", () => {
  it("places the price within the range in tick space", () => {
    expect(rangeMarker(-100, 100, atTick(0))).toEqual({ fraction: expect.closeTo(0.5, 6), inRange: true });
    expect(rangeMarker(-100, 300, atTick(0))).toEqual({ fraction: expect.closeTo(0.25, 6), inRange: true });
  });

  it("rests at the edge the price left from when out of range", () => {
    expect(rangeMarker(60, 120, atTick(0))).toEqual({ fraction: 0, inRange: false });
    expect(rangeMarker(-120, -60, atTick(0))).toEqual({ fraction: 1, inRange: false });
  });

  it("is null for unreadable input", () => {
    expect(rangeMarker(0, 0, atTick(0))).toBeNull();
    expect(rangeMarker(-1, 1, undefined)).toBeNull();
  });
});


describe("isFullRangeTicks", () => {
  it("is true only when both bounds reach the usable tick limits", () => {
    expect(isFullRangeTicks(MIN_TICK, MAX_TICK)).toBe(true);
    expect(isFullRangeTicks(-887_272, 887_272)).toBe(true);
    expect(isFullRangeTicks(MIN_TICK, 140_160)).toBe(false);
    expect(isFullRangeTicks(136_080, 140_160)).toBe(false);
  });
});

describe("rangeState", () => {
  it("is full for a full-range position, whatever the price", () => {
    expect(rangeState(MIN_TICK, MAX_TICK, atTick(500_000))).toEqual({ kind: "full" });
  });

  it("is in range away from the edges, near within a tenth of the width of either edge, and out beyond them", () => {
    expect(rangeState(0, 1000, atTick(500))).toEqual({ kind: "in", fraction: expect.closeTo(0.5, 3) });
    expect(rangeState(0, 1000, atTick(50))).toEqual({ kind: "near", fraction: expect.closeTo(0.05, 3) });
    expect(rangeState(0, 1000, atTick(950))).toEqual({ kind: "near", fraction: expect.closeTo(0.95, 3) });
    expect(rangeState(0, 1000, atTick(1500))).toEqual({ kind: "out", fraction: 1 });
    expect(rangeState(0, 1000, atTick(-20))).toEqual({ kind: "out", fraction: 0 });
  });

  it("is null when the price or ticks are unreadable", () => {
    expect(rangeState(0, 1000, null)).toBeNull();
    expect(rangeState(1000, 0, atTick(500))).toBeNull();
  });
});

describe("rangePrices", () => {
  it("scales the current price by the tick distance to each bound", () => {
    const prices = rangePrices(-1000, 1000, atTick(0), 2000)!;
    expect(prices.current).toBe(2000);
    expect(prices.min).toBeCloseTo(2000 * 1.0001 ** -1000, 6);
    expect(prices.max).toBeCloseTo(2000 * 1.0001 ** 1000, 6);
  });

  it("leaves a bound at the edge of the tick space open: 0 below, Infinity above", () => {
    expect(rangePrices(MIN_TICK, 1000, atTick(0), 2000)!.min).toBe(0);
    expect(rangePrices(-1000, MAX_TICK, atTick(0), 2000)!.max).toBe(Number.POSITIVE_INFINITY);
    expect(rangePrices(-887_272, 887_272, atTick(0), 2000)).toMatchObject({ min: 0, max: Number.POSITIVE_INFINITY });
    expect(rangePrices(-886_000, 886_000, atTick(0), 2000)!.max).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  describe("on the eUSD/TEL pool (eUSD token0 with 6 decimals, TEL token1 with 18)", () => {
    // TEL at about 546 per eUSD sits near tick 339,360 once the 12-decimal gap is included.
    const sqrtPriceX96 = atTick(339_360);
    const price1Per0 = formatSqrtPriceX96(sqrtPriceX96, 6, 18);

    it("reads the pool price in TEL per eUSD, the same orientation as the add-liquidity form", () => {
      expect(price1Per0).toBeCloseTo(546.4, 0);
      expect(price1Per0).toBeCloseTo(priceAtTick(339_360, 6, 18), 6);
    });

    it("gives bounds equal to the decimal-adjusted price at each tick", () => {
      const prices = rangePrices(206_700, 343_140, sqrtPriceX96, price1Per0)!;
      expect(prices.min / priceAtTick(206_700, 6, 18)).toBeCloseTo(1, 9);
      expect(prices.max / priceAtTick(343_140, 6, 18)).toBeCloseTo(1, 9);
      expect(prices.min).toBeCloseTo(0.000947, 6);
      expect(prices.max).toBeCloseTo(797.3, 1);
    });

    it("opens the range from tick 206,700 up to the maximum tick", () => {
      const prices = rangePrices(206_700, MAX_TICK, sqrtPriceX96, price1Per0)!;
      expect(prices.min).toBeCloseTo(0.000947, 6);
      expect(prices.max).toBe(Number.POSITIVE_INFINITY);
    });

    it("opens the range from the minimum tick up to tick 343,140", () => {
      const prices = rangePrices(MIN_TICK, 343_140, sqrtPriceX96, price1Per0)!;
      expect(prices.min).toBe(0);
      expect(prices.max).toBeCloseTo(797.3, 1);
    });
  });

  it("is null without a readable price", () => {
    expect(rangePrices(-1000, 1000, null, 2000)).toBeNull();
    expect(rangePrices(-1000, 1000, atTick(0), Number.NaN)).toBeNull();
  });
});

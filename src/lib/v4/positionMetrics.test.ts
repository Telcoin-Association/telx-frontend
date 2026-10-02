import { currentTick, formatMultiplier, liquidityMultiplier, rangeMarker, tokenSplit } from "./positionMetrics";

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

describe("tokenSplit", () => {
  it("values token0 in token1 at the pool price and gives whole percentages adding up to 100", () => {
    expect(tokenSplit("1", "3000", 2000)).toEqual([40, 60]);
    expect(tokenSplit("0.4537", "0.5463", 1)).toEqual([45, 55]);
    expect(tokenSplit("0", "5", 2000)).toEqual([0, 100]);
  });

  it("is null when the position holds nothing or the figures are unreadable", () => {
    expect(tokenSplit("0", "0", 1)).toBeNull();
    expect(tokenSplit("x", "1", 1)).toBeNull();
    expect(tokenSplit("1", "1", Number.NaN)).toBeNull();
  });
});

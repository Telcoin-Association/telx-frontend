import {
  customRange,
  isFullRangeTicks,
  presetRange,
  priceAtTick,
  rangeProblem,
  tickAtPrice,
  usableTickBounds,
  withSlippage,
} from "./range";

const SPACING = 60;
const TICK = 140_355; // WETH/TEL on Polygon, about 1.25M TEL per WETH

describe("ticks and prices", () => {
  it("finds the usable bounds for a tick spacing", () => {
    expect(usableTickBounds(60)).toEqual({ tickLower: -887_220, tickUpper: 887_220 });
    expect(usableTickBounds(10)).toEqual({ tickLower: -887_270, tickUpper: 887_270 });
  });

  it("converts between whole-unit prices and ticks, with the decimals", () => {
    expect(tickAtPrice(1, 18, 18)).toBeCloseTo(0);
    expect(priceAtTick(tickAtPrice(1_250_000, 18, 18), 18, 18)).toBeCloseTo(1_250_000, 0);
    expect(priceAtTick(tickAtPrice(0.0548, 6, 6), 6, 6)).toBeCloseTo(0.0548, 6);
  });
});

describe("presetRange", () => {
  it("returns the usable bounds for full range", () => {
    const full = presetRange("full", TICK, SPACING);
    expect(full).toEqual(usableTickBounds(SPACING));
    expect(isFullRangeTicks(full, SPACING)).toBe(true);
  });

  it("widens a percentage range outwards to the tick spacing around the current tick", () => {
    for (const preset of ["10", "25"] as const) {
      const range = presetRange(preset, TICK, SPACING);
      expect(range.tickLower % SPACING).toBe(0);
      expect(range.tickUpper % SPACING).toBe(0);
      expect(range.tickLower).toBeLessThanOrEqual(TICK);
      expect(range.tickUpper).toBeGreaterThan(TICK);
      const half = preset === "10" ? 0.1 : 0.25;
      expect(priceAtTick(range.tickLower, 18, 18)).toBeLessThanOrEqual(priceAtTick(TICK, 18, 18) * (1 - half));
      expect(priceAtTick(range.tickUpper, 18, 18)).toBeGreaterThanOrEqual(priceAtTick(TICK, 18, 18) * (1 + half));
      expect(rangeProblem(range, TICK, SPACING)).toBeNull();
    }
  });
});

describe("customRange and rangeProblem", () => {
  const price = priceAtTick(TICK, 18, 18);

  it("accepts a range at least 5% each side of the current price", () => {
    const range = customRange(price * 0.94, price * 1.06, 18, 18, SPACING);
    expect(range).not.toBeNull();
    expect(rangeProblem(range!, TICK, SPACING)).toBeNull();
  });

  it("rejects a range narrower than 5% on either side", () => {
    expect(rangeProblem(customRange(price * 0.97, price * 1.2, 18, 18, SPACING)!, TICK, SPACING)).toMatch(/at least 5% below and above/);
    expect(rangeProblem(customRange(price * 0.8, price * 1.02, 18, 18, SPACING)!, TICK, SPACING)).toMatch(/at least 5% below and above/);
  });

  it("rejects a range that does not include the current price, since the subscriber would refuse it", () => {
    expect(rangeProblem(customRange(price * 1.1, price * 1.5, 18, 18, SPACING)!, TICK, SPACING)).toMatch(/include the current price/);
    expect(rangeProblem(customRange(price * 0.5, price * 0.9, 18, 18, SPACING)!, TICK, SPACING)).toMatch(/include the current price/);
  });

  it("rejects misaligned, inverted and out-of-bounds ranges, and bad prices", () => {
    expect(rangeProblem({ tickLower: TICK - 7_000 + 1, tickUpper: TICK + 7_020 }, TICK, SPACING)).toMatch(/tick spacing/);
    expect(rangeProblem({ tickLower: 141_000, tickUpper: 139_980 }, TICK, SPACING)).toMatch(/below the upper price/);
    expect(rangeProblem({ tickLower: -887_280, tickUpper: 887_220 }, TICK, SPACING)).toMatch(/outside what the pool allows/);
    expect(customRange(0, price, 18, 18, SPACING)).toBeNull();
    expect(customRange(Number.NaN, price, 18, 18, SPACING)).toBeNull();
  });

  it("clamps a custom range to the usable bounds", () => {
    expect(customRange(1e-40, 1e40, 18, 18, SPACING)).toEqual(usableTickBounds(SPACING));
  });
});

describe("withSlippage", () => {
  it("adds basis points and rounds up", () => {
    expect(withSlippage(10_000n, 50)).toBe(10_050n);
    expect(withSlippage(1n, 50)).toBe(2n);
    expect(withSlippage(0n, 50)).toBe(0n);
  });
});

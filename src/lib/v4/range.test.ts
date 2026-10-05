import {
  customRange,
  formatHalfWidth,
  isFullRangeTicks,
  isNarrowRange,
  presetRange,
  priceAtTick,
  rangeHalfWidths,
  rangeProblem,
  rangeProfile,
  STABLE_RANGE_PROFILE,
  tickAtPrice,
  VOLATILE_RANGE_PROFILE,
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
    for (const preset of ["25", "10", "5", "1"] as const) {
      const range = presetRange(preset, TICK, SPACING);
      expect(range.tickLower % SPACING).toBe(0);
      expect(range.tickUpper % SPACING).toBe(0);
      expect(range.tickLower).toBeLessThanOrEqual(TICK);
      expect(range.tickUpper).toBeGreaterThan(TICK);
      const half = Number(preset) / 100;
      expect(priceAtTick(range.tickLower, 18, 18)).toBeLessThanOrEqual(priceAtTick(TICK, 18, 18) * (1 - half));
      expect(priceAtTick(range.tickUpper, 18, 18)).toBeGreaterThanOrEqual(priceAtTick(TICK, 18, 18) * (1 + half));
      expect(rangeProblem(range, TICK, SPACING)).toBeNull();
    }
  });
});

describe("customRange and rangeProblem", () => {
  const price = priceAtTick(TICK, 18, 18);

  it("accepts a volatile pair range of any width that contains the current price", () => {
    const range = customRange(price * 0.985, price * 1.015, 18, 18, SPACING);
    expect(range).not.toBeNull();
    expect(rangeProblem(range!, TICK, SPACING)).toBeNull();
    // Narrower than 1% on one side, then on the other: allowed, since there is no minimum width.
    expect(rangeProblem(customRange(price * 0.996, price * 1.2, 18, 18, SPACING)!, TICK, SPACING)).toBeNull();
    expect(rangeProblem(customRange(price * 0.8, price * 1.004, 18, 18, SPACING)!, TICK, SPACING)).toBeNull();
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

describe("range profiles", () => {
  // Polygon eUSD/eMXN: tick spacing 10, about 0.1% per spacing.
  const EMXN_POOL = "0xE604DF8F20F2FA4851DF502D4FAF470A6FA1BF5B5E1236E1DE14690EAEB7A135";
  const STABLE_SPACING = 10;
  const STABLE_TICK = 28_753;

  it("treats eUSD/eMXN as a stable pair and every other pool as volatile", () => {
    expect(rangeProfile(EMXN_POOL)).toBe(STABLE_RANGE_PROFILE);
    expect(rangeProfile(" 0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135 ")).toBe(STABLE_RANGE_PROFILE);
    expect(rangeProfile("0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d")).toBe(VOLATILE_RANGE_PROFILE);
    expect(rangeProfile(undefined)).toBe(VOLATILE_RANGE_PROFILE);
  });

  it("offers stable presets down to ±0.1% and volatile presets down to ±5%", () => {
    expect(STABLE_RANGE_PROFILE.presets).toEqual(["full", "1", "0.5", "0.1"]);
    expect(VOLATILE_RANGE_PROFILE.presets).toEqual(["full", "25", "10", "5"]);
    for (const preset of STABLE_RANGE_PROFILE.presets) {
      expect(rangeProblem(presetRange(preset, STABLE_TICK, STABLE_SPACING), STABLE_TICK, STABLE_SPACING)).toBeNull();
    }
    for (const preset of VOLATILE_RANGE_PROFILE.presets) {
      expect(rangeProblem(presetRange(preset, TICK, SPACING), TICK, SPACING)).toBeNull();
    }
  });

  it("lets any pool use a single tick spacing around the current price", () => {
    expect(rangeProblem({ tickLower: 28_750, tickUpper: 28_760 }, STABLE_TICK, STABLE_SPACING)).toBeNull();
    const volatileTick = Math.floor(TICK / SPACING) * SPACING;
    expect(rangeProblem({ tickLower: volatileTick, tickUpper: volatileTick + SPACING }, TICK, SPACING)).toBeNull();
    // Still refused when it leaves out the current price, or ignores the tick spacing.
    expect(rangeProblem({ tickLower: 28_760, tickUpper: 28_770 }, STABLE_TICK, STABLE_SPACING)).toMatch(/include the current price/);
    expect(rangeProblem({ tickLower: 28_751, tickUpper: 28_760 }, STABLE_TICK, STABLE_SPACING)).toMatch(/tick spacing/);
  });

  it("measures how far a range reaches each side of the current price", () => {
    const { below, above } = rangeHalfWidths({ tickLower: TICK - 100, tickUpper: TICK + 100 }, TICK);
    expect(below).toBeCloseTo(0.01, 3);
    expect(above).toBeCloseTo(0.01, 3);
  });

  it("warns below 5% for a volatile pair and below 0.5% for a stable pair, never for full range", () => {
    expect(isNarrowRange(presetRange("5", TICK, SPACING), TICK, SPACING, VOLATILE_RANGE_PROFILE)).toBe(false);
    expect(isNarrowRange(customRange(price(TICK) * 0.98, price(TICK) * 1.1, 18, 18, SPACING)!, TICK, SPACING, VOLATILE_RANGE_PROFILE)).toBe(true);
    expect(isNarrowRange(presetRange("0.5", STABLE_TICK, STABLE_SPACING), STABLE_TICK, STABLE_SPACING, STABLE_RANGE_PROFILE)).toBe(false);
    expect(isNarrowRange(presetRange("0.1", STABLE_TICK, STABLE_SPACING), STABLE_TICK, STABLE_SPACING, STABLE_RANGE_PROFILE)).toBe(true);
    expect(isNarrowRange(presetRange("full", STABLE_TICK, STABLE_SPACING), STABLE_TICK, STABLE_SPACING, STABLE_RANGE_PROFILE)).toBe(false);
  });

  it("formats half widths without trailing zeros", () => {
    expect(formatHalfWidth(0.01)).toBe("1%");
    expect(formatHalfWidth(0.005)).toBe("0.5%");
    expect(formatHalfWidth(0.05)).toBe("5%");
  });
});

function price(tick: number) {
  return priceAtTick(tick, 18, 18);
}

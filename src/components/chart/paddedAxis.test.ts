import { axisWidth, niceStep, paddedAxis, usdTickFormatter } from "./paddedAxis";

describe("paddedAxis", () => {
  it("pads the min and max across every value by 5% of the span instead of starting at zero", () => {
    const axis = paddedAxis([1_000, 1_050, null, 1_080, 1_100, 1_040])!;
    expect(axis.domain[0]).toBeCloseTo(995);
    expect(axis.domain[1]).toBeCloseTo(1_105);
    expect(axis.ticks[0]).toBeGreaterThanOrEqual(axis.domain[0]);
    expect(axis.ticks[axis.ticks.length - 1]).toBeLessThanOrEqual(axis.domain[1]);
    expect(axis.ticks).toEqual([1_000, 1_025, 1_050, 1_075, 1_100]);
  });

  it("pads by 5% of the value when every value is the same", () => {
    expect(paddedAxis([200, 200, 200])!.domain).toEqual([190, 210]);
    expect(paddedAxis([0, 0])!.domain).toEqual([0, 1]);
  });

  it("never drops below zero for values that are all zero or more, but pads negative values", () => {
    expect(paddedAxis([0, 100])!.domain).toEqual([0, 105]);
    expect(paddedAxis([-10, 10])!.domain).toEqual([-11, 11]);
  });

  it("ignores missing and non-finite values, and returns null with nothing to plot", () => {
    expect(paddedAxis([null, undefined, NaN, Infinity])).toBeNull();
    expect(paddedAxis([])).toBeNull();
    expect(paddedAxis([null, 5, undefined])!.domain).toEqual([4.75, 5.25]);
  });

  it("keeps ticks free of floating point noise", () => {
    const axis = paddedAxis([0.1, 0.3])!;
    for (const tick of axis.ticks) expect(String(tick)).toMatch(/^\d+(\.\d{1,3})?$/);
  });
});

describe("niceStep", () => {
  it("rounds up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(22)).toBe(25);
    expect(niceStep(27.5)).toBe(50);
    expect(niceStep(6_000)).toBe(10_000);
  });
});

describe("usdTickFormatter", () => {
  it("adds the decimals the step needs, so neighbouring ticks never read the same", () => {
    const axis = paddedAxis([1_000, 1_100])!;
    const labels = axis.ticks.map(usdTickFormatter(axis));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["$1.000K", "$1.025K", "$1.050K", "$1.075K", "$1.100K"]);
  });

  it("reads plain dollars below $1,000 and millions above", () => {
    const small = paddedAxis([12, 13])!;
    expect(small.ticks.map(usdTickFormatter(small))).toEqual(["$12.00", "$12.25", "$12.50", "$12.75", "$13.00"]);
    const large = paddedAxis([1_200_000, 1_600_000])!;
    expect(large.ticks.map(usdTickFormatter(large))).toEqual(["$1.2M", "$1.3M", "$1.4M", "$1.5M", "$1.6M"]);
  });
});

describe("axisWidth", () => {
  it("fits the widest label, so its first digit isn't clipped", () => {
    expect(axisWidth(["$1.025K", "$1.100K"])).toBeGreaterThanOrEqual(7 * 6.6);
    expect(axisWidth(["$1"])).toBe(40);
  });
});

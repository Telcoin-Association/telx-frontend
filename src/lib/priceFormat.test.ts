import { formatPrice, formatPriceDetail } from "./priceFormat";

describe("formatPrice", () => {
  it("shows normal prices in plain digits with three significant digits", () => {
    expect(formatPrice(546.123)).toBe("546");
    expect(formatPrice(4_980)).toBe("4,980");
    expect(formatPrice(1.23456)).toBe("1.23");
    expect(formatPrice(0.000947)).toBe("0.000947");
    expect(formatPrice(0.0001)).toBe("0.0001");
  });

  it("counts the leading zeros of tiny prices in subscript", () => {
    expect(formatPrice(0.0000025)).toBe("0.0₅25");
    expect(formatPrice(0.00001234)).toBe("0.0₄123");
    expect(formatPrice(2.9542784186117494e-51)).toBe("0.0₅₀295");
    expect(formatPrice(1e-100)).toBe("0.0₉₉1");
  });

  it("rounds a tiny price that carries up into plain digits", () => {
    expect(formatPrice(0.0000999999)).toBe("0.0001");
  });

  it("uses K, M, B and T up to 1,000T, then scientific notation", () => {
    expect(formatPrice(12_345)).toBe("12.3K");
    expect(formatPrice(1_163_700)).toBe("1.16M");
    expect(formatPrice(2.5e9)).toBe("2.5B");
    expect(formatPrice(338e12)).toBe("338T");
    expect(formatPrice(999.9e12)).toBe("1e15");
    expect(formatPrice(3.3849213185191664e26)).toBe("3.38e26");
    expect(formatPrice(Number.MAX_VALUE)).toBe("1.8e308");
  });

  it("never takes more than a few characters, at any magnitude", () => {
    for (let exponent = -320; exponent <= 308; exponent++) {
      for (const mantissa of [1, 2.5, 9.99]) {
        expect(formatPrice(mantissa * 10 ** exponent).length).toBeLessThanOrEqual(10);
      }
    }
  });

  it("reads 0 and ∞ for the open ends of a range, and Unavailable when missing", () => {
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(formatPrice(null)).toBe("Unavailable");
    expect(formatPrice(Number.NaN)).toBe("Unavailable");
  });
});

describe("formatPriceDetail", () => {
  it("gives more precision, switching to scientific notation at the extremes", () => {
    expect(formatPriceDetail(0.0009471486127615521)).toBe("0.00094714861");
    expect(formatPriceDetail(797.3257364067732)).toBe("797.32574");
    expect(formatPriceDetail(2.9542784186117494e-51)).toBe("2.9542784e-51");
    expect(formatPriceDetail(3.3849213185191664e26)).toBe("3.3849213e26");
    expect(formatPriceDetail(0)).toBe("0");
    expect(formatPriceDetail(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(formatPriceDetail(null)).toBe("Unavailable");
  });
});

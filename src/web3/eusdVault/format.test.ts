/** @jest-environment node */
import { formatAmount, formatTokenAmount } from "./format";

describe("formatTokenAmount", () => {
  it.each([
    ["1234567.5000", "1,234,567.5"],
    ["0", "0"],
    ["100.000", "100"],
    ["0.000001", "0.000001"],
    ["1000", "1,000"],
    ["12.30", "12.3"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatTokenAmount(input)).toBe(expected);
  });
});

describe("formatAmount", () => {
  it.each([
    [0n, 6, "0"],
    [1n, 6, "0.000001"],
    [999_999n, 6, "0.999999"],
    [1_000_000n, 6, "1"],
    [1_234_567_500_000n, 6, "1,234,567.5"],
    [123_456_789_012n, 6, "123,456.789012"],
    [1_000_000_000n, 6, "1,000"],
    [1_000_000_000_000_000_001n, 18, "1.000000000000000001"],
    [1234n, 0, "1,234"],
  ])("formats %p with %p decimals as %s", (value, decimals, expected) => {
    expect(formatAmount(value, decimals)).toBe(expected);
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatAmount(9_007_199_254_740_993n, 0)).toBe("9,007,199,254,740,993");
    expect(formatAmount(123_456_789_012_345_678_901_234_567_890_123_456n, 6)).toBe(
      "123,456,789,012,345,678,901,234,567,890.123456"
    );
  });
});

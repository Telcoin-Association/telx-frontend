/** @jest-environment node */
import { type AmountInput, maxAmountInput, parseAmountInput, sanitizeAmountInput, toWad } from "./amount";

const WAD = 10n ** 18n;
const USDC = 6;
const capsOff = { maxPerTransaction: 0n, maxPerBlock: 0n, decimals: USDC };

describe("sanitizeAmountInput", () => {
  const empty: AmountInput = { status: "empty" };
  const invalid: AmountInput = { status: "invalid" };
  const valid = (value: bigint): AmountInput => ({ status: "valid", value });

  // Typed or pasted, what the field then shows, and what that text parses to at 6 decimals.
  const cases: [string, string, AmountInput][] = [
    ["123.45", "123.45", valid(123_450_000n)],
    ["", "", empty],
    [".", ".", empty],
    [".5", ".5", valid(500_000n)],
    ["1.", "1.", valid(1_000_000n)],
    ["007", "007", valid(7_000_000n)],
    [",", ".", empty],
    ["0,", "0.", valid(0n)],
    [",5", ".5", valid(500_000n)],
    ["0,5", "0.5", valid(500_000n)],
    ["12,5", "12.5", valid(12_500_000n)],
    ["1,234", "1.234", valid(1_234_000n)],
    [" 1 000,50 USDC", "1000.50", valid(1_000_500_000n)],
    ["1,234.5", "1,234.5", invalid],
    ["1.000,50", "1.000,50", invalid],
    ["1,234,567", "1,234,567", invalid],
    ["12,50,1", "12,50,1", invalid],
    ["1.000.000", "1.000.000", invalid],
    ["1.2.3", "1.2.3", invalid],
    ["1.2.", "1.2.", invalid],
    ["1..2", "1..2", invalid],
    ["..5", "..5", invalid],
    ["1e5", "15", valid(15_000_000n)],
    ["12abc3", "123", valid(123_000_000n)],
    ["-5", "5", valid(5_000_000n)],
    ["+5", "5", valid(5_000_000n)],
    [" 1 234 ", "1234", valid(1_234_000_000n)],
    ["$10.50 USDC", "10.50", valid(10_500_000n)],
    ["１２", "", empty],
    ["١٢", "", empty],
  ];

  it.each(cases)("shows %j as %j", (raw, shown, parsed) => {
    expect(sanitizeAmountInput(raw)).toBe(shown);
    expect(parseAmountInput(shown, USDC)).toEqual(parsed);
  });

  it.each(cases)("leaves the text shown for %j unchanged when sanitised again", (_raw, shown) => {
    expect(sanitizeAmountInput(shown)).toBe(shown);
  });

  it.each([
    ["0,5", "0.5"],
    ["12,5", "12.5"],
    ["1,234.5", "1.234.5"],
    ["1.2.3", "1.2.3"],
  ])("shows %j typed one key at a time as %j", (keys, shown) => {
    let text = "";
    for (const key of keys) text = sanitizeAmountInput(text + key);
    expect(text).toBe(shown);
  });

  it("does not truncate fraction digits, so the parse can report the amount as too precise", () => {
    expect(sanitizeAmountInput("1.1234567")).toBe("1.1234567");
    expect(parseAmountInput(sanitizeAmountInput("1.1234567"), USDC)).toEqual({ status: "invalid" });
  });
});

describe("parseAmountInput", () => {
  it.each(["", "."])("treats %j as empty", text => {
    expect(parseAmountInput(text, USDC)).toEqual({ status: "empty" });
  });

  it.each(["0", "0.0", "000", "0.", ".0", "0.000000"])("parses %j as zero", text => {
    expect(parseAmountInput(text, USDC)).toEqual({ status: "valid", value: 0n });
  });

  it.each([
    ["1", 1_000_000n],
    ["1.", 1_000_000n],
    [".5", 500_000n],
    ["007.50", 7_500_000n],
    ["1234.5", 1_234_500_000n],
    ["1.123456", 1_123_456n],
    ["0.000001", 1n],
  ])("parses %j", (text, value) => {
    expect(parseAmountInput(text, USDC)).toEqual({ status: "valid", value });
  });

  it.each(["1.1234567", "0.0000001", "1.1000000"])("rejects %j for having more than 6 fraction digits", text => {
    expect(parseAmountInput(text, USDC)).toEqual({ status: "invalid" });
  });

  it.each(["1.2.3", "..", "abc", "1e5", "-1", "+1", " 1", "1 ", "1,000", "0x10", "１"])(
    "rejects %j as not digits with one optional dot",
    text => {
      expect(parseAmountInput(text, USDC)).toEqual({ status: "invalid" });
    }
  );

  it("honours the token's decimals", () => {
    expect(parseAmountInput("5", 0)).toEqual({ status: "valid", value: 5n });
    expect(parseAmountInput("5.", 0)).toEqual({ status: "valid", value: 5n });
    expect(parseAmountInput("5.5", 0)).toEqual({ status: "invalid" });
    expect(parseAmountInput("1.000000000000000001", 18)).toEqual({ status: "valid", value: WAD + 1n });
    expect(parseAmountInput("1.0000000000000000001", 18)).toEqual({ status: "invalid" });
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(parseAmountInput("123456789012345678901234567890.123456", USDC)).toEqual({
      status: "valid",
      value: 123_456_789_012_345_678_901_234_567_890_123_456n,
    });
    expect(parseAmountInput("9007199254740993", 0)).toEqual({ status: "valid", value: 9_007_199_254_740_993n });
  });
});

describe("toWad", () => {
  it("scales a 6-decimal amount by 1e12", () => {
    expect(toWad(1n, USDC)).toBe(10n ** 12n);
    expect(toWad(1_500_000n, USDC)).toBe(1_500_000_000_000_000_000n);
    expect(toWad(0n, USDC)).toBe(0n);
  });

  it("leaves an 18-decimal amount unchanged and scales a 0-decimal amount by 1e18", () => {
    expect(toWad(123n, 18)).toBe(123n);
    expect(toWad(2n, 0)).toBe(2n * WAD);
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(toWad(9_007_199_254_740_993n, USDC)).toBe(9_007_199_254_740_993_000_000_000_000n);
  });

  it("throws a RangeError for more than 18 decimals", () => {
    expect(() => toWad(1n, 19)).toThrow(RangeError);
  });
});

describe("maxAmountInput", () => {
  it("offers the exact balance string when nothing else binds", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 1_234_500_000n })).toBe("1234.5");
    expect(maxAmountInput({ ...capsOff, balanceIn: 1_234_567_890_123n })).toBe("1234567.890123");
    expect(maxAmountInput({ ...capsOff, balanceIn: 0n })).toBe("0");
    expect(maxAmountInput({ ...capsOff, balanceIn: 1_000_000_000_000n })).toBe("1000000");
  });

  it("clamps to the per-transaction cap", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, maxPerTransaction: 2n * WAD })).toBe("2");
  });

  it("clamps to the per-block cap", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, maxPerBlock: 3n * WAD })).toBe("3");
  });

  it("clamps to the output reserve", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, outputReserve: 4_250_000n })).toBe("4.25");
  });

  it("takes the lowest of the balance, both caps and the reserve", () => {
    const base = { balanceIn: 10_000_000n, maxPerTransaction: 8n * WAD, maxPerBlock: 6n * WAD, outputReserve: 4_000_000n };
    expect(maxAmountInput({ ...base, decimals: USDC })).toBe("4");
    expect(maxAmountInput({ ...base, outputReserve: undefined, decimals: USDC })).toBe("6");
    expect(maxAmountInput({ ...base, outputReserve: undefined, maxPerBlock: 0n, decimals: USDC })).toBe("8");
    expect(maxAmountInput({ ...base, balanceIn: 1_000_000n, decimals: USDC })).toBe("1");
  });

  it("treats a cap of 0 as off", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 7_000_000n })).toBe("7");
    expect(maxAmountInput({ ...capsOff, balanceIn: 7_000_000n, maxPerTransaction: 5n * WAD })).toBe("5");
    expect(maxAmountInput({ ...capsOff, balanceIn: 7_000_000n, maxPerBlock: 5n * WAD })).toBe("5");
  });

  it("treats a reserve of 0 as binding, unlike a cap of 0", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 7_000_000n, outputReserve: 0n })).toBe("0");
  });

  it("allows an amount equal to the cap", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, maxPerTransaction: 5n * WAD })).toBe("5");
  });

  it("rounds a cap that is not a whole number of token units down", () => {
    const cap = 1_500_000_000_000_000_000n + 999_999_999_999n;
    const max = maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, maxPerTransaction: cap });
    expect(max).toBe("1.5");
    const parsed = parseAmountInput(max, USDC);
    expect(parsed.status === "valid" && toWad(parsed.value, USDC) <= cap).toBe(true);
    expect(maxAmountInput({ ...capsOff, balanceIn: 5_000_000n, maxPerBlock: 10n ** 12n - 1n })).toBe("0");
  });

  it("does not scale caps for an 18-decimal token", () => {
    expect(maxAmountInput({ balanceIn: 5n * WAD, maxPerTransaction: WAD + 1n, maxPerBlock: 0n, decimals: 18 })).toBe(
      "1.000000000000000001"
    );
  });

  it("never offers a negative amount", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: -1n })).toBe("0");
  });

  it("throws a RangeError for more than 18 decimals", () => {
    expect(() => maxAmountInput({ ...capsOff, balanceIn: 1n, decimals: 19 })).toThrow(RangeError);
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(maxAmountInput({ ...capsOff, balanceIn: 9_007_199_254_740_993n })).toBe("9007199254.740993");
    expect(maxAmountInput({ ...capsOff, balanceIn: 123_456_789_012_345_678_901_234_567_890_123_456n })).toBe(
      "123456789012345678901234567890.123456"
    );
  });

  describe("round-trips through parseAmountInput", () => {
    const values = [
      0n,
      1n,
      10n,
      999_999n,
      1_000_000n,
      1_000_001n,
      1_234_500_000n,
      123_456_789_012n,
      9_007_199_254_740_993n,
      123_456_789_012_345_678_901_234_567_890_123_456n,
    ];

    it.each(values)("offers the balance %p as text that parses back to it", balanceIn => {
      expect(parseAmountInput(maxAmountInput({ ...capsOff, balanceIn }), USDC)).toEqual({
        status: "valid",
        value: balanceIn,
      });
    });

    it.each(values)("offers the reserve %p as text that parses back to it", outputReserve => {
      const balanceIn = outputReserve + 1n;
      expect(parseAmountInput(maxAmountInput({ ...capsOff, balanceIn, outputReserve }), USDC)).toEqual({
        status: "valid",
        value: outputReserve,
      });
    });

    it.each([0, 6, 18])("round-trips with %p decimals", decimals => {
      for (const balanceIn of values) {
        const text = maxAmountInput({ balanceIn, maxPerTransaction: 0n, maxPerBlock: 0n, decimals });
        expect(parseAmountInput(text, decimals)).toEqual({ status: "valid", value: balanceIn });
      }
    });

    it.each(values)("offers the balance %p as text that sanitising leaves unchanged", balanceIn => {
      const text = maxAmountInput({ ...capsOff, balanceIn });
      expect(sanitizeAmountInput(text)).toBe(text);
    });

    it("round-trips a cap-bound maximum that stays within the cap", () => {
      for (const units of values) {
        const cap = toWad(units, USDC) + 123n;
        const text = maxAmountInput({ ...capsOff, balanceIn: units + 5n, maxPerTransaction: cap, maxPerBlock: cap });
        expect(parseAmountInput(text, USDC)).toEqual({ status: "valid", value: units });
        expect(toWad(units, USDC) <= cap).toBe(true);
      }
    });
  });
});

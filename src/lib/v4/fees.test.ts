import { feeReadCalls, owedFee, positionSalt, uncollectedFees } from "./fees";

const Q128 = 2n ** 128n;
const TWO_256 = 2n ** 256n;

describe("owedFee", () => {
  it("is the growth since the last change times liquidity over 2^128", () => {
    expect(owedFee(10n, Q128 * 7n, Q128 * 2n)).toBe(50n);
    expect(owedFee(0n, Q128 * 7n, 0n)).toBe(0n);
  });

  it("follows the counter across its wrap modulo 2^256", () => {
    // The last reading sits just below 2^256 and the counter has since wrapped past zero.
    expect(owedFee(1n, Q128 * 3n, TWO_256 - Q128)).toBe(4n);
  });
});

describe("feeReadCalls and uncollectedFees", () => {
  it("salts the position with its token id and reads its range", () => {
    expect(positionSalt(7n)).toBe(`0x${"0".repeat(63)}7`);
    const [info, growth] = feeReadCalls("0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a", "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9", "0xab", "7", -60, 60);
    expect(info.functionName).toBe("getPositionInfo");
    expect(info.args).toEqual(["0xab", "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9", -60, 60, positionSalt(7n)]);
    expect(growth.args).toEqual(["0xab", -60, 60]);
  });

  it("computes both currencies from the two reads, and is null when either failed", () => {
    const info = { status: "success" as const, result: [4n, Q128, 0n] as const };
    const growth = { status: "success" as const, result: [Q128 * 3n, Q128 * 5n] as const };
    expect(uncollectedFees(info, growth)).toEqual({ amount0: 8n, amount1: 20n });
    expect(uncollectedFees({ status: "failure" }, growth)).toBeNull();
    expect(uncollectedFees(info, undefined)).toBeNull();
  });
});

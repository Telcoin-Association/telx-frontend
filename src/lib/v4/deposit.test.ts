import { getAmountsForLiquidity, getSqrtPriceAtTick, Q96 } from "./liquidityMath";
import { amountText, otherAmount, parseAmount, planDeposit } from "./deposit";

const RANGE = { tickLower: -600, tickUpper: 600 };
const AT_ZERO = Q96; // tick 0, inside the range

describe("otherAmount", () => {
  it("derives the other side so the two amounts pay for the same liquidity", () => {
    const one = 10n ** 18n;
    const derived1 = otherAmount(0, one, RANGE, AT_ZERO);
    const plan = planDeposit(RANGE, AT_ZERO, one, derived1, 0);
    expect(plan).not.toBeNull();
    // Neither side limits by more than rounding: the plan uses (almost) all of both.
    expect(plan!.amount0).toBeLessThanOrEqual(one + 1n);
    expect(plan!.amount0 * 1000n).toBeGreaterThanOrEqual(one * 999n);
    expect(plan!.amount1).toBeLessThanOrEqual(derived1 + 1n);

    const derived0 = otherAmount(1, one, RANGE, AT_ZERO);
    expect(derived0).toBeGreaterThan(0n);
  });

  it("is zero when the price sits at or beyond an edge of the range", () => {
    expect(otherAmount(0, 10n ** 18n, RANGE, getSqrtPriceAtTick(-600))).toBe(0n);
    expect(otherAmount(1, 10n ** 18n, RANGE, getSqrtPriceAtTick(900))).toBe(0n);
  });
});

describe("planDeposit", () => {
  it("adds slippage to the maximum amounts", () => {
    const plan = planDeposit(RANGE, AT_ZERO, 10n ** 18n, 10n ** 18n, 50)!;
    expect(plan.amount0Max).toBe((plan.amount0 * 10_050n + 9_999n) / 10_000n);
    expect(plan.amount1Max).toBe((plan.amount1 * 10_050n + 9_999n) / 10_000n);
    const paid = getAmountsForLiquidity(AT_ZERO, getSqrtPriceAtTick(-600), getSqrtPriceAtTick(600), plan.liquidity, true);
    expect(paid).toEqual({ amount0: plan.amount0, amount1: plan.amount1 });
  });

  it("is null when the amounts buy no liquidity", () => {
    expect(planDeposit(RANGE, AT_ZERO, 0n, 10n ** 18n, 50)).toBeNull();
  });
});

describe("parseAmount and amountText", () => {
  it("parses typed amounts, dropping decimals beyond the token's", () => {
    expect(parseAmount("1.5", 18)).toBe(15n * 10n ** 17n);
    expect(parseAmount(".25", 6)).toBe(250_000n);
    expect(parseAmount("0.1234567", 6)).toBe(123_456n);
    expect(parseAmount("", 18)).toBeNull();
    expect(parseAmount("1,5", 18)).toBeNull();
    expect(parseAmount("-1", 18)).toBeNull();
  });

  it("formats raw amounts as editable text", () => {
    expect(amountText(15n * 10n ** 17n, 18)).toBe("1.5");
    expect(amountText(123_456_789n, 6)).toBe("123.456789");
    expect(amountText(10n ** 18n + 1n, 18)).toBe("1");
    expect(amountText(0n, 6)).toBe("0");
  });
});

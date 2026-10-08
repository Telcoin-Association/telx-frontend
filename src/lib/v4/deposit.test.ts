import { getAmountsForLiquidity, getSqrtPriceAtTick, Q96 } from "./liquidityMath";
import { amountText, capToBalances, otherAmount, parseAmount, planDeposit, slippageSqrtPrices } from "./deposit";
import { usableTickBounds, withSlippage } from "./range";

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

const amountsAt = (range: { tickLower: number; tickUpper: number }, sqrtPrice: bigint, liquidity: bigint) =>
  getAmountsForLiquidity(sqrtPrice, getSqrtPriceAtTick(range.tickLower), getSqrtPriceAtTick(range.tickUpper), liquidity, true);

describe("slippageSqrtPrices", () => {
  it("brackets the price by the slippage, rounded outward", () => {
    const { lower, upper } = slippageSqrtPrices(AT_ZERO, 50);
    // sqrt(0.995) and sqrt(1.005) of Q96.
    expect(lower * lower).toBeLessThanOrEqual((AT_ZERO * AT_ZERO * 9_950n) / 10_000n);
    expect((lower + 1n) * (lower + 1n)).toBeGreaterThan((AT_ZERO * AT_ZERO * 9_950n) / 10_000n);
    expect(upper * upper).toBeGreaterThanOrEqual((AT_ZERO * AT_ZERO * 10_050n) / 10_000n);
    expect((upper - 1n) * (upper - 1n)).toBeLessThan((AT_ZERO * AT_ZERO * 10_050n) / 10_000n);
    expect(slippageSqrtPrices(AT_ZERO, 0)).toEqual({ lower: AT_ZERO, upper: AT_ZERO });
  });
});

describe("planDeposit", () => {
  it("bounds the maximum amounts by the amounts at the slippage-moved prices", () => {
    const plan = planDeposit(RANGE, AT_ZERO, 10n ** 18n, 10n ** 18n, 50)!;
    const band = slippageSqrtPrices(AT_ZERO, 50);
    expect(plan.amount0Max).toBe(amountsAt(RANGE, band.lower, plan.liquidity).amount0);
    expect(plan.amount1Max).toBe(amountsAt(RANGE, band.upper, plan.liquidity).amount1);
    expect(plan.amount0Max).toBeGreaterThan(plan.amount0);
    expect(plan.amount1Max).toBeGreaterThan(plan.amount1);
    expect(amountsAt(RANGE, AT_ZERO, plan.liquidity)).toEqual({ amount0: plan.amount0, amount1: plan.amount1 });
  });

  it("covers what the mint takes anywhere within the slippage", () => {
    const narrow = { tickLower: -60, tickUpper: 60 };
    const plan = planDeposit(narrow, AT_ZERO, 10n ** 18n, 10n ** 18n, 50)!;
    const band = slippageSqrtPrices(AT_ZERO, 50);
    for (const sqrtPrice of [band.lower, (band.lower + AT_ZERO) / 2n, AT_ZERO, (AT_ZERO + band.upper) / 2n, band.upper]) {
      const taken = amountsAt(narrow, sqrtPrice, plan.liquidity);
      expect(taken.amount0).toBeLessThanOrEqual(plan.amount0Max);
      expect(taken.amount1).toBeLessThanOrEqual(plan.amount1Max);
    }
    // A percentage on the amounts would not: at the top of the band token1 rises by far more than 0.5%.
    expect(amountsAt(narrow, band.upper, plan.liquidity).amount1).toBeGreaterThan(withSlippage(plan.amount1, 50));
  });

  it("stays close to amount plus slippage for a full or wide range", () => {
    for (const range of [usableTickBounds(60), { tickLower: -23_040, tickUpper: 23_040 }]) {
      const plan = planDeposit(range, AT_ZERO, 10n ** 18n, 10n ** 18n, 50)!;
      const sides: [bigint, bigint][] = [
        [plan.amount0, plan.amount0Max],
        [plan.amount1, plan.amount1Max],
      ];
      for (const [amount, max] of sides) {
        expect(max).toBeGreaterThan(amount);
        expect(max).toBeLessThanOrEqual(withSlippage(amount, 50));
      }
    }
  });

  it("clamps the band to the range: past an edge the maximum is the whole one-sided amount", () => {
    const range = { tickLower: -60, tickUpper: 60 };
    const plan = planDeposit(range, getSqrtPriceAtTick(59), 10n ** 18n, 10n ** 18n, 100)!;
    expect(plan.amount1Max).toBe(amountsAt(range, getSqrtPriceAtTick(60), plan.liquidity).amount1);
  });

  it("never sets a maximum below what the mint takes now", () => {
    const plan = planDeposit(RANGE, AT_ZERO, 10n ** 18n, 10n ** 18n, 0)!;
    expect(plan.amount0Max).toBe(plan.amount0);
    expect(plan.amount1Max).toBe(plan.amount1);
  });

  it("is null when the amounts buy no liquidity", () => {
    expect(planDeposit(RANGE, AT_ZERO, 0n, 10n ** 18n, 50)).toBeNull();
  });

  // An eUSD/TEL mint on Ethereum (tx 0xa526722d..., block 26144141) planned at tick 338561 with 0.5% slippage. The
  // price rose 0.524% before it landed, and the PositionManager needed 105,394.748 TEL: MaximumAmountExceeded.
  describe("eUSD/TEL mint at tick 338561", () => {
    const range = { tickLower: 338_340, tickUpper: 338_820 };
    const planned = 1_779_422_931_665_956_039_034_541_817_305_510_338n; // tick 338561, block 26144140
    const landed = 1_784_080_256_337_053_496_238_684_607_701_548_506n; // tick 338613, block 26144141
    const liquidity = 344_410_286_704_611_008n;
    const plan = (bps: number) => planDeposit(range, planned, 197_000_000n, 85_149_036_484_779_999_806_387n, bps)!;
    const neededAtLanding = amountsAt(range, landed, liquidity);

    it("deposits the same liquidity and amounts, with only the limits changed", () => {
      expect(plan(50).liquidity).toBe(liquidity);
      expect(plan(50).amount0).toBe(197_000_000n);
      expect(plan(50).amount1).toBe(85_149_036_484_779_999_806_387n);
      expect(neededAtLanding.amount1).toBe(105_394_748_039_182_662_321_794n);
    });

    it("raises the TEL limit to cover a full 0.5% rise, where amount plus 0.5% covered about 0.01%", () => {
      const { amount0Max, amount1Max } = plan(50);
      expect(withSlippage(85_149_036_484_779_999_806_387n, 50)).toBe(85_574_781_667_203_899_805_419n);
      expect(amount1Max).toBe(104_463_109_517_149_402_964_439n);
      expect(amount0Max).toBe(235_481_224n);
      const band = slippageSqrtPrices(planned, 50);
      expect(amountsAt(range, band.upper, liquidity).amount1).toBeLessThanOrEqual(amount1Max);
      expect(amountsAt(range, band.lower, liquidity).amount0).toBeLessThanOrEqual(amount0Max);
      // The landing price was 0.524% higher, outside a 0.5% tolerance, so this add still stops.
      expect(neededAtLanding.amount1).toBeGreaterThan(amount1Max);
    });

    it("covers the 105,394.748 TEL the landing price needed at 1% slippage, and the eUSD side", () => {
      const { amount0Max, amount1Max } = plan(100);
      expect(amount1Max).toBeGreaterThanOrEqual(neededAtLanding.amount1);
      expect(amount0Max).toBeGreaterThanOrEqual(neededAtLanding.amount0);
      expect(amount0Max).toBeGreaterThanOrEqual(197_000_000n);
    });
  });
});

describe("capToBalances", () => {
  const plan = { liquidity: 1n, amount0: 1_000n, amount1: 1_000n, amount0Max: 1_240n, amount1Max: 1_003n };

  it("keeps the maxima when the wallet covers them", () => {
    expect(capToBalances(plan, [2_000n, 2_000n], 50)).toEqual({ amount0Max: 1_240n, amount1Max: 1_003n, short: [] });
  });

  it("caps a maximum at the spendable balance while that leaves room for the slippage", () => {
    expect(capToBalances(plan, [1_100n, 2_000n], 50)).toEqual({ amount0Max: 1_100n, amount1Max: 1_003n, short: [] });
    expect(capToBalances(plan, [1_005n, 2_000n], 50)).toEqual({ amount0Max: 1_005n, amount1Max: 1_003n, short: [] });
  });

  it("is short when the balance leaves less than the amount plus slippage, or less than a smaller maximum", () => {
    expect(capToBalances(plan, [1_004n, 2_000n], 50).short).toEqual([0]);
    expect(capToBalances(plan, [2_000n, 1_002n], 50).short).toEqual([1]);
    expect(capToBalances(plan, [999n, 999n], 50).short).toEqual([0, 1]);
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

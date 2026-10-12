/**
 * @jest-environment node
 */
import { zeroAddress, type Address } from "viem";
import { getAmount0ForLiquidity, getAmount1ForLiquidity, getAmountsForLiquidity, getSqrtPriceAtTick } from "./liquidityMath";
import { maxAmountsForLiquidity, slippageSqrtPrices } from "./deposit";
import { closeFlow, liquidityForPercent, minAmountsForLiquidity, planWithdraw, positionInfoRange, readPositionState } from "./withdraw";

const RANGE = { tickLower: 141_420, tickUpper: 142_140 };
const PRICE = getSqrtPriceAtTick(141_799);
const L = 17_276_668_185_694_602_761_460n;

describe("liquidityForPercent", () => {
  it("takes all of the liquidity at 100 and rounds down below it", () => {
    expect(liquidityForPercent(1_000n, 100)).toBe(1_000n);
    expect(liquidityForPercent(1_001n, 50)).toBe(500n);
    expect(liquidityForPercent(999n, 25)).toBe(249n);
    expect(liquidityForPercent(1_000n, 0)).toBe(0n);
    expect(liquidityForPercent(1_000n, 150)).toBe(1_000n);
  });
});

describe("minAmountsForLiquidity", () => {
  it("pays what the liquidity holds now, rounded down as the PoolManager pays it", () => {
    const amounts = minAmountsForLiquidity(RANGE, PRICE, L, 50);
    const paid = getAmountsForLiquidity(PRICE, getSqrtPriceAtTick(RANGE.tickLower), getSqrtPriceAtTick(RANGE.tickUpper), L, false);
    expect([amounts.amount0, amounts.amount1]).toEqual([paid.amount0, paid.amount1]);
  });

  it("bounds token0 at the band's highest price and token1 at its lowest, the mirror of the maximum rule", () => {
    const sqrtA = getSqrtPriceAtTick(RANGE.tickLower);
    const sqrtB = getSqrtPriceAtTick(RANGE.tickUpper);
    const band = slippageSqrtPrices(PRICE, 50);
    const amounts = minAmountsForLiquidity(RANGE, PRICE, L, 50);
    expect(amounts.amount0Min).toBe(getAmount0ForLiquidity(band.upper, sqrtB, L));
    expect(amounts.amount1Min).toBe(getAmount1ForLiquidity(sqrtA, band.lower, L));
    // The maximum rule takes the other ends of the same band.
    const max = maxAmountsForLiquidity(RANGE, PRICE, L, 50);
    expect(max.amount0Max).toBe(getAmount0ForLiquidity(band.lower, sqrtB, L, true));
  });

  it("never asks for more than the removal pays now, and asks for all of it with no slippage", () => {
    const amounts = minAmountsForLiquidity(RANGE, PRICE, L, 100);
    expect(amounts.amount0Min).toBeLessThan(amounts.amount0);
    expect(amounts.amount1Min).toBeLessThan(amounts.amount1);
    const exact = minAmountsForLiquidity(RANGE, PRICE, L, 0);
    expect(exact.amount0Min).toBeLessThanOrEqual(exact.amount0);
    expect(exact.amount1Min).toBeLessThanOrEqual(exact.amount1);
    expect(exact.amount0 - exact.amount0Min).toBeLessThanOrEqual(1n);
    expect(exact.amount1 - exact.amount1Min).toBeLessThanOrEqual(1n);
  });

  it("allows far more than a flat percentage near the edge of a narrow range, where the token mix moves fastest", () => {
    const narrow = { tickLower: 141_780, tickUpper: 141_840 };
    const amounts = minAmountsForLiquidity(narrow, PRICE, L, 50);
    // Half a percent off each amount would not cover a 0.5% price move here.
    expect(amounts.amount1Min).toBeLessThan((amounts.amount1 * 995n) / 1000n);
  });

  it("keeps the whole amount of a position out of range, whose single token doesn't move with the price inside the band", () => {
    const above = { tickLower: 150_000, tickUpper: 151_000 };
    const amounts = minAmountsForLiquidity(above, PRICE, L, 100);
    expect(amounts.amount1).toBe(0n);
    expect(amounts.amount1Min).toBe(0n);
    expect(amounts.amount0Min).toBe(amounts.amount0);
    const below = { tickLower: 130_000, tickUpper: 131_000 };
    const under = minAmountsForLiquidity(below, PRICE, L, 100);
    expect(under.amount0).toBe(0n);
    expect(under.amount1Min).toBe(under.amount1);
  });
});

describe("planWithdraw", () => {
  it("closes the position at 100%", () => {
    expect(planWithdraw(RANGE, PRICE, L, 100, 50)).toMatchObject({ liquidity: L, closes: true, percent: 100 });
    expect(planWithdraw(RANGE, PRICE, L, 50, 50)).toMatchObject({ liquidity: L / 2n, closes: false });
  });

  it("is null when nothing would be removed", () => {
    expect(planWithdraw(RANGE, PRICE, 0n, 100, 50)).toBeNull();
    expect(planWithdraw(RANGE, PRICE, 1n, 25, 50)).toBeNull();
  });
});

describe("closeFlow", () => {
  it("unsubscribes a subscribed position before burning it, and burns an unsubscribed one directly", () => {
    expect(closeFlow("0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86")).toBe("unsubscribeAndBurn");
    expect(closeFlow(zeroAddress)).toBe("burn");
  });
});

describe("positionInfoRange", () => {
  it("reads signed ticks from a PositionInfo word", () => {
    const word = (BigInt(141_420 & 0xffffff) << 8n) | (BigInt(-887_220 & 0xffffff) << 32n) | 1n;
    expect(positionInfoRange(word)).toEqual({ tickLower: 141_420, tickUpper: -887_220 });
  });
});

describe("readPositionState", () => {
  it("reads the position, its subscriber and the pool's price, with native ETH at 18 decimals", async () => {
    const owner: Address = "0x4078aF18Db3725336742a4DBC3255aB3982032BD";
    const tel: Address = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
    const info = (BigInt(139_560) << 8n) | (BigInt(143_160) << 32n) | 1n;
    const readContract = jest.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "ownerOf":
          return owner;
        case "getPoolAndPositionInfo":
          return [{ currency0: zeroAddress, currency1: tel, fee: 3000, tickSpacing: 60, hooks: zeroAddress }, info];
        case "getPositionLiquidity":
          return 2_859n;
        case "subscriber":
          return "0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86";
        case "getSlot0":
          return [PRICE, 141_799, 0, 3000];
        case "decimals":
          return 18;
      }
      throw new Error(functionName);
    });
    const state = await readPositionState({ readContract } as never, {
      chainId: 1,
      positionManager: zeroAddress,
      poolId: "0x272e",
      tokenId: 439_426n,
    });
    expect(state).toMatchObject({ owner, liquidity: 2_859n, range: { tickLower: 139_560, tickUpper: 143_160 }, tick: 141_799, decimals: [18, 18] });
    expect(closeFlow(state.subscriber)).toBe("unsubscribeAndBurn");
    // Native ETH has no decimals call; TEL has one.
    expect(readContract.mock.calls.filter(([call]) => call.functionName === "decimals")).toHaveLength(1);
  });
});

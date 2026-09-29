/**
 * @jest-environment node
 */
import { composeSwapFee, swapPrices, unpackProtocolFee, valueSwap } from "./swapMath";

describe("fee pips", () => {
  it("composes the swap fee as v4 does", () => {
    expect(composeSwapFee(500, 3000)).toBe(3499);
    expect(composeSwapFee(125, 500)).toBe(625);
    expect(composeSwapFee(0, 3000)).toBe(3000);
  });

  it("unpacks slot0's protocol fee: zeroForOne in the low 12 bits, oneForZero in the high 12", () => {
    expect(unpackProtocolFee(2_048_500)).toEqual({ zeroForOne: 500, oneForZero: 500 });
    expect(unpackProtocolFee(512_125)).toEqual({ zeroForOne: 125, oneForZero: 125 });
    expect(unpackProtocolFee((300 << 12) | 100)).toEqual({ zeroForOne: 100, oneForZero: 300 });
  });
});

describe("valueSwap", () => {
  // WETH (anchor, $2,000) / TEL at 1,000,000 TEL per WETH, 18 decimals each.
  const decimals = [18, 18] as const;
  const prices = [2000, 0.002] as const;

  it("measures volume on the anchor and fees on the input, with the protocol share of a 3499-pip fee at 500/3499", () => {
    // 1 WETH in, 996,501 TEL out.
    const value = valueSwap({ amount0: -(10n ** 18n), amount1: 996_501n * 10n ** 18n, fee: 3499 }, 0, decimals, prices, 2_048_500);

    expect(value.volumeUSD).toBeCloseTo(2000, 9);
    expect(value.feesUSD).toBeCloseTo(2000 * 0.003499, 9);
    expect(value.protocolFeesUSD / value.feesUSD).toBeCloseTo(500 / 3499, 12);
    expect(value.lpFeesUSD + value.protocolFeesUSD).toBeCloseTo(value.feesUSD, 12);
  });

  it("takes the protocol fee of the swap's direction", () => {
    const packed = (300 << 12) | 100;
    const oneForZero = valueSwap({ amount0: 5n * 10n ** 17n, amount1: -(10n ** 24n), fee: 3300 }, 0, decimals, prices, packed);
    const zeroForOne = valueSwap({ amount0: -(10n ** 18n), amount1: 10n ** 24n, fee: 3100 }, 0, decimals, prices, packed);

    expect(oneForZero.volumeUSD).toBeCloseTo(1000, 9);
    expect(oneForZero.feesUSD).toBeCloseTo(1_000_000 * 0.002 * 0.0033, 9);
    expect(oneForZero.protocolFeesUSD / oneForZero.feesUSD).toBeCloseTo(300 / 3300, 12);
    expect(zeroForOne.protocolFeesUSD / zeroForOne.feesUSD).toBeCloseTo(100 / 3100, 12);
  });

  it("measures volume on currency1 when it is the anchor", () => {
    const value = valueSwap({ amount0: -(10n ** 21n), amount1: 2n * 10n ** 6n, fee: 3000 }, 1, [18, 6], [0.002, 1], 0);
    expect(value.volumeUSD).toBeCloseTo(2, 12);
    expect(value.protocolFeesUSD).toBe(0);
  });

  it("gives no fee to a swap without an input leg", () => {
    expect(valueSwap({ amount0: 0n, amount1: 0n, fee: 3000 }, 0, decimals, prices, 0)).toEqual({
      volumeUSD: 0,
      feesUSD: 0,
      lpFeesUSD: 0,
      protocolFeesUSD: 0,
    });
  });
});

describe("swapPrices", () => {
  it("values the non-anchor currency at the swap's own pool price", () => {
    // sqrtPriceX96 of 1000 * 2^96 is 1,000,000 currency1 per currency0.
    const [p0, p1] = swapPrices(1000n * 2n ** 96n, 0, 2000, [18, 18]);
    expect(p0).toBe(2000);
    expect(p1).toBeCloseTo(0.002, 15);

    const [q0, q1] = swapPrices(1000n * 2n ** 96n, 1, 0.002, [18, 18]);
    expect(q0).toBeCloseTo(2000, 9);
    expect(q1).toBe(0.002);
  });
});

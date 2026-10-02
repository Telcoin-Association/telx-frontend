import type { Position } from "@/lib/positions";
import { feesCollectableByChain } from "./feesRows";

const position = (tokenId: string, fees: Position["fees"], liquidity = "1000"): Position => ({
  tokenId,
  isSubscribed: true,
  tickLower: -60,
  tickUpper: 60,
  liquidity,
  amounts: { amount0: "1", amount1: "1", sqrtPriceX96: (2n ** 96n).toString() },
  price: { price1Per0: 2000, price0Per1: 0.0005 },
  fees,
});

const WETH_TEL = { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" };
const TEL = { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" };
const EUSD = { ticker: "eUSD", address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949" };
const rates = { WETH: { USD: "3000" }, TEL: { USD: "0.002" }, eUSD: { USD: "1" } };

describe("feesCollectableByChain", () => {
  it("gathers each chain's positions with fees, sums the fees per token, and prices them", () => {
    const rows = feesCollectableByChain(
      [
        { chain: "polygon", poolId: "0xA22A", assets: [WETH_TEL, TEL], positions: [position("1", { amount0: "0.001", amount1: "5" }), position("2", { amount0: "0", amount1: "0" })] },
        { chain: "polygon", poolId: "0x1266", assets: [EUSD, TEL], positions: [position("3", { amount0: "2", amount1: "3" })] },
        { chain: "base", poolId: "0x272e", assets: [{ ticker: "ETH", address: "0x0000000000000000000000000000000000000000" }, TEL], positions: [position("9", { amount0: "0", amount1: "0" })] },
      ],
      rates
    );

    expect(Object.keys(rows)).toEqual(["polygon"]);
    expect(rows.polygon!.targets.map((t) => [t.tokenId, t.poolId])).toEqual([
      ["1", "0xa22a"],
      ["3", "0x1266"],
    ]);
    expect(rows.polygon!.summary).toBe("0.001 WETH · 8 TEL · 2 eUSD");
    // 0.001 × $3000 + 5 × $0.002, then 2 × $1 + 3 × $0.002
    expect(rows.polygon!.valueUsd).toBeCloseTo(3.01 + 2.006, 6);
  });

  it("leaves out positions without liquidity or without a fee reading", () => {
    const rows = feesCollectableByChain(
      [{ chain: "base", poolId: "0x272e", assets: [WETH_TEL, TEL], positions: [position("1", { amount0: "1", amount1: "1" }, "0"), position("2", null)] }],
      rates
    );
    expect(rows).toEqual({});
  });

  it("gives no USD value when a position's fees can't be priced", () => {
    const rows = feesCollectableByChain([{ chain: "polygon", poolId: "0xa22a", assets: [{ ticker: "XYZ" }, { ticker: "ABC" }], positions: [position("1", { amount0: "1", amount1: "1" })] }], rates);
    expect(rows.polygon!.valueUsd).toBeNull();
  });
});

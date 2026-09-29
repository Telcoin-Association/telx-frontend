/**
 * @jest-environment node
 */
import { listUniswapV4Pools } from "./uniswapPools";

// eUSD/TEL has the same pool id on all three chains; ETH/TEL on Ethereum and Base only.
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const ETH_TEL = "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6";

describe("listUniswapV4Pools", () => {
  it("lists a chain's v4 pools with their registry decimals, inactive pools included", () => {
    const polygon = listUniswapV4Pools("polygon");
    expect(polygon).toContainEqual({ poolId: EUSD_TEL, amount0Decimals: 6, amount1Decimals: 18 });
    expect(polygon.map(pool => pool.poolId)).toContain("0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7");
  });

  it("keeps each chain's pools separate", () => {
    expect(listUniswapV4Pools("polygon").map(pool => pool.poolId)).not.toContain(ETH_TEL);
    expect(listUniswapV4Pools("ethereum").map(pool => pool.poolId)).toContain(ETH_TEL);
    expect(listUniswapV4Pools("base").map(pool => pool.poolId)).toContain(ETH_TEL);
  });

  it("lists every pool id once", () => {
    for (const chain of ["polygon", "base", "ethereum"] as const) {
      const ids = listUniswapV4Pools(chain).map(pool => pool.poolId.toLowerCase());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

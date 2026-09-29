import pools from "@/data/pool.json";
import { chainDisplayName, poolDisplayName, poolPageTitle, poolSymbols, RegistryPoolForTitle } from "./poolTitle";

function pool(address: string, blockchain: string, assets: string[], active = true): RegistryPoolForTitle {
  return {
    attributes: {
      pool_address: address,
      blockchain,
      active,
      pool_assets: { data: assets.map(name => ({ attributes: { name } })) },
    },
  };
}

describe("pool titles", () => {
  it("names chains for display", () => {
    expect(chainDisplayName("polygon")).toBe("Polygon");
    expect(chainDisplayName("ethereum")).toBe("Ethereum");
    expect(chainDisplayName("base")).toBe("Base");
    expect(chainDisplayName("arbitrum")).toBe("Arbitrum");
  });

  it("drops weights from weighted pool asset names", () => {
    expect(poolSymbols(pool("0x1", "polygon", ["TEL 80", "WETH 20"]))).toEqual(["TEL", "WETH"]);
  });

  it("names a pool by its tokens and chain, not its registry name", () => {
    const registry = [{ attributes: { ...pool("0xAbC", "polygon", ["WETH", "TEL"]).attributes, name: "WETH/TEL polygon merkl" } }];
    expect(poolDisplayName(registry, "0xabc")).toBe("WETH/TEL on Polygon");
    expect(poolPageTitle(poolDisplayName(registry, "0xabc"))).toBe("WETH/TEL on Polygon | TELx");
  });

  it("leaves the chain out when an id is registered on several chains", () => {
    const registry = [pool("0x1", "polygon", ["eUSD", "TEL"]), pool("0x1", "base", ["eUSD", "TEL"])];
    expect(poolDisplayName(registry, "0x1")).toBe("eUSD/TEL");
  });

  it("prefers an active entry for the symbols", () => {
    const registry = [pool("0x1", "polygon", ["TEL", "WETH"], false), pool("0x1", "polygon", ["WETH", "TEL"], true)];
    expect(poolDisplayName(registry, "0x1")).toBe("WETH/TEL on Polygon");
  });

  it("falls back to the generic title for an unknown id", () => {
    expect(poolDisplayName([], "0x1")).toBeNull();
    expect(poolPageTitle(null)).toBe("Pool Details | TELx");
  });

  it("gives every registry pool a name without internal labels", () => {
    for (const entry of pools) {
      const name = poolDisplayName(pools, entry.attributes.pool_address);
      expect(name).toBeTruthy();
      expect(name).not.toMatch(/merkl|deprecated|relaunch/i);
    }
  });
});

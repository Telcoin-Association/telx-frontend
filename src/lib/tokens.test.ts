import {
  LEGACY_TEL_ADDRESSES,
  isLegacyTel,
  getTokenExplorerUrl,
  paysLegacyTelRewards,
  getTokenIconKey,
} from "./tokens";
import { MERKL_ETH_TEL_POOLID, MERKL_POLYGON_EUSD_EMXN_POOLID, POLYGON_WETH_TEL_POOLID } from "./contracts";
import { TEL_TOKEN_ADDRESS } from "../merkl/merklConstants";

describe("isLegacyTel", () => {
  it("matches the legacy 2-decimal TEL on Polygon, Ethereum and Base in any case", () => {
    expect(LEGACY_TEL_ADDRESSES).toHaveLength(3);
    expect(isLegacyTel("0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32")).toBe(true);
    expect(isLegacyTel("0x467bccd9d29f223bce8043b84e8c8b282827790f")).toBe(true);
    expect(isLegacyTel("0x09BE1692CA16E06F536F0038FF11D1DA8524ADB1")).toBe(true);
  });

  it("does not match TEL3 or missing addresses", () => {
    expect(isLegacyTel(TEL_TOKEN_ADDRESS)).toBe(false);
    expect(isLegacyTel(null)).toBe(false);
    expect(isLegacyTel(undefined)).toBe(false);
  });
});

describe("getTokenExplorerUrl", () => {
  const address = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";

  it("links to the token page on each network's explorer", () => {
    expect(getTokenExplorerUrl("ethereum", address)).toBe(`https://etherscan.io/token/${address}`);
    expect(getTokenExplorerUrl("polygon", address)).toBe(`https://polygonscan.com/token/${address}`);
    expect(getTokenExplorerUrl("base", address)).toBe(`https://basescan.org/token/${address}`);
  });

  it("returns undefined for unknown networks or native tokens", () => {
    expect(getTokenExplorerUrl("solana", address)).toBeUndefined();
    expect(getTokenExplorerUrl("base", null)).toBeUndefined();
  });
});

describe("paysLegacyTelRewards", () => {
  it("Merkl pools pay TEL3", () => {
    expect(paysLegacyTelRewards(MERKL_ETH_TEL_POOLID)).toBe(false);
    expect(paysLegacyTelRewards(MERKL_POLYGON_EUSD_EMXN_POOLID.toUpperCase())).toBe(false);
  });

  it("every other pool pays legacy TEL", () => {
    expect(paysLegacyTelRewards(POLYGON_WETH_TEL_POOLID)).toBe(true);
    expect(paysLegacyTelRewards("0x3bd8a254163f8328efcc4f8c36da566753462433")).toBe(true);
  });
});

describe("getTokenIconKey", () => {
  it("uses the greyed-out logo for legacy TEL only", () => {
    expect(getTokenIconKey("TEL", true)).toBe("tel_legacy");
    expect(getTokenIconKey("TEL", false)).toBe("tel");
    expect(getTokenIconKey("tel")).toBe("tel");
    expect(getTokenIconKey("USDC", true)).toBe("usdc");
  });
});

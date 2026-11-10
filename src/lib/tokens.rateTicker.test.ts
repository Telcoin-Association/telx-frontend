import { LEGACY_TEL_RATE, rateTicker } from "./tokens";

describe("rateTicker", () => {
  it("reads legacy TEL's rate for TEL paid by a legacy pool", () => {
    expect(rateTicker("TEL", true)).toBe(LEGACY_TEL_RATE);
    expect(rateTicker("tel", true)).toBe(LEGACY_TEL_RATE);
  });

  it("keeps the ticker for TEL3 and for every other token", () => {
    expect(rateTicker("TEL", false)).toBe("TEL");
    expect(rateTicker("DQUICK", true)).toBe("DQUICK");
    expect(rateTicker("WETH", false)).toBe("WETH");
  });
});

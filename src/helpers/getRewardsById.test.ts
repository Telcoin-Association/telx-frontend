import { getRewardsStartLabel } from "./getRewardsById";

describe("getRewardsStartLabel", () => {
  it("returns the network start label for active pools", () => {
    expect(getRewardsStartLabel("base")).toBe("Starting Sept 30th");
    expect(getRewardsStartLabel("ethereum", false)).toBe("Starting Oct 7th");
  });

  it("returns undefined for networks without a start label", () => {
    expect(getRewardsStartLabel("polygon")).toBeUndefined();
    expect(getRewardsStartLabel(undefined)).toBeUndefined();
  });

  it("returns undefined for deprecated pools so they show rewards like other deprecated pools", () => {
    expect(getRewardsStartLabel("base", true)).toBeUndefined();
    expect(getRewardsStartLabel("ethereum", true)).toBeUndefined();
  });
});

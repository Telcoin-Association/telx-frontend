/**
 * @jest-environment node
 */
import type { PoolRewardsIndex } from "@/lib/positions";
import { positionRewardsFromIndex } from "./rewards";

const index: PoolRewardsIndex = {
  chain: "polygon",
  poolId: "0xa22a",
  updatedAt: 1,
  campaigns: [],
  unresolved: 0,
  positions: { "144097": { reward: 36_060.98, claimable: 31_284.14, pending: 4_776.84, final: false } },
};

describe("positionRewardsFromIndex", () => {
  it("gives a position's whole reward, credited and accrued, with its finality", () => {
    expect(positionRewardsFromIndex(index, "144097")).toEqual({
      symbol: "TEL",
      token: "0x7e13b43065380acdec1c2d138c579cbbbafa0731",
      amount: 36_060.98,
      priceUSD: null,
      final: false,
    });
  });

  it("reads zero for a position the index doesn't list", () => {
    expect(positionRewardsFromIndex(index, "1")).toMatchObject({ amount: 0, final: true });
  });
});

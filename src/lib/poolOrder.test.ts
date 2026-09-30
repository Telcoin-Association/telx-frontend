import { sortPoolsForDisplay } from "./poolOrder";

const NOW = Date.UTC(2026, 8, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

type Pool = {
  id: string;
  blockchain: string;
  totalLiquidity?: number | null;
  rewardsStatus?: string | null;
  rewardsApr?: number | null;
  rewardsCampaignStart?: number | null;
  rewardsCampaignEnd?: number | null;
};

const pool = (id: string, blockchain: string, fields: Partial<Pool> = {}): Pool => ({ id, blockchain, totalLiquidity: 1_000, ...fields });
const ids = (pools: Pool[]) => sortPoolsForDisplay(pools, NOW).map((p) => p.id);

describe("sortPoolsForDisplay", () => {
  it("puts live campaigns first by APR, then scheduled ones by start, then the rest", () => {
    const pools = [
      pool("none", "polygon"),
      pool("soon-late", "base", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + 7 * DAY }),
      pool("live-low", "ethereum", { rewardsStatus: "LIVE", rewardsApr: 40 }),
      pool("ended", "polygon", { rewardsStatus: "PAST" }),
      pool("soon-early", "ethereum", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + DAY }),
      pool("live-high", "base", { rewardsStatus: "LIVE", rewardsApr: 130 }),
    ];
    expect(ids(pools)).toEqual(["live-high", "live-low", "soon-early", "soon-late", "none", "ended"]);
  });

  it("orders pools without a campaign by network, Base above Ethereum, then by TVL", () => {
    const pools = [
      pool("eth-big", "ethereum", { totalLiquidity: 70_000 }),
      pool("base-small", "base", { totalLiquidity: 4 }),
      pool("base-big", "base", { totalLiquidity: 7_800 }),
      pool("polygon", "polygon", { totalLiquidity: 1 }),
      pool("eth-small", "ethereum", { totalLiquidity: 5 }),
    ];
    expect(ids(pools)).toEqual(["polygon", "base-big", "base-small", "eth-big", "eth-small"]);
  });

  it("breaks equal APRs and start dates by network, and puts a missing APR or start last in its group", () => {
    const pools = [
      pool("live-eth", "ethereum", { rewardsStatus: "LIVE", rewardsApr: 50 }),
      pool("live-no-apr", "polygon", { rewardsStatus: "LIVE", rewardsApr: null }),
      pool("live-base", "base", { rewardsStatus: "LIVE", rewardsApr: 50 }),
      pool("soon-no-start", "polygon", { rewardsStatus: "SOON" }),
      pool("soon-eth", "ethereum", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + DAY }),
      pool("soon-base", "base", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + DAY }),
    ];
    expect(ids(pools)).toEqual(["live-base", "live-eth", "live-no-apr", "soon-base", "soon-eth", "soon-no-start"]);
  });

  it("drops a live campaign whose end has passed to the pools without a campaign", () => {
    const pools = [
      pool("ended-on-clock", "polygon", { rewardsStatus: "LIVE", rewardsApr: 200, rewardsCampaignEnd: NOW - 1 }),
      pool("live", "ethereum", { rewardsStatus: "LIVE", rewardsApr: 10, rewardsCampaignEnd: NOW + DAY }),
    ];
    expect(ids(pools)).toEqual(["live", "ended-on-clock"]);
  });

  it("puts unknown networks and missing TVL last, and keeps fully equal pools in their input order", () => {
    const pools = [
      pool("unknown-chain", "arbitrum"),
      pool("no-tvl", "base", { totalLiquidity: null }),
      pool("first", "polygon"),
      pool("second", "polygon"),
      pool("base-tvl", "base"),
    ];
    expect(ids(pools)).toEqual(["first", "second", "base-tvl", "no-tvl", "unknown-chain"]);
  });

  it("does not change the list it is given", () => {
    const pools = [pool("eth", "ethereum"), pool("base", "base")];
    sortPoolsForDisplay(pools, NOW);
    expect(pools.map((p) => p.id)).toEqual(["eth", "base"]);
  });
});

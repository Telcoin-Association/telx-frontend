import { filterPools, poolSortValue, sortPoolsBy, sortPoolsForDisplay } from "./poolOrder";

const NOW = Date.UTC(2026, 9, 1, 12);
const DAY = 24 * 60 * 60 * 1000;

type Pool = {
  id: string;
  blockchain: string;
  protocol?: string;
  totalLiquidity?: number | null;
  dailyVolumeUSD?: number | null;
  fees24hr?: number | null;
  subscribedTvlUSD?: number | null;
  rewardsStatus?: string | null;
  rewardsApr?: number | null;
  rewardsCampaignStart?: number | null;
  rewardsCampaignEnd?: number | null;
};

const pool = (id: string, blockchain: string, fields: Partial<Pool> = {}): Pool => ({ id, blockchain, protocol: "uniswap", totalLiquidity: 1_000, ...fields });
const ids = (pools: Pool[]) => pools.map((p) => p.id);
const live = (apr: number, extra: Partial<Pool> = {}) => ({ rewardsStatus: "LIVE", rewardsApr: apr, ...extra });

describe("sortPoolsForDisplay", () => {
  it("orders by network first: Polygon, then Base, then Ethereum, whatever the campaigns", () => {
    const pools = [
      pool("eth-live", "ethereum", live(300)),
      pool("base-live", "base", live(200)),
      pool("polygon-none", "polygon"),
      pool("base-none", "base"),
    ];
    expect(ids(sortPoolsForDisplay(pools, NOW))).toEqual(["polygon-none", "base-live", "base-none", "eth-live"]);
  });

  it("within a network puts live campaigns first by APR, then scheduled by start, then the rest by TVL", () => {
    const pools = [
      pool("none-small", "polygon", { totalLiquidity: 10 }),
      pool("soon-late", "polygon", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + 7 * DAY }),
      pool("live-low", "polygon", live(40)),
      pool("ended", "polygon", { rewardsStatus: "PAST", totalLiquidity: 5 }),
      pool("soon-early", "polygon", { rewardsStatus: "SOON", rewardsCampaignStart: NOW + DAY }),
      pool("live-high", "polygon", live(130)),
      pool("none-big", "polygon", { totalLiquidity: 9_000 }),
    ];
    expect(ids(sortPoolsForDisplay(pools, NOW))).toEqual(["live-high", "live-low", "soon-early", "soon-late", "none-big", "none-small", "ended"]);
  });

  it("puts a missing APR or start last in its group, and treats a campaign ended on the clock as ended", () => {
    const pools = [
      pool("live-no-apr", "polygon", { rewardsStatus: "LIVE", rewardsApr: null }),
      pool("ended-on-clock", "polygon", live(500, { rewardsCampaignEnd: NOW - 1, totalLiquidity: 50 })),
      pool("live", "polygon", live(10, { rewardsCampaignEnd: NOW + DAY })),
    ];
    expect(ids(sortPoolsForDisplay(pools, NOW))).toEqual(["live", "live-no-apr", "ended-on-clock"]);
  });

  it("puts unknown networks last, keeps fully equal pools in input order, and leaves its input alone", () => {
    const pools = [pool("unknown", "arbitrum"), pool("first", "polygon"), pool("second", "polygon")];
    expect(ids(sortPoolsForDisplay(pools, NOW))).toEqual(["first", "second", "unknown"]);
    expect(ids(pools)).toEqual(["unknown", "first", "second"]);
  });
});

describe("sortPoolsBy", () => {
  const pools = [
    pool("polygon-a", "polygon", { totalLiquidity: 500, dailyVolumeUSD: 10, fees24hr: 1, ...live(60, { subscribedTvlUSD: 300 }) }),
    pool("base-a", "base", { totalLiquidity: 900, dailyVolumeUSD: null, fees24hr: 3, ...live(90, { subscribedTvlUSD: 100 }) }),
    pool("eth-a", "ethereum", { totalLiquidity: null, dailyVolumeUSD: 50, fees24hr: 2 }),
  ];

  it("sorts by a column highest or lowest first, with unknown values last either way", () => {
    expect(ids(sortPoolsBy(pools, { key: "tvl", direction: "desc" }, NOW))).toEqual(["base-a", "polygon-a", "eth-a"]);
    expect(ids(sortPoolsBy(pools, { key: "tvl", direction: "asc" }, NOW))).toEqual(["polygon-a", "base-a", "eth-a"]);
    expect(ids(sortPoolsBy(pools, { key: "volume", direction: "desc" }, NOW))).toEqual(["eth-a", "polygon-a", "base-a"]);
    expect(ids(sortPoolsBy(pools, { key: "fees", direction: "asc" }, NOW))).toEqual(["polygon-a", "eth-a", "base-a"]);
  });

  it("sorts SVL and APR from live campaigns only", () => {
    expect(ids(sortPoolsBy(pools, { key: "svl", direction: "desc" }, NOW))).toEqual(["polygon-a", "base-a", "eth-a"]);
    expect(ids(sortPoolsBy(pools, { key: "apr", direction: "desc" }, NOW))).toEqual(["base-a", "polygon-a", "eth-a"]);
    expect(poolSortValue(pool("soon", "polygon", { rewardsStatus: "SOON", rewardsApr: 99 }), "apr", NOW)).toBeNull();
  });

  it("keeps the default order among equal values", () => {
    const equal = [pool("eth", "ethereum", { totalLiquidity: 5 }), pool("polygon", "polygon", { totalLiquidity: 5 }), pool("base", "base", { totalLiquidity: 5 })];
    expect(ids(sortPoolsBy(equal, { key: "tvl", direction: "desc" }, NOW))).toEqual(["polygon", "base", "eth"]);
  });
});

describe("filterPools", () => {
  const pools = [pool("polygon-live", "polygon", live(50)), pool("polygon-none", "polygon"), pool("base-live", "Base", live(20)), pool("eth-none", "ethereum")];

  it("keeps the chosen chain, in any letter case", () => {
    expect(ids(filterPools(pools, { chain: "base", liveOnly: false }, NOW))).toEqual(["base-live"]);
    expect(ids(filterPools(pools, { chain: "all", liveOnly: false }, NOW))).toHaveLength(4);
  });

  it("keeps only live campaigns when asked, combined with the chain", () => {
    expect(ids(filterPools(pools, { chain: "all", liveOnly: true }, NOW))).toEqual(["polygon-live", "base-live"]);
    expect(ids(filterPools(pools, { chain: "ethereum", liveOnly: true }, NOW))).toEqual([]);
  });
});

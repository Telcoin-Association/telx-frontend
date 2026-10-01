/**
 * @jest-environment node
 */
import { rpcPoolsFor } from "../pools/registry";
import { rewardsDayKey, type RewardsDayRow } from "../pools/merkl/history";
import { dayKey } from "../pools/rpc/store";
import { analyticsPoolName, assembleAnalytics, readAnalytics, type AnalyticsRedis } from "./series";

jest.mock("../pools/redis", () => ({ getRedis: () => ({}) }));

const DAY = 86_400;
const D1 = 1_790_726_400; // 2026-09-30 00:00 UTC
const D2 = D1 + DAY;

const [wethTel, eusdTel, eusdEmxn] = ["0xa22a3fb3", "0x1266df87", "0xe604df8f"].map(prefix => rpcPoolsFor("polygon").find(pool => pool.id.startsWith(prefix))!);

const merkl = (overrides: Partial<RewardsDayRow> = {}): RewardsDayRow => ({
  status: "LIVE",
  apr: 60,
  dailyRewards: 170,
  subscribedTvlUSD: 90_000,
  campaignIds: ["0xc1"],
  campaignStart: Date.UTC(2026, 8, 25),
  campaignEnd: Date.UTC(2026, 9, 2),
  pending: false,
  at: 1,
  ...overrides,
});

describe("assembleAnalytics", () => {
  it("joins each pool's day rows and rewards history by day, oldest first", () => {
    const result = assembleAnalytics([
      {
        pool: wethTel,
        dayRows: { [D2]: JSON.stringify({ tvlUSD: 150_000, volumeUSD: 300, feesUSD: 1, price1USD: 0.0024 }), [D1]: { tvlUSD: 140_000, volumeUSD: 200, feesUSD: 0.7, price1USD: 0.0022 } },
        rewardsDays: { [D1]: JSON.stringify(merkl({ apr: 55 })), [D2]: JSON.stringify(merkl({ apr: 65, subscribedTvlUSD: 97_000 })) },
      },
    ]);

    expect(result.historyFrom).toBe(D1);
    expect(result.rewardsFrom).toBe(D1);
    expect(result.pools[0]).toMatchObject({ id: wethTel.id, chain: "polygon", name: "WETH/TEL" });
    expect(result.pools[0].days).toEqual([
      { day: D1, tvlUSD: 140_000, volumeUSD: 200, feesUSD: 0.7, svlUSD: 90_000, apr: 55, dailyRewardsUSD: 170, status: "LIVE", estimated: false },
      { day: D2, tvlUSD: 150_000, volumeUSD: 300, feesUSD: 1, svlUSD: 97_000, apr: 65, dailyRewardsUSD: 170, status: "LIVE", estimated: false },
    ]);
  });

  it("starts the rewards history at the first Merkl row, independently of the backfilled day rows", () => {
    const result = assembleAnalytics([
      { pool: wethTel, dayRows: { [D1 - 8 * DAY]: { tvlUSD: 1 }, [D2]: { tvlUSD: 1 } }, rewardsDays: null },
      { pool: eusdTel, dayRows: { [D1]: { tvlUSD: 1 } }, rewardsDays: { [D2]: merkl() } },
    ]);
    expect(result).toMatchObject({ historyFrom: D1 - 8 * DAY, rewardsFrom: D2 });
    expect(assembleAnalytics([{ pool: wethTel, dayRows: { [D1]: { tvlUSD: 1 } }, rewardsDays: null }]).rewardsFrom).toBeNull();
  });

  it("counts SVL, APR and rewards only on days a campaign was live", () => {
    const result = assembleAnalytics([{ pool: eusdTel, dayRows: { [D1]: { tvlUSD: 10 } }, rewardsDays: { [D1]: merkl({ status: "SOON", apr: null }) } }]);
    expect(result.pools[0].days[0]).toMatchObject({ svlUSD: null, apr: null, dailyRewardsUSD: null, status: "SOON" });
  });

  it("prices TEL per day as the average of the TEL pools' closing prices, from TEL's own side", () => {
    const result = assembleAnalytics([
      { pool: wethTel, dayRows: { [D1]: { tvlUSD: 1, price0USD: 2600, price1USD: 0.002 } }, rewardsDays: null },
      { pool: eusdTel, dayRows: { [D1]: { tvlUSD: 1, price0USD: 1, price1USD: 0.004 } }, rewardsDays: null },
      { pool: eusdEmxn, dayRows: { [D1]: { tvlUSD: 1, price0USD: 1, price1USD: 0.055 } }, rewardsDays: null },
    ]);
    expect(result.telUSD[String(D1)]).toBeCloseTo(0.003);
  });

  it("summarizes each campaign over the days it was recorded", () => {
    const result = assembleAnalytics([
      {
        pool: wethTel,
        dayRows: null,
        rewardsDays: {
          [D1]: merkl({ apr: 120, dailyRewards: 150, subscribedTvlUSD: 50_000 }),
          [D2]: merkl({ apr: 60, dailyRewards: 170, subscribedTvlUSD: 97_000, campaignEnd: Date.UTC(2026, 9, 3) }),
        },
      },
    ]);
    expect(result.campaigns).toEqual([
      {
        id: "0xc1",
        chain: "polygon",
        poolId: wethTel.id,
        poolName: "WETH/TEL",
        start: Date.UTC(2026, 8, 25),
        end: Date.UTC(2026, 9, 3),
        dailyBudgetUSD: 170,
        aprMin: 60,
        aprMax: 120,
        peakSvlUSD: 97_000,
        estimated: false,
      },
    ]);
  });

  it("flags the days and campaigns whose rewards figures the backfill estimated from the chain", () => {
    const result = assembleAnalytics([
      {
        pool: wethTel,
        dayRows: null,
        rewardsDays: { [D1]: merkl({ apr: 120, source: "chain" }), [D2]: merkl({ apr: 60 }) },
      },
    ]);
    expect(result.pools[0].days.map(day => [day.day, day.estimated, day.apr])).toEqual([
      [D1, true, 120],
      [D2, false, 60],
    ]);
    expect(result.campaigns[0]).toMatchObject({ aprMin: 60, aprMax: 120, estimated: true });
    expect(result.rewardsFrom).toBe(D1);
  });

  it("has no history before anything is recorded, and skips unreadable fields", () => {
    expect(assembleAnalytics([{ pool: wethTel, dayRows: null, rewardsDays: null }])).toMatchObject({ historyFrom: null, campaigns: [] });
    const result = assembleAnalytics([{ pool: wethTel, dayRows: { notADay: { tvlUSD: 1 }, [D1]: "{broken" }, rewardsDays: { [D1]: "{broken" } }]);
    expect(result.pools[0].days).toEqual([]);
  });

  it("names pools from their token symbols rather than the registry label", () => {
    expect(analyticsPoolName(eusdEmxn)).toBe("eUSD/eMXN");
    expect(analyticsPoolName({ id: "0xunknown", chain: "polygon", name: "internal label" })).toBe("internal label");
  });
});

describe("readAnalytics", () => {
  it("reads every active pool's day rows and rewards history in one pipeline, in pool order", async () => {
    const keys: string[] = [];
    const pools = ["polygon", "base", "ethereum"].flatMap(chain => rpcPoolsFor(chain as "polygon"));
    const redis: AnalyticsRedis = {
      pipeline: () => ({
        hgetall: (key: string) => keys.push(key),
        exec: async () => keys.map(key => (key === dayKey("polygon", wethTel.id) ? { [D1]: { tvlUSD: 5 } } : null)),
      }),
    };
    const result = await readAnalytics(redis);

    expect(keys).toEqual(pools.flatMap(pool => [dayKey(pool.chain, pool.id), rewardsDayKey(pool.chain, pool.id)]));
    expect(result.pools).toHaveLength(pools.length);
    expect(result.pools.find(pool => pool.id === wethTel.id && pool.chain === "polygon")?.days).toEqual([
      { day: D1, tvlUSD: 5, volumeUSD: null, feesUSD: null, svlUSD: null, apr: null, dailyRewardsUSD: null, status: null, estimated: false },
    ]);
  });
});

/**
 * @jest-environment node
 */
import { memoryRedis } from "../testing";
import { parseRewardsDays, rewardsDayKey, rewardsDayRow, writeRewardsDays, type RewardsHistoryRedis } from "./history";
import type { PoolRewardsEntry } from "./match";

const POOL = "0xA22A3FB3AB8F44DB2692B0A810BC98E9459C8E746D08CDF09AFE31A08830DE0D";
const DAY_START = Date.UTC(2026, 9, 1) / 1000; // 2026-10-01 00:00 UTC, unix seconds

const entry = (overrides: Partial<PoolRewardsEntry["rewards"]> = {}): PoolRewardsEntry => ({
  id: POOL,
  rewards: {
    status: "LIVE",
    apr: 64.8,
    aprBreakdown: [{ campaignId: "0xc1", apr: 64.8, distributionType: "DUTCH_AUCTION" }],
    dailyRewards: 170,
    subscribedTvlUSD: 97_000,
    campaignStart: Date.UTC(2026, 8, 25),
    campaignEnd: Date.UTC(2026, 9, 2),
    ...overrides,
  },
});

const history = async (redis: RewardsHistoryRedis & { hgetall(key: string): Promise<Record<string, unknown> | null> }) =>
  parseRewardsDays(await redis.hgetall(rewardsDayKey("polygon", POOL)));

describe("Merkl rewards history", () => {
  it("records each matched pool under today's UTC day, keyed by the lowercase pool id", async () => {
    const redis = memoryRedis() as unknown as RewardsHistoryRedis & { hgetall(key: string): Promise<Record<string, unknown> | null> };
    const at = (DAY_START + 12 * 3600) * 1000;
    await writeRewardsDays(redis, "polygon", [entry()], at);

    expect(rewardsDayKey("polygon", POOL)).toBe(`merkl-rewards:polygon:day:${POOL.toLowerCase()}`);
    expect(await history(redis)).toEqual([[DAY_START, rewardsDayRow(entry(), at)]]);
    expect(rewardsDayRow(entry(), at)).toMatchObject({ status: "LIVE", apr: 64.8, campaignIds: ["0xc1"], pending: false, at });
  });

  it("rewrites the same day's row on later runs, so a rerun is idempotent and the day closes on its last run", async () => {
    const redis = memoryRedis() as unknown as RewardsHistoryRedis & { hgetall(key: string): Promise<Record<string, unknown> | null> };
    const morning = (DAY_START + 3600) * 1000;
    const evening = (DAY_START + 23 * 3600) * 1000;
    await writeRewardsDays(redis, "polygon", [entry({ apr: 50 })], morning);
    await writeRewardsDays(redis, "polygon", [entry({ apr: 60 })], evening);
    await writeRewardsDays(redis, "polygon", [entry({ apr: 60 })], evening);

    const days = await history(redis);
    expect(days).toHaveLength(1);
    expect(days[0][1]).toMatchObject({ apr: 60, at: evening });
  });

  it("starts a new row at the UTC day boundary and keeps the old one", async () => {
    const redis = memoryRedis() as unknown as RewardsHistoryRedis & { hgetall(key: string): Promise<Record<string, unknown> | null> };
    await writeRewardsDays(redis, "polygon", [entry({ apr: 50 })], (DAY_START - 1) * 1000);
    await writeRewardsDays(redis, "polygon", [entry({ apr: 70 })], (DAY_START + 1) * 1000);

    const days = await history(redis);
    expect(days.map(([day, row]) => [day, row.apr])).toEqual([
      [DAY_START - 86_400, 50],
      [DAY_START, 70],
    ]);
  });

  it("records a pending campaign as pending, with its null rates", () => {
    const row = rewardsDayRow(entry({ apr: null, dailyRewards: null, subscribedTvlUSD: null, aprBreakdown: [], pending: true }), 1);
    expect(row).toMatchObject({ apr: null, subscribedTvlUSD: null, campaignIds: [], pending: true });
  });

  it("skips fields that aren't a day or don't parse, and sorts oldest first", () => {
    const good = JSON.stringify(rewardsDayRow(entry(), 1));
    expect(parseRewardsDays({ "200": good, "100": good, notADay: good, "300": "{broken", "400": JSON.stringify({ status: "LIVE" }) }).map(([day]) => day)).toEqual([100, 200]);
    expect(parseRewardsDays(null)).toEqual([]);
  });
});

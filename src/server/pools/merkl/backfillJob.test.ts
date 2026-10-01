/**
 * @jest-environment node
 */
import { rpcPoolsFor } from "../registry";
import { TEL } from "../rpc/chains";
import { readChainSnapshot } from "../rpc/snapshot";
import { memoryRedis } from "../testing";
import { lastBlockBefore, readSubscribedTokenIds, sampleDay, SUBSCRIBER_FROM_BLOCK } from "./backfill";
import { rewardsBackfillKey, rewardsBackfillLockKey, runRewardsBackfill, runRewardsBackfillJob, type JobDeps, type JobRedis } from "./backfillJob";
import { fetchPoolCampaigns, type Campaign } from "./campaigns";
import { parseRewardsDays, rewardsDayKey, writeRewardsDays } from "./history";

jest.mock("../redis", () => ({ getRedis: jest.fn() }));
jest.mock("../rpc/snapshot", () => ({ readChainSnapshot: jest.fn() }));
jest.mock("../rpc/client", () => ({ rpcClient: jest.fn(), blockTimestampOf: jest.fn(async () => 0) }));
jest.mock("./campaigns", () => ({ ...jest.requireActual("./campaigns"), fetchPoolCampaigns: jest.fn() }));
jest.mock("./backfill", () => ({
  ...jest.requireActual("./backfill"),
  readSubscribedTokenIds: jest.fn(),
  lastBlockBefore: jest.fn(),
  sampleDay: jest.fn(),
}));

const DAY = 86_400;
const D1 = Date.UTC(2026, 8, 25) / 1000;
const pools = rpcPoolsFor("polygon");
const wethTel = pools.find(pool => pool.id.startsWith("0xa22a3fb3"))!;
const blockOf = (time: number) => 100_000_000 + time - D1;

const campaign: Campaign = { id: "0xc1", poolId: wethTel.id, start: D1, end: D1 + 7 * DAY, amount: 700_000, token: TEL, symbol: "TEL", priceUSD: 0.002 };

let headTime = D1 + 3 * DAY + 10 * 3600;
let clock = 0;

function deps(redis: JobRedis, budgetMs = 1e9): JobDeps {
  return { client: { request: jest.fn() }, redis, fetchImpl: jest.fn() as unknown as typeof fetch, now: () => clock, pools, budgetMs };
}

beforeEach(() => {
  jest.clearAllMocks();
  headTime = D1 + 3 * DAY + 10 * 3600;
  clock = 0;
  jest.mocked(fetchPoolCampaigns).mockResolvedValue([campaign]);
  jest.mocked(readChainSnapshot).mockImplementation(async () => ({ block: blockOf(headTime), timestamp: headTime, feeds: {}, pools: {} }));
  jest.mocked(readSubscribedTokenIds).mockImplementation(async (_client, _config, from) => (from === SUBSCRIBER_FROM_BLOCK.polygon ? ["1", "2"] : ["3"]));
  jest.mocked(lastBlockBefore).mockImplementation(async (_timeOf, target) => ({ block: blockOf(target - 1), timestamp: target - 1 }));
  jest.mocked(sampleDay).mockImplementation(async (_client, _config, _pools, _ids, day, block) => {
    clock += 1_000;
    return { day, block, prices: { [TEL]: 0.002 }, svlUSD: { [wethTel.id]: 100_000 }, svlAllUSD: { [wethTel.id]: 120_000 }, warnings: [] };
  });
});

const sampledDays = () => jest.mocked(sampleDay).mock.calls.map(call => call[4]);

describe("runRewardsBackfill", () => {
  it("samples each day from the first campaign through today and writes a chain row per day", async () => {
    const redis = memoryRedis();
    const body = await runRewardsBackfill("polygon", deps(redis));

    expect(sampledDays()).toEqual([D1, D1 + DAY, D1 + 2 * DAY, D1 + 3 * DAY]);
    expect(jest.mocked(sampleDay).mock.calls.at(-1)![5]).toBe(blockOf(headTime));
    expect(body).toMatchObject({ done: true, nextDay: "2026-09-28", campaigns: 1, positions: 2, daysSampled: 4, rowsWritten: 4, rowsKept: 0 });
    expect(body.pools).toEqual([{ poolId: wethTel.id, days: 4, from: "2026-09-25", svlUSD: 100_000, svlAllUSD: 120_000, apr: expect.any(Number) }]);
    const rows = parseRewardsDays(await redis.hgetall(rewardsDayKey("polygon", wethTel.id)));
    expect(rows.map(([day, row]) => [day, row.source, row.dailyRewards])).toEqual([0, 1, 2, 3].map(i => [D1 + i * DAY, "chain", 200]));
  });

  it("stops at its budget and resumes where it left off, sampling each closed day once", async () => {
    const redis = memoryRedis();
    const first = await runRewardsBackfill("polygon", deps(redis, 1_500));
    expect(first).toMatchObject({ done: false, nextDay: "2026-09-27", daysSampled: 2 });

    const second = await runRewardsBackfill("polygon", deps(redis, 1e9));
    expect(second).toMatchObject({ done: true, nextDay: "2026-09-28", daysSampled: 2 });
    expect(sampledDays()).toEqual([D1, D1 + DAY, D1 + 2 * DAY, D1 + 3 * DAY]);
    // The search for a day's block starts from the last block sampled.
    expect(jest.mocked(lastBlockBefore).mock.calls.at(-1)![2]).toEqual({ block: blockOf(D1 + 2 * DAY - 1), timestamp: D1 + 2 * DAY - 1 });
  });

  it("refreshes today on a later call and reads only the subscriptions since", async () => {
    const redis = memoryRedis();
    await runRewardsBackfill("polygon", deps(redis));
    headTime += DAY;
    jest.mocked(sampleDay).mockClear();
    const body = await runRewardsBackfill("polygon", deps(redis));

    expect(sampledDays()).toEqual([D1 + 3 * DAY, D1 + 4 * DAY]);
    expect(jest.mocked(readSubscribedTokenIds).mock.calls.at(-1)!.slice(2, 4)).toEqual([blockOf(headTime - DAY) + 1, blockOf(headTime)]);
    expect(body.positions).toBe(3);
  });

  it("keeps a day the cron recorded", async () => {
    const redis = memoryRedis();
    const entry = { id: wethTel.id, rewards: { status: "LIVE" as const, apr: 50, aprBreakdown: [], dailyRewards: 150, subscribedTvlUSD: 99_000, campaignStart: null, campaignEnd: null } };
    await writeRewardsDays(redis, "polygon", [entry], (D1 + DAY) * 1000);
    const body = await runRewardsBackfill("polygon", deps(redis));

    expect(body).toMatchObject({ rowsWritten: 3, rowsKept: 1 });
    const kept = parseRewardsDays(await redis.hgetall(rewardsDayKey("polygon", wethTel.id))).find(([day]) => day === D1 + DAY)![1];
    expect(kept.apr).toBe(50);
    expect(kept.source).toBeUndefined();
  });

  it("starts over on reset, rereading the subscriptions", async () => {
    const redis = memoryRedis();
    await runRewardsBackfill("polygon", deps(redis));
    jest.mocked(sampleDay).mockClear();
    await runRewardsBackfill("polygon", deps(redis), { reset: true });
    expect(sampledDays()[0]).toBe(D1);
    expect(jest.mocked(readSubscribedTokenIds).mock.calls.at(-1)![2]).toBe(SUBSCRIBER_FROM_BLOCK.polygon);
  });

  it("is done at once, with nothing written, on a chain without campaigns", async () => {
    const redis = memoryRedis();
    await redis.set(rewardsBackfillKey("polygon"), JSON.stringify({ logsTo: 1, tokenIds: [] }));
    jest.mocked(fetchPoolCampaigns).mockResolvedValue([]);
    const body = await runRewardsBackfill("polygon", deps(redis));

    expect(body).toMatchObject({ done: true, nextDay: null, daysSampled: 0, rowsWritten: 0, pools: [] });
    expect(redis.hashes.size).toBe(0);
    expect(await redis.get(rewardsBackfillKey("polygon"))).toBeNull();
  });
});

describe("runRewardsBackfillJob", () => {
  it("answers 409 while another call holds the lock, and releases its own", async () => {
    const redis = memoryRedis();
    await redis.set(rewardsBackfillLockKey("polygon"), "other", { nx: true, px: 60_000 });
    expect(await runRewardsBackfillJob("polygon", {}, { ...deps(redis), redis })).toEqual({ status: 409, body: { error: "A rewards backfill for this chain is in progress" } });

    await redis.del(rewardsBackfillLockKey("polygon"));
    expect((await runRewardsBackfillJob("polygon", {}, deps(redis))).status).toBe(200);
    expect(await redis.get(rewardsBackfillLockKey("polygon"))).toBeNull();
  });

  it("answers a fixed 500 when a call fails", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(fetchPoolCampaigns).mockRejectedValue(new Error("Merkl down"));
    const redis = memoryRedis();
    expect(await runRewardsBackfillJob("polygon", {}, deps(redis))).toEqual({ status: 500, body: { error: "Rewards backfill failed" } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Merkl down"));
    expect(await redis.get(rewardsBackfillLockKey("polygon"))).toBeNull();
    error.mockRestore();
  });
});

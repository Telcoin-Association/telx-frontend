/**
 * @jest-environment node
 */
import type { GroupedResponse, Snapshot } from "../cache";
import { runCronWrite } from "../cronWrite";
import { fakeRedis } from "../testing";
import polygonPage from "./__fixtures__/opportunities-polygon.json";
import { MERKL_JOBS, REWARDS_MAX_AGE_MS, attachRewards, rewardsById, rewardsKey, rewardsReadsFor } from "./store";

const kvMock = fakeRedis();
jest.mock("../redis", () => ({ getRedis: () => kvMock }));

const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const KEY = "merkl-rewards:polygon:v1";
const STATUS_KEY = `status:${KEY}`;

const live = {
  status: "LIVE" as const,
  apr: 66.9,
  aprBreakdown: [{ campaignId: "0xc1", apr: 66.9, distributionType: "DUTCH_AUCTION" }],
  dailyRewards: 168.4,
  subscribedTvlUSD: 91_840,
  campaignStart: 1_000,
  campaignEnd: 10_000_000,
};

const snapshot = (fetchedAt: number, data: unknown[]): Snapshot => ({
  fetchedAt,
  indexedAt: null,
  hasIndexingErrors: false,
  data: data as Snapshot["data"],
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Merkl cron jobs", () => {
  it("write one key per chain", () => {
    expect(Object.fromEntries(Object.entries(MERKL_JOBS).map(([job, options]) => [job, options.key]))).toEqual({
      "merkl-rewards-base": "merkl-rewards:base:v1",
      "merkl-rewards-polygon": KEY,
      "merkl-rewards-ethereum": "merkl-rewards:ethereum:v1",
    });
  });

  it("write the matched rewards of the chain's registry pools", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json(polygonPage));

    const res = await runCronWrite(MERKL_JOBS["merkl-rewards-polygon"]);

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("chainId=137");
    const [key, fields] = kvMock.hset.mock.calls[0];
    expect(key).toBe(KEY);
    const data = JSON.parse(fields.data);
    expect(data).toContainEqual({ id: WETH_TEL, rewards: expect.objectContaining({ status: "LIVE", subscribedTvlUSD: 91_840.50118663275 }) });
    expect(data.every((entry: { rewards: { status: string } }) => entry.rewards.status === "LIVE")).toBe(true);
  });

  it("write an empty list for a chain with no opportunities", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json([]));

    const res = await runCronWrite(MERKL_JOBS["merkl-rewards-base"]);

    expect(res.status).toBe(200);
    expect(kvMock.hset).toHaveBeenNthCalledWith(1, "merkl-rewards:base:v1", expect.objectContaining({ data: "[]" }));
  });

  it("leave the previous rewards in place and record the error when Merkl fails", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    const res = await runCronWrite(MERKL_JOBS["merkl-rewards-polygon"]);

    expect(res).toEqual({ status: 500, body: { error: "Cron job failed" } });
    expect(kvMock.hset.mock.calls.map(([key]) => key)).toEqual([STATUS_KEY]);
    expect(kvMock.hset).toHaveBeenCalledWith(STATUS_KEY, { lastError: "Merkl polygon: HTTP 503 on page 0", lastErrorAt: expect.any(Number) });
  });

  it("leave the previous rewards in place when the request throws", async () => {
    jest.spyOn(global, "fetch").mockRejectedValueOnce(new Error("socket hang up"));

    const res = await runCronWrite(MERKL_JOBS["merkl-rewards-ethereum"]);

    expect(res.status).toBe(500);
    expect(kvMock.hset.mock.calls.map(([key]) => key)).toEqual(["status:merkl-rewards:ethereum:v1"]);
  });
});

describe("rewardsReadsFor", () => {
  it("reads one rewards key per Uniswap group and none for the other protocols", () => {
    expect(rewardsReadsFor(["balancer", "uniswap-polygon", "quickswap", "uniswap-base"])).toEqual([
      { group: "uniswap-polygon", key: rewardsKey("polygon") },
      { group: "uniswap-base", key: rewardsKey("base") },
    ]);
  });
});

describe("rewardsById", () => {
  const NOW = 5_000_000;

  it("adds the snapshot's fetchedAt and indexes by lowercase id", () => {
    const byId = rewardsById(snapshot(NOW - 1, [{ id: WETH_TEL.toUpperCase().replace("0X", "0x"), rewards: live }]), NOW);

    expect(byId.get(WETH_TEL)).toEqual({ ...live, fetchedAt: NOW - 1 });
  });

  it("serves rewards exactly at the age limit and drops them past it", () => {
    const entries = [{ id: WETH_TEL, rewards: live }];

    expect(rewardsById(snapshot(NOW - REWARDS_MAX_AGE_MS, entries), NOW).size).toBe(1);
    expect(rewardsById(snapshot(NOW - REWARDS_MAX_AGE_MS - 1, entries), NOW).size).toBe(0);
  });

  it("is empty for a missing snapshot", () => {
    expect(rewardsById(null, NOW).size).toBe(0);
  });

  it("skips entries that fail validation", () => {
    const byId = rewardsById(
      snapshot(NOW, [
        { id: "0xbad", rewards: { ...live, status: "EARNING" } },
        { id: WETH_TEL, rewards: live },
      ]),
      NOW,
    );

    expect([...byId.keys()]).toEqual([WETH_TEL]);
  });

  it("reads a live campaign that has ended since the run as PAST, without rates", () => {
    const byId = rewardsById(snapshot(NOW, [{ id: WETH_TEL, rewards: { ...live, campaignEnd: NOW } }]), NOW);

    expect(byId.get(WETH_TEL)).toEqual({
      status: "PAST",
      apr: null,
      aprBreakdown: [],
      dailyRewards: null,
      subscribedTvlUSD: null,
      campaignStart: 1_000,
      campaignEnd: NOW,
      fetchedAt: NOW,
    });
  });
});

describe("attachRewards", () => {
  const group = (): GroupedResponse => ({
    fetchedAt: 1,
    indexedAt: null,
    hasIndexingErrors: false,
    parts: { hourly: null, daily: null, legacy: false },
    data: [
      { id: WETH_TEL, pool: null, poolSnapshots: [], threeMonthLiquidityData: [], metrics: null },
      { id: "0xother", pool: null, poolSnapshots: [], threeMonthLiquidityData: [], metrics: null },
    ],
  });

  it("gives every pool its rewards, null where none matched", () => {
    const response = group();
    attachRewards(response, snapshot(10, [{ id: WETH_TEL, rewards: live }]), 10);

    expect(response.data.map(pool => [pool.id, (pool as { rewards?: unknown }).rewards])).toEqual([
      [WETH_TEL, { ...live, fetchedAt: 10 }],
      ["0xother", null],
    ]);
  });

  it("gives every pool null rewards without a snapshot and leaves the rest of the pool as it was", () => {
    const response = group();
    attachRewards(response, null, 10);

    expect(response.data).toEqual(group().data.map(pool => ({ ...pool, rewards: null })));
  });

  it("does nothing for a group that did not load", () => {
    expect(() => attachRewards(undefined, null, 10)).not.toThrow();
  });
});

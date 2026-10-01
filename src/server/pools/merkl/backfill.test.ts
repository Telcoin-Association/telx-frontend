/**
 * @jest-environment node
 */
import { decodeFunctionData, encodeFunctionResult, pad, parseAbi, type Hex } from "viem";

import { MERKL_TELX_SUBSCRIBER } from "@/lib/contracts";

import { chainConfig, rpcPoolsFor } from "../registry";
import { MULTICALL3_ABI } from "../rpc/abi";
import { TEL } from "../rpc/chains";
import { getSqrtPriceAtTick } from "../rpc/liquidityMath";
import { memoryRedis } from "../testing";
import {
  backfillDays,
  CHAIN_SOURCE,
  lastBlockBefore,
  readPositionsAt,
  readSubscribedTokenIds,
  rewardsRowsForDay,
  SUBSCRIPTION_TOPIC,
  unpackPositionInfo,
  valueSubscribed,
  WRITE_UNLESS_RECORDED,
  writeChainRows,
  type PositionAt,
} from "./backfill";
import type { Campaign } from "./campaigns";
import { parseRewardsDays, rewardsDayKey, writeRewardsDays } from "./history";

const DAY = 86_400;
const D1 = Date.UTC(2026, 8, 25) / 1000; // 2026-09-25 00:00 UTC
const config = chainConfig("polygon");
const [wethTel, eusdTel] = ["0xa22a3fb3", "0x1266df87"].map(prefix => rpcPoolsFor("polygon").find(pool => pool.id.startsWith(prefix))!);

const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: "0xc1",
  poolId: wethTel.id,
  start: D1,
  end: D1 + 7 * DAY,
  amount: 700_000,
  token: TEL,
  symbol: "TEL",
  priceUSD: 0.002,
  ...overrides,
});

describe("rewardsRowsForDay", () => {
  it("spreads a campaign evenly per day and annualises its rate over SVL", () => {
    const rows = rewardsRowsForDay([campaign()], { day: D1 + DAY, prices: { [TEL]: 0.003 }, svlUSD: { [wethTel.id]: 100_000 } }, 42);
    const row = rows.get(wethTel.id)!;
    expect(row.dailyRewards).toBeCloseTo(300); // 100,000 TEL a day at $0.003
    expect(row.dailyRewardsTEL).toBeCloseTo(100_000);
    expect(row.apr).toBeCloseTo((300 / 100_000) * 365 * 100);
    expect(row).toMatchObject({ status: "LIVE", subscribedTvlUSD: 100_000, campaignIds: ["0xc1"], campaignStart: D1 * 1000, pending: false, at: 42, source: CHAIN_SOURCE });
  });

  it("counts a partial first day in part, while the APR stays at the full-day rate", () => {
    const evening = campaign({ start: D1 + 19 * 3600, end: D1 + 19 * 3600 + 7 * DAY });
    const row = rewardsRowsForDay([evening], { day: D1, prices: { [TEL]: 0.002 }, svlUSD: { [wethTel.id]: 50_000 } }, 0).get(wethTel.id)!;
    expect(row.dailyRewards).toBeCloseTo(200 * (5 / 24));
    expect(row.apr).toBeCloseTo((200 / 50_000) * 365 * 100);
    expect(row.dailyRewardsTEL).toBeCloseTo(100_000);
  });

  it("sums campaigns that overlap and hands over cleanly at a midnight rollover", () => {
    const first = campaign({ id: "0xc1", end: D1 + 7 * DAY });
    const second = campaign({ id: "0xc2", start: D1 + 7 * DAY, end: D1 + 14 * DAY, amount: 1_400_000 });
    const extra = campaign({ id: "0xc3", start: D1 + 7 * DAY + 12 * 3600, end: D1 + 8 * DAY + 12 * 3600, amount: 10_000 });
    const sample = (day: number) => ({ day, prices: { [TEL]: 0.001 }, svlUSD: { [wethTel.id]: 10_000 } });

    const lastOfFirst = rewardsRowsForDay([first, second, extra], sample(D1 + 6 * DAY), 0).get(wethTel.id)!;
    expect(lastOfFirst.campaignIds).toEqual(["0xc1"]);
    expect(lastOfFirst.dailyRewards).toBeCloseTo(100);

    const firstOfSecond = rewardsRowsForDay([first, second, extra], sample(D1 + 7 * DAY), 0).get(wethTel.id)!;
    expect(firstOfSecond.campaignIds).toEqual(["0xc2", "0xc3"]);
    expect(firstOfSecond.dailyRewards).toBeCloseTo(200 + 5);
    expect(firstOfSecond.campaignStart).toBe((D1 + 7 * DAY) * 1000);
    expect(firstOfSecond.campaignEnd).toBe((D1 + 14 * DAY) * 1000);
  });

  it("keeps each pool's campaigns to its own row and writes no row for a day without one", () => {
    const campaigns = [campaign(), campaign({ id: "0xd1", poolId: eusdTel.id, start: D1 + 2 * DAY, end: D1 + 3 * DAY, amount: 1_000 })];
    const rows = rewardsRowsForDay(campaigns, { day: D1 + DAY, prices: { [TEL]: 0.002 }, svlUSD: {} }, 0);
    expect([...rows.keys()]).toEqual([wethTel.id]);
    expect(rewardsRowsForDay(campaigns, { day: D1 + 30 * DAY, prices: { [TEL]: 0.002 }, svlUSD: {} }, 0).size).toBe(0);
  });

  it("leaves APR unknown without SVL, and rewards unknown without a price", () => {
    expect(rewardsRowsForDay([campaign()], { day: D1, prices: { [TEL]: 0.002 }, svlUSD: { [wethTel.id]: 0 } }, 0).get(wethTel.id)!.apr).toBeNull();
    const unpriced = rewardsRowsForDay([campaign({ priceUSD: null })], { day: D1, prices: {}, svlUSD: { [wethTel.id]: 1_000 } }, 0).get(wethTel.id)!;
    expect(unpriced.dailyRewards).toBeNull();
    expect(unpriced.apr).toBeNull();
  });

  it("prices TEL from the day's pools and another reward token at Merkl's price", () => {
    const usdc = campaign({ token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", symbol: "USDC", priceUSD: 1, amount: 7_000 });
    const row = rewardsRowsForDay([campaign({ priceUSD: 99 }), usdc], { day: D1, prices: { [TEL]: 0.002 }, svlUSD: { [wethTel.id]: 1_000 } }, 0).get(wethTel.id)!;
    expect(row.dailyRewards).toBeCloseTo(200 + 1_000);
    expect(row.dailyRewardsTEL).toBeCloseTo(100_000);
  });
});

describe("backfillDays", () => {
  it("runs from the first campaign's UTC day through today", () => {
    expect(backfillDays([campaign({ start: D1 + 19 * 3600 })], D1 + 2 * DAY)).toEqual([D1, D1 + DAY, D1 + 2 * DAY]);
    expect(backfillDays([], D1)).toEqual([]);
  });
});

describe("unpackPositionInfo", () => {
  it("reads the pool id prefix and signed ticks", () => {
    const prefix = BigInt(wethTel.id.slice(0, 52));
    const ticks = (tick: number) => BigInt(tick < 0 ? tick + 0x1000000 : tick);
    const info = (prefix << 56n) | (ticks(-887_220) << 32n) | (ticks(-120) << 8n) | 1n;
    expect(unpackPositionInfo(info)).toEqual({ poolIdPrefix: wethTel.id.slice(0, 52), tickLower: -120, tickUpper: -887_220 });
  });
});

describe("valueSubscribed", () => {
  const tick = 0;
  const snapshot = { pools: { [eusdTel.id]: { reserves: null, liquidity: null, slot0: { sqrtPriceX96: getSqrtPriceAtTick(tick), tick, protocolFee: 0, lpFee: 3000 } } } };
  const prices = { [eusdTel.key.currency0]: 1, [eusdTel.key.currency1]: 1 };
  const position = (overrides: Partial<PositionAt>): PositionAt => ({
    tokenId: "1",
    poolIdPrefix: eusdTel.id.slice(0, 52),
    tickLower: -600,
    tickUpper: 600,
    liquidity: 10n ** 18n,
    subscribed: true,
    ...overrides,
  });

  it("counts subscribed in-range positions, with out-of-range ones only in the full figure", () => {
    const inRange = position({ tokenId: "1" });
    const below = position({ tokenId: "2", tickLower: 600, tickUpper: 1200 });
    const one = valueSubscribed(config, [eusdTel], snapshot, prices, [inRange]);
    const both = valueSubscribed(config, [eusdTel], snapshot, prices, [inRange, below]);
    expect(one.inRange[eusdTel.id]).toBeGreaterThan(0);
    expect(both.inRange[eusdTel.id]).toBeCloseTo(one.inRange[eusdTel.id]!);
    expect(both.all[eusdTel.id]).toBeGreaterThan(one.all[eusdTel.id]!);
  });

  it("leaves out unsubscribed, empty and other pools' positions", () => {
    const value = valueSubscribed(config, [eusdTel], snapshot, prices, [
      position({ subscribed: false }),
      position({ liquidity: 0n }),
      position({ poolIdPrefix: wethTel.id.slice(0, 52) }),
    ]);
    expect(value.inRange[eusdTel.id]).toBe(0);
  });

  it("is unknown when the pool's price or a token price is missing", () => {
    expect(valueSubscribed(config, [eusdTel], { pools: {} }, prices, [position({})]).inRange[eusdTel.id]).toBeNull();
    expect(valueSubscribed(config, [eusdTel], snapshot, {}, [position({})]).inRange[eusdTel.id]).toBeNull();
  });
});

describe("lastBlockBefore", () => {
  // Two blocks a second, then one every five seconds from block 1,000.
  const timeOf = (block: number) => (block < 1_000 ? block / 2 : 500 + (block - 1_000) * 5);

  it("finds the last block before the target, counting the reads", async () => {
    let reads = 0;
    const counted = async (block: number) => (reads++, timeOf(block));
    const found = await lastBlockBefore(counted, 1_000, { block: 0, timestamp: 0 }, { block: 5_000, timestamp: timeOf(5_000) });
    expect(found).toEqual({ block: 1_099, timestamp: 995 });
    expect(reads).toBeLessThan(30);
  });

  it("answers the upper bound when it is still before the target", async () => {
    await expect(lastBlockBefore(async b => timeOf(b), 1e9, { block: 0, timestamp: 0 }, { block: 10, timestamp: 5 })).resolves.toEqual({ block: 10, timestamp: 5 });
  });
});

const PM_ABI = parseAbi([
  "function positionInfo(uint256 tokenId) view returns (uint256)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function subscriber(uint256 tokenId) view returns (address)",
]);

describe("readPositionsAt", () => {
  it("reads each position's pool, range, liquidity and subscriber at the block, skipping burned ones", async () => {
    const prefix = BigInt(wethTel.id.slice(0, 52));
    const state: Record<string, { info: bigint; liquidity: bigint; subscriber: Hex } | undefined> = {
      "7": { info: (prefix << 56n) | (600n << 32n) | (0xfffda8n << 8n) | 1n, liquidity: 5n, subscriber: MERKL_TELX_SUBSCRIBER },
      "8": { info: prefix << 56n, liquidity: 9n, subscriber: "0x0000000000000000000000000000000000000000" },
    };
    const blocks: string[] = [];
    const client = {
      async request({ params }: { method: string; params?: unknown }) {
        const [{ data }, block] = params as [{ data: Hex }, string];
        blocks.push(block);
        const { args } = decodeFunctionData({ abi: MULTICALL3_ABI, data });
        const calls = args![0] as readonly { callData: Hex }[];
        const results = calls.map(call => {
          const { functionName, args: inner } = decodeFunctionData({ abi: PM_ABI, data: call.callData });
          const position = state[String(inner![0])];
          if (!position) return { success: false, returnData: "0x" as Hex };
          const value = functionName === "positionInfo" ? position.info : functionName === "getPositionLiquidity" ? position.liquidity : position.subscriber;
          return { success: true, returnData: encodeFunctionResult({ abi: PM_ABI, functionName, result: value } as never) };
        });
        return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results });
      },
    };
    const positions = await readPositionsAt(client, config, ["7", "8", "9"], 1234);
    expect(blocks).toEqual(["0x4d2"]);
    expect(positions).toEqual([
      { tokenId: "7", poolIdPrefix: wethTel.id.slice(0, 52), tickLower: -600, tickUpper: 600, liquidity: 5n, subscribed: true },
      { tokenId: "8", poolIdPrefix: wethTel.id.slice(0, 52), tickLower: 0, tickUpper: 0, liquidity: 9n, subscribed: false },
    ]);
  });
});

describe("readSubscribedTokenIds", () => {
  it("filters the PositionManager's Subscription logs by the TELx subscriber and returns each token once", async () => {
    const filters: unknown[] = [];
    const log = (tokenId: bigint, block: number) => ({
      address: config.contracts.positionManager,
      blockNumber: `0x${block.toString(16)}`,
      blockHash: pad("0x1"),
      transactionHash: pad("0x2"),
      logIndex: "0x0",
      data: "0x",
      topics: [SUBSCRIPTION_TOPIC, pad(`0x${tokenId.toString(16)}`), pad(MERKL_TELX_SUBSCRIBER.toLowerCase() as Hex)],
    });
    const client = {
      async request({ params }: { method: string; params?: unknown }) {
        filters.push((params as unknown[])[0]);
        return [log(11n, 10), log(12n, 11), log(11n, 12)];
      },
    };
    expect(await readSubscribedTokenIds(client, config, 10, 20, 100)).toEqual(["11", "12"]);
    expect(filters[0]).toMatchObject({ address: config.contracts.positionManager, topics: [SUBSCRIPTION_TOPIC, null, pad(MERKL_TELX_SUBSCRIBER.toLowerCase() as Hex)] });
  });
});

describe("writeChainRows", () => {
  const row = rewardsRowsForDay([campaign()], { day: D1, prices: { [TEL]: 0.002 }, svlUSD: { [wethTel.id]: 1_000 } }, 1).get(wethTel.id)!;
  const key = rewardsDayKey("polygon", wethTel.id);

  it("marks its rows the way the guarded write looks for", () => {
    expect(JSON.stringify(row)).toContain('"source":"chain"');
    expect(WRITE_UNLESS_RECORDED).toContain(`'"source":"chain"'`);
  });

  it("never replaces a row the cron recorded, and the cron replaces a chain row", async () => {
    const entry = { id: wethTel.id, rewards: { status: "LIVE" as const, apr: 50, aprBreakdown: [], dailyRewards: 150, subscribedTvlUSD: 99_000, campaignStart: null, campaignEnd: null } };
    const cronAt = D1 * 1000 + 3_600_000;

    // The cron first: the backfill keeps its row.
    const first = memoryRedis();
    await writeRewardsDays(first, "polygon", [entry], cronAt);
    expect(await writeChainRows(first, "polygon", wethTel.id, new Map([[D1, row]]))).toBe(0);
    const recordedFirst = parseRewardsDays(await first.hgetall(key))[0][1];
    expect(recordedFirst.apr).toBe(50);
    expect(recordedFirst.source).toBeUndefined();

    // The backfill first: the cron replaces its row, and a later backfill leaves it.
    const second = memoryRedis();
    expect(await writeChainRows(second, "polygon", wethTel.id, new Map([[D1, row]]))).toBe(1);
    await writeRewardsDays(second, "polygon", [entry], cronAt);
    expect(await writeChainRows(second, "polygon", wethTel.id, new Map([[D1, row]]))).toBe(0);
    const recordedSecond = parseRewardsDays(await second.hgetall(key))[0][1];
    expect(recordedSecond.apr).toBe(50);
    expect(recordedSecond.source).toBeUndefined();
  });

  it("rewrites its own earlier row", async () => {
    const redis = memoryRedis();
    await writeChainRows(redis, "polygon", wethTel.id, new Map([[D1, row]]));
    expect(await writeChainRows(redis, "polygon", wethTel.id, new Map([[D1, { ...row, apr: 1 }]]))).toBe(1);
    expect(parseRewardsDays(await redis.hgetall(key))[0][1]).toMatchObject({ apr: 1, source: "chain" });
  });
});

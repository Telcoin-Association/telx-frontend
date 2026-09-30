/**
 * @jest-environment node
 */
import { memoryRedis } from "../testing";
import {
  acquireLock,
  clearChain,
  decodeLiquidity,
  encodeLiquidity,
  readCursor,
  readPoolData,
  readPositionChanges,
  readState,
  releaseLock,
  v3Key,
  writeChunk,
} from "./store";

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const BIG = 141595881482313519236224n;

describe("liquidity values", () => {
  it("survive a client that JSON-parses hash fields, exactly", async () => {
    const redis = memoryRedis();
    await writeChunk(redis, "polygon", {
      buckets: {},
      days: {},
      liquidity: { [POOL]: { set: { "-60:60": encodeLiquidity(BIG), "0:60": encodeLiquidity(5n) }, delete: [] } },
      state: {},
    });

    const data = await readPoolData(redis, "polygon", [POOL]);
    expect(data[POOL].liquidity).toEqual(
      new Map([
        ["-60:60", BIG],
        ["0:60", 5n],
      ]),
    );
  });

  it("decode from a quoted or bare string, and refuse an imprecise number", () => {
    expect(decodeLiquidity('"123"')).toBe(123n);
    expect(decodeLiquidity("123")).toBe(123n);
    expect(decodeLiquidity(42)).toBe(42n);
    expect(() => decodeLiquidity(Number(BIG))).toThrow("not an exact integer");
  });
});

describe("writeChunk", () => {
  it("writes buckets, days, liquidity, state and cursor together, and deletes expired fields", async () => {
    const redis = memoryRedis();
    await redis.hset(`rpc:polygon:b5m:${POOL}`, { "100": JSON.stringify({ swaps: 1 }) });

    await writeChunk(redis, "polygon", {
      buckets: {
        [POOL]: {
          set: { "400": JSON.stringify({ swaps: 2, volumeUSD: 1, feesUSD: 0, lpFeesUSD: 0, protocolFeesUSD: 0, lastSwapAt: 401 }) },
          delete: ["100"],
        },
      },
      days: { [POOL]: { set: { "0": JSON.stringify({ swaps: 2, volumeUSD: 1, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 10 }) }, delete: [] } },
      liquidity: {},
      state: { block: 7, timestamp: 70, [`pool:${POOL}`]: JSON.stringify({ tvlUSD: 10, feesUSD: 1, swaps: 2 }) },
      cursor: { block: 7, timestamp: 70, updatedAt: 1, pools: [POOL] },
    });

    const data = await readPoolData(redis, "polygon", [POOL]);
    expect([...data[POOL].buckets.keys()]).toEqual([400]);
    expect(data[POOL].days.get(0)?.tvlUSD).toBe(10);
    const state = await readState(redis, "polygon");
    expect(state).toMatchObject({ block: 7, timestamp: 70, prices: null });
    expect(state.pools[POOL]).toMatchObject({ tvlUSD: 10, feesUSD: 1, swaps: 2, lastSwapAt: null });
    await expect(readCursor(redis, "polygon")).resolves.toEqual({ block: 7, timestamp: 70, updatedAt: 1, pools: [POOL] });
  });

  it("writes nothing when the transaction fails", async () => {
    const redis = memoryRedis();
    redis.failExec();
    await expect(
      writeChunk(redis, "polygon", {
        buckets: {},
        days: {},
        liquidity: {},
        state: { block: 1 },
        cursor: { block: 1, timestamp: 1, updatedAt: 1, pools: [] },
      }),
    ).rejects.toThrow("EXEC failed");
    expect(redis.hashes.size).toBe(0);
  });
});

describe("clearChain", () => {
  it("deletes the chain's rpc: keys and its v3 payload, and nothing of other chains", async () => {
    const redis = memoryRedis();
    for (const key of [
      "rpc:base:cursor",
      "rpc:base:state",
      `rpc:base:b5m:${POOL}`,
      `rpc:base:liq:${POOL}`,
      `rpc:base:pos:${POOL}`,
      v3Key("base"),
      "rpc:polygon:cursor",
      v3Key("polygon"),
    ]) {
      await redis.hset(key, { x: 1 });
    }
    await clearChain(redis, "base", [POOL]);
    expect([...redis.hashes.keys()].sort()).toEqual([v3Key("polygon"), "rpc:polygon:cursor"].sort());
  });
});

describe("the lock", () => {
  it("is held by one run at a time and released only by its holder", async () => {
    const redis = memoryRedis();
    expect(await acquireLock(redis, "base", "a")).toBe(true);
    expect(await acquireLock(redis, "base", "b")).toBe(false);
    await releaseLock(redis, "base", "b");
    expect(await acquireLock(redis, "base", "b")).toBe(false);
    await releaseLock(redis, "base", "a");
    expect(await acquireLock(redis, "base", "b")).toBe(true);
  });
});

describe("readPositionChanges", () => {
  it("returns one token's changes in block order, from stored strings or parsed objects", async () => {
    const redis = memoryRedis();
    await redis.hset(`rpc:base:pos:${POOL}`, {
      "42:20:1": JSON.stringify({ t: 20, tickLower: -60, tickUpper: 60, d: "-5" }),
      "42:10:3": JSON.stringify({ t: 10, tickLower: -60, tickUpper: 60, d: "9" }),
      "420:5:0": JSON.stringify({ t: 5, tickLower: -60, tickUpper: 60, d: "1" }),
      "42:bad": "x",
    });
    const changes = await readPositionChanges(redis as never, "base", POOL, 42n);
    expect(changes.map(({ block, logIndex, d }) => [block, logIndex, d])).toEqual([
      [10, 3, "9"],
      [20, 1, "-5"],
    ]);
  });
});

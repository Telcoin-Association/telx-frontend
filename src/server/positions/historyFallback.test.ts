/**
 * @jest-environment node
 */
import { encodeAbiParameters, pad, parseAbiParameters, toHex, type Hex } from "viem";

import { MODIFY_LIQUIDITY_TOPIC } from "../pools/rpc/abi";
import { DAY, dayStart } from "../pools/rpc/buckets";
import { TEL } from "../pools/rpc/chains";
import { priceChain } from "../pools/rpc/pricing";
import type { ChainSnapshot } from "../pools/rpc/snapshot";
import { chainConfig, rpcPoolsFor, type RpcPool } from "../pools/registry";
import { readChainSnapshot } from "../pools/rpc/snapshot";
import { cursorKey, dayKey, stateKey, type RpcRedis } from "../pools/rpc/store";
import { memoryRedis } from "../pools/testing";
import type { RpcChain } from "@/lib/rpc";
import { polygonTelAt, polygonTelOnDay, positionHistory, tokenPriceAt, type BlockPrices, type HistoryClient } from "./history";

jest.mock("../pools/rpc/snapshot", () => ({ ...jest.requireActual("../pools/rpc/snapshot"), readChainSnapshot: jest.fn() }));
const mockSnapshot = readChainSnapshot as jest.MockedFunction<typeof readChainSnapshot>;

/**
 * Deposits and withdrawals on a chain whose TEL routes are thin at the block: the pipeline's block pricing
 * flags TEL stale, history drops it, and the day row's stored price (then Polygon's TEL price that day) fills in.
 */

const Q96 = 2n ** 96n;
const NOW = 1_791_500_000; // 2026-10-09
const TODAY = dayStart(NOW);
const TOKEN = 444_560n;
const LIQUIDITY = 10n ** 15n;
const [TICK_LOWER, TICK_UPPER] = [-887_220, 887_220];
const OWNER = "0x00000000000000000000000000000000000000aa";

/** TEL at the deposit, by the pool price, against eUSD at $1. */
const TEL_AT_DEPOSIT = 0.0018;
/** What the pipeline stored for TEL in the pool's day row for the deposit day. */
const STORED_TEL = 0.00177;
/** Polygon's TEL price that day. */
const POLYGON_TEL = 0.00179;
/** TEL on Polygon's own pools at the deposit, by archive read. */
const POLYGON_ARCHIVE_TEL = 0.00181;
/** The pipeline's latest TEL price. */
const TEL_NOW = 0.0019;

const isTel = (address: string) => address.toLowerCase() === TEL;
const telPool = (chain: RpcChain) => rpcPoolsFor(chain).find(pool => pool.id.startsWith("0x1266df87")) as RpcPool;

/** The sqrt price of a pool whose currency0 is eUSD (6 decimals) and currency1 TEL (18), with TEL at `telUsd`. */
const sqrtFor = (telUsd: number) => {
  const raw = (1 / telUsd) * 10 ** 12;
  return BigInt(Math.round(Math.sqrt(raw) * 2 ** 48)) * 2n ** 48n;
};

function setup(chain: RpcChain) {
  const config = chainConfig(chain);
  const pool = telPool(chain);
  const head = { block: pool.createdBlock + 50_000, timestamp: NOW - 60 };
  const deposit = TODAY - 2 * DAY + 3600;
  const depositBlock = head.block - Math.ceil((head.timestamp - deposit) / config.blockTime);
  const sqrtNow = sqrtFor(TEL_NOW);
  const word = (BigInt(pool.id.slice(0, 52)) << 56n) | (BigInt(TICK_UPPER & 0xffffff) << 32n) | (BigInt(TICK_LOWER & 0xffffff) << 8n);
  const log = {
    address: config.contracts.poolManager,
    blockNumber: toHex(depositBlock),
    blockHash: pad("0x", { size: 32 }),
    blockTimestamp: toHex(deposit),
    transactionHash: pad(toHex(depositBlock), { size: 32 }),
    logIndex: "0x0",
    data: encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [TICK_LOWER, TICK_UPPER, LIQUIDITY, pad(toHex(TOKEN), { size: 32 })]),
    topics: [MODIFY_LIQUIDITY_TOPIC, pool.id as Hex, pad(config.contracts.positionManager as Hex, { size: 32 })],
    removed: false,
  };
  const client: HistoryClient = {
    request: (async ({ method }: { method: string }) => {
      if (method === "eth_getLogs") return [log];
      if (method === "eth_blockNumber") return toHex(head.block);
      throw new Error(`unexpected ${method}`);
    }) as never,
    multicall: (async ({ contracts }: { contracts: readonly { functionName: string }[] }) =>
      contracts.map(({ functionName }) => {
        switch (functionName) {
          case "positionInfo":
            return { status: "success" as const, result: word };
          case "getPositionLiquidity":
            return { status: "success" as const, result: LIQUIDITY };
          case "ownerOf":
            return { status: "success" as const, result: OWNER };
          case "getSlot0":
            return { status: "success" as const, result: [sqrtNow, 0, 0, 3000] };
          case "getPositionInfo":
            return { status: "success" as const, result: [LIQUIDITY, 0n, 0n] };
          case "getFeeGrowthInside":
            return { status: "success" as const, result: [0n, 0n] };
          default:
            throw new Error(`unexpected ${functionName}`);
        }
      })) as never,
    readContract: (async () => [sqrtNow, 0, 0, 3000]) as never,
  };
  return { config, pool, head, deposit, depositBlock, client };
}

/**
 * Block prices the way pricedAtBlock reads them: the pipeline's pricing at the deposit block with nothing
 * stored to carry over, and any price it flags stale dropped. `eusdHeld` is the eUSD side of the pool there.
 */
function pricedFromRoutes(chain: RpcChain, pool: RpcPool, eusdHeld: number) {
  const config = chainConfig(chain);
  const pools = rpcPoolsFor(chain);
  const sqrt = sqrtFor(TEL_AT_DEPOSIT);
  const snapshot: ChainSnapshot = {
    block: 1,
    timestamp: NOW,
    feeds: { "ETH/USD": { answer: 2_500n * 10n ** 8n, updatedAt: NOW } },
    pools: Object.fromEntries(pools.map(candidate => [candidate.id, { reserves: null, liquidity: null, slot0: candidate.id === pool.id ? { sqrtPriceX96: sqrt, tick: 0, protocolFee: 0, lpFee: 3000 } : null }])),
  };
  const reserves = { [pool.id]: { amount0: BigInt(Math.round(eusdHeld * 1e6)), amount1: 10n ** 24n } };
  const { tokens } = priceChain({ config, pools, snapshot, reserves, last: {}, polygonTel: null });
  const usd = (address: string) => {
    const price = tokens[address.toLowerCase()];
    return price && !price.stale ? price.usd : null;
  };
  return async (): Promise<BlockPrices> => ({ sqrt, usd0: usd(pool.key.currency0), usd1: usd(pool.key.currency1) });
}

const dayRow = (price0USD: number | null, price1USD: number | null) =>
  JSON.stringify({ swaps: 1, volumeUSD: 10, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 1_000, sqrtPriceX96: Q96.toString(), tick: 0, price0USD, price1USD });

async function seed(redis: RpcRedis, chain: RpcChain, pool: RpcPool, head: { block: number; timestamp: number }, depositDayRow: string | null) {
  await redis.hset(cursorKey(chain), { block: head.block, timestamp: head.timestamp, updatedAt: 0, pools: "[]" });
  await redis.hset(stateKey(chain), {
    prices: JSON.stringify({ tokens: { [pool.key.currency0.toLowerCase()]: { usd: 1, source: "fixed" }, [TEL]: { usd: TEL_NOW, source: "pools" } }, telRoutes: [], impliedEusd: null }),
  });
  await redis.hset(dayKey(chain, pool.id), {
    [TODAY]: dayRow(1, TEL_NOW),
    ...(depositDayRow && { [TODAY - 2 * DAY]: depositDayRow }),
  });
}

/** Polygon's TEL pools' day rows for the deposit day, with TEL at `usd` on each. */
async function seedPolygon(redis: RpcRedis, day: number, usd: number) {
  for (const pool of rpcPoolsFor("polygon")) {
    if (!isTel(pool.key.currency0) && !isTel(pool.key.currency1)) continue;
    await redis.hset(dayKey("polygon", pool.id), { [day]: isTel(pool.key.currency0) ? dayRow(usd, 1) : dayRow(1, usd) });
  }
}

/** Polygon's pools at a block, with TEL at `telUsd` on every TEL route and each route deep. ETH at $2,500. */
function polygonSnapshot(block: number, telUsd: number): ChainSnapshot {
  const config = chainConfig("polygon");
  const usdOf = (address: string) => (isTel(address) ? telUsd : config.tokens[address.toLowerCase()]?.symbol === "WETH" ? 2_500 : 1);
  const decimalsOf = (address: string) => config.tokens[address.toLowerCase()].decimals;
  const pools = rpcPoolsFor("polygon");
  return {
    block,
    timestamp: NOW,
    feeds: { "ETH/USD": { answer: 2_500n * 10n ** 8n, updatedAt: NOW }, "MXN/USD": { answer: 5_500_000n, updatedAt: NOW } },
    pools: Object.fromEntries(
      pools.map(pool => {
        const [c0, c1] = [pool.key.currency0, pool.key.currency1];
        const raw = (usdOf(c0) / usdOf(c1)) * 10 ** (decimalsOf(c1) - decimalsOf(c0));
        const sqrtPriceX96 = BigInt(Math.round(Math.sqrt(raw) * 2 ** 48)) * 2n ** 48n;
        return [pool.id, { slot0: { sqrtPriceX96, tick: 0, protocolFee: 0, lpFee: 3000 }, liquidity: 1n, reserves: { amount0: 10n ** 30n, amount1: 10n ** 30n } }];
      }),
    ),
  };
}

/** A Polygon client whose blocks come every two seconds up to `head`, so the configured block time is off. */
function polygonClient(head: { block: number; timestamp: number }) {
  const timeOf = (block: number) => head.timestamp - (head.block - block) * 2;
  const request = jest.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "eth_getBlockByNumber") return { timestamp: toHex(timeOf(Number.parseInt((params as [string])[0], 16))) };
    if (method === "eth_blockNumber") return toHex(head.block);
    throw new Error(`unexpected ${method}`);
  });
  return { client: { request }, timeOf, request };
}

beforeEach(() => mockSnapshot.mockReset());

describe("tokenPriceAt", () => {
  it("takes the block's price, then the day row's stored price, then Polygon's", () => {
    expect(tokenPriceAt(0.0018, 0.00177, 0.00179)).toEqual({ usd: 0.0018, from: "block" });
    expect(tokenPriceAt(null, 0.00177, 0.00179)).toEqual({ usd: 0.00177, from: "stored" });
    expect(tokenPriceAt(null, null, 0.00179)).toEqual({ usd: 0.00179, from: "polygon" });
    expect(tokenPriceAt(null, undefined, null)).toBeNull();
  });

  it("skips a price that isn't positive", () => {
    expect(tokenPriceAt(0, 0, 0.00179)).toEqual({ usd: 0.00179, from: "polygon" });
    expect(tokenPriceAt(Number.NaN, -1, 0)).toBeNull();
  });
});

describe("polygonTelOnDay", () => {
  it("is the TEL side of Polygon's TEL pools' day rows for the day", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seedPolygon(redis, TODAY - DAY, POLYGON_TEL);
    await expect(polygonTelOnDay(redis, TODAY - DAY)).resolves.toBeCloseTo(POLYGON_TEL, 12);
  });

  it("is null when Polygon stored nothing that day", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seedPolygon(redis, TODAY - DAY, POLYGON_TEL);
    await expect(polygonTelOnDay(redis, TODAY - 5 * DAY)).resolves.toBeNull();
  });
});

describe("polygonTelAt", () => {
  it("reads Polygon's pools at the block nearest the time, correcting the estimate by one block's time", async () => {
    const head = { block: 80_000_000, timestamp: NOW - 60 };
    const { client, timeOf, request } = polygonClient(head);
    mockSnapshot.mockImplementation(async (_client, _config, _pools, block) => polygonSnapshot(block as number, POLYGON_ARCHIVE_TEL));
    const time = NOW - 2 * DAY;

    await expect(polygonTelAt(client, head, time)).resolves.toBeCloseTo(POLYGON_ARCHIVE_TEL, 9);

    const block = mockSnapshot.mock.calls[0][3] as number;
    expect(Math.abs(timeOf(block) - time)).toBeLessThanOrEqual(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("is null when TEL is stale on Polygon too", async () => {
    const head = { block: 80_000_000, timestamp: NOW - 60 };
    const { client } = polygonClient(head);
    mockSnapshot.mockImplementation(async (_client, _config, _pools, block) => {
      const snapshot = polygonSnapshot(block as number, POLYGON_ARCHIVE_TEL);
      for (const pool of Object.values(snapshot.pools)) pool.reserves = { amount0: 1n, amount1: 1n };
      return snapshot;
    });
    await expect(polygonTelAt(client, head, NOW - DAY)).resolves.toBeNull();
  });
});

describe.each<RpcChain>(["ethereum", "base"])("positionHistory on %s with thin TEL routes at the deposit", chain => {
  it("values TEL at the day row's stored price, so the P&L is known", async () => {
    const { pool, head, client } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, dayRow(1, STORED_TEL));
    const pricedAt = pricedFromRoutes(chain, pool, 100);
    // The thin route leaves TEL stale at the block, which the block pricing drops.
    await expect(pricedAt()).resolves.toMatchObject({ usd0: 1, usd1: null });

    const history = await positionHistory(chain, TOKEN, { client, redis, positionManager: chainConfig(chain).contracts.positionManager, now: () => NOW * 1000, pricedAt });
    const { performance, deposited } = history!;

    expect(performance.priceChange.token0).toMatchObject({ open: 1, openFrom: "block" });
    expect(performance.priceChange.token1).toMatchObject({ open: STORED_TEL, now: TEL_NOW, openFrom: "stored" });
    expect(performance.priceChange.token1.change).toBeCloseTo(TEL_NOW / STORED_TEL - 1, 12);
    expect(performance.depositedUSD).toBeCloseTo(deposited!.amount0 * 1 + deposited!.amount1 * STORED_TEL, 9);
    expect(performance.pnlUSD).not.toBeNull();
    expect(performance.pnl).not.toBeNull();
    expect(history!.notes.join(" ")).toMatch(/valued at that day's stored prices/);
  });

  it("values TEL at Polygon's price that day when the day row has none", async () => {
    const { pool, head, client } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, null);
    await seedPolygon(redis, TODAY - 2 * DAY, POLYGON_TEL);

    const history = await positionHistory(chain, TOKEN, {
      client,
      redis,
      positionManager: chainConfig(chain).contracts.positionManager,
      now: () => NOW * 1000,
      pricedAt: pricedFromRoutes(chain, pool, 100),
    });
    const { performance } = history!;

    expect(performance.priceChange.token1).toMatchObject({ open: POLYGON_TEL, openFrom: "polygon" });
    expect(performance.pnlUSD).not.toBeNull();
    expect(history!.notes.join(" ")).toMatch(/its price on Polygon/);
  });

  it("values TEL at Polygon's pools at the deposit when no day row has a price", async () => {
    const { pool, head, client, deposit } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, null);
    const polygonHead = { block: 80_000_000, timestamp: NOW - 60 };
    await redis.hset(cursorKey("polygon"), { block: polygonHead.block, timestamp: polygonHead.timestamp, updatedAt: 0, pools: "[]" });
    const polygon = polygonClient(polygonHead);
    mockSnapshot.mockImplementation(async (_client, _config, _pools, block) => polygonSnapshot(block as number, POLYGON_ARCHIVE_TEL));

    const history = await positionHistory(chain, TOKEN, {
      client,
      redis,
      positionManager: chainConfig(chain).contracts.positionManager,
      now: () => NOW * 1000,
      pricedAt: pricedFromRoutes(chain, pool, 100),
      polygon: polygon.client,
    });
    const { performance } = history!;

    expect(performance.priceChange.token1.openFrom).toBe("polygon");
    expect(performance.priceChange.token1.open).toBeCloseTo(POLYGON_ARCHIVE_TEL, 9);
    expect(performance.pnlUSD).not.toBeNull();
    expect(Math.abs(polygon.timeOf(mockSnapshot.mock.calls[0][3] as number) - deposit)).toBeLessThanOrEqual(2);
    expect(history!.notes.join(" ")).toMatch(/its price on Polygon/);
  });

  it("prefers Polygon's stored day price to an archive read", async () => {
    const { pool, head, client } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, null);
    await seedPolygon(redis, TODAY - 2 * DAY, POLYGON_TEL);
    const polygon = polygonClient({ block: 80_000_000, timestamp: NOW - 60 });

    const history = await positionHistory(chain, TOKEN, {
      client,
      redis,
      positionManager: chainConfig(chain).contracts.positionManager,
      now: () => NOW * 1000,
      pricedAt: pricedFromRoutes(chain, pool, 100),
      polygon: polygon.client,
    });

    expect(history!.performance.priceChange.token1).toMatchObject({ open: POLYGON_TEL, openFrom: "polygon" });
    expect(polygon.request).not.toHaveBeenCalled();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it("keeps a deep route's price as it is, ahead of the stored and Polygon prices", async () => {
    const { pool, head, client } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, dayRow(1, STORED_TEL));
    await seedPolygon(redis, TODAY - 2 * DAY, POLYGON_TEL);

    const history = await positionHistory(chain, TOKEN, {
      client,
      redis,
      positionManager: chainConfig(chain).contracts.positionManager,
      now: () => NOW * 1000,
      pricedAt: pricedFromRoutes(chain, pool, 50_000),
    });
    const { performance } = history!;

    expect(performance.priceChange.token1.openFrom).toBe("block");
    expect(performance.priceChange.token1.open).toBeCloseTo(TEL_AT_DEPOSIT, 9);
    expect(history!.notes.join(" ")).not.toMatch(/stored prices|on Polygon/);
  });

  it("still has no P&L when no price is known at all", async () => {
    const { pool, head, client } = setup(chain);
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis, chain, pool, head, null);

    const history = await positionHistory(chain, TOKEN, {
      client,
      redis,
      positionManager: chainConfig(chain).contracts.positionManager,
      now: () => NOW * 1000,
      pricedAt: pricedFromRoutes(chain, pool, 100),
    });

    expect(history!.performance.priceChange.token1).toMatchObject({ open: null, openFrom: null });
    expect(history!.performance.depositedUSD).toBeNull();
    expect(history!.performance.pnlUSD).toBeNull();
  });
});

import "server-only";

import type { RpcChain } from "@/lib/rpc";

import type { Bucket, DayRow } from "./buckets";
import type { TelRoute, TokenPrice } from "./pricing";

/**
 * Redis layout of the Uniswap v4 RPC pipeline, per chain:
 *
 * | Key | Content | Kept |
 * | `rpc:<chain>:cursor` | `block`, `timestamp`, `updatedAt` of the last block folded in | always |
 * | `rpc:<chain>:lock` | run id | 240 s, or until the run ends |
 * | `rpc:<chain>:b5m:<poolId>` | 5-minute bucket start to bucket JSON | 48 hours |
 * | `rpc:<chain>:day:<poolId>` | UTC day start to day row JSON | always (one small row per pool per day) |
 * | `rpc:<chain>:liq:<poolId>` | `tickLower:tickUpper` to net liquidity | always |
 * | `rpc:<chain>:pos:<poolId>` | `tokenId:block:logIndex` to a PositionManager liquidity change | always |
 * | `rpc:<chain>:state` | `block`, `timestamp`, `prices`, and `pool:<id>` per pool, with the TVL carried from before the cron's day-row window | latest |
 * | `rpc:<chain>:backfill` | backfill progress | until done |
 * | `active-uniswap-<chain>-grouped:v3` | the payload, written by runCronWrite | latest |
 *
 * Each chunk's changes and the cursor (or backfill progress) are written in one MULTI/EXEC, so the cursor
 * never moves without the data it covers. The cron reads only the day rows of its DAY_ROWS-day window, with
 * HMGET; the backfill and the analytics read every day row.
 */

export const LOCK_TTL_MS = 240_000;

export const cursorKey = (chain: RpcChain) => `rpc:${chain}:cursor`;
export const lockKey = (chain: RpcChain) => `rpc:${chain}:lock`;
export const bucketKey = (chain: RpcChain, poolId: string) => `rpc:${chain}:b5m:${poolId}`;
export const dayKey = (chain: RpcChain, poolId: string) => `rpc:${chain}:day:${poolId}`;
export const liquidityKey = (chain: RpcChain, poolId: string) => `rpc:${chain}:liq:${poolId}`;
export const positionsKey = (chain: RpcChain, poolId: string) => `rpc:${chain}:pos:${poolId}`;
export const stateKey = (chain: RpcChain) => `rpc:${chain}:state`;
export const backfillKey = (chain: RpcChain) => `rpc:${chain}:backfill`;
export const v3Key = (chain: RpcChain) => `active-uniswap-${chain}-grouped:v3`;

/** The Redis commands the pipeline uses. The Upstash client satisfies it; tests use an in-memory double. */
export type RpcRedisCommands<R> = {
  hset(key: string, values: Record<string, unknown>): R;
  hdel(key: string, ...fields: string[]): R;
  del(...keys: string[]): R;
};

export type RpcRedis = RpcRedisCommands<Promise<unknown>> & {
  hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
  /** The listed fields, each null when missing, or null when the key does not exist. */
  hmget<T = Record<string, unknown>>(key: string, ...fields: string[]): Promise<T | null>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string, options: { nx: true; px: number }): Promise<unknown>;
  multi(): RpcRedisCommands<unknown> & { exec(): Promise<unknown[]> };
};

/** The last block folded in, and the sorted ids of the pools the backfill covered (a JSON array when stored). */
export type Cursor = { block: number; timestamp: number; updatedAt: number; pools: string[] };
export type BackfillProgress = { nextBlock: number; timestamp: number; updatedAt: number };

export type PoolState = {
  sqrtPriceX96: string | null;
  tick: number | null;
  liquidity: string | null;
  reserves: { amount0: string; amount1: string; source: "lens" | "positions" } | null;
  tvlUSD: number | null;
  /** Both TVL methods when both were available, for the lens check in health. */
  tvlLensUSD: number | null;
  tvlPositionsUSD: number | null;
  lastSwapAt: number | null;
  lastActivityAt: number | null;
  createdAt: number | null;
  /**
   * The newest stored day-row TVL before day `first`, kept so that the cron reads only the day rows from `first`
   * on and the daily rows still carry a TVL from before them. Null until the cron first computes it.
   */
  tvlBefore: { first: number; tvlUSD: number | null } | null;
  /** Totals since the backfill started. */
  feesUSD: number;
  swaps: number;
};

export type StoredPrices = { tokens: Record<string, TokenPrice>; telRoutes: TelRoute[]; impliedEusd: number | null };

export type StoredState = { block: number | null; timestamp: number | null; prices: StoredPrices | null; pools: Record<string, PoolState> };

export type PoolData = { buckets: Map<number, Bucket>; days: Map<number, DayRow>; liquidity: Map<string, bigint> };

export const emptyPoolState = (): PoolState => ({
  sqrtPriceX96: null,
  tick: null,
  liquidity: null,
  reserves: null,
  tvlUSD: null,
  tvlLensUSD: null,
  tvlPositionsUSD: null,
  lastSwapAt: null,
  lastActivityAt: null,
  createdAt: null,
  tvlBefore: null,
  feesUSD: 0,
  swaps: 0,
});

/** A hash field value as it comes back: parsed JSON when the client deserializes, the raw string when not. */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function numberOf(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Liquidity is written as a JSON string (`"123"`), so a client that deserializes hash fields returns the
 * digits as a string instead of parsing a large integer into an imprecise number.
 */
export const encodeLiquidity = (value: bigint) => JSON.stringify(value.toString());

export function decodeLiquidity(value: unknown): bigint {
  if (typeof value === "string") return BigInt(value.replace(/^"|"$/g, ""));
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`liquidity value ${String(value)} is not an exact integer`);
}

export async function readCursor(redis: RpcRedis, chain: RpcChain): Promise<Cursor | null> {
  const raw = await redis.hgetall(cursorKey(chain));
  const block = numberOf(raw?.block);
  const timestamp = numberOf(raw?.timestamp);
  if (block === null || timestamp === null) return null;
  const pools = parseJson<unknown>(raw?.pools);
  return { block, timestamp, updatedAt: numberOf(raw?.updatedAt) ?? 0, pools: Array.isArray(pools) ? pools.map(String) : [] };
}

export async function readBackfill(redis: RpcRedis, chain: RpcChain): Promise<BackfillProgress | null> {
  const raw = await redis.hgetall(backfillKey(chain));
  const nextBlock = numberOf(raw?.nextBlock);
  const timestamp = numberOf(raw?.timestamp);
  if (nextBlock === null || timestamp === null) return null;
  return { nextBlock, timestamp, updatedAt: numberOf(raw?.updatedAt) ?? 0 };
}

/** Takes the chain's lock for `runId`. False when another run holds it. */
export async function acquireLock(redis: RpcRedis, chain: RpcChain, runId: string): Promise<boolean> {
  return (await redis.set(lockKey(chain), runId, { nx: true, px: LOCK_TTL_MS })) === "OK";
}

/** Releases the lock if this run still holds it. */
export async function releaseLock(redis: RpcRedis, chain: RpcChain, runId: string): Promise<void> {
  if ((await redis.get(lockKey(chain))) === runId) await redis.del(lockKey(chain));
}

export async function readState(redis: RpcRedis, chain: RpcChain): Promise<StoredState> {
  const raw = (await redis.hgetall(stateKey(chain))) ?? {};
  const pools: Record<string, PoolState> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (!field.startsWith("pool:")) continue;
    const parsed = parseJson<PoolState>(value);
    if (parsed) pools[field.slice(5)] = { ...emptyPoolState(), ...parsed };
  }
  return { block: numberOf(raw.block), timestamp: numberOf(raw.timestamp), prices: parseJson<StoredPrices>(raw.prices), pools };
}

/** The day rows to read for a pool: every one, or only the UTC days from `from` to `to`. */
export type DayRange = "all" | { from: number; to: number };

const dayFields = ({ from, to }: { from: number; to: number }) => {
  const fields: string[] = [];
  for (let day = from; day <= to; day += 86400) fields.push(String(day));
  return fields;
};

/**
 * Buckets, day rows and liquidity map of each pool. Day rows are read in full unless `dayRanges` gives a pool a
 * bounded range, which is read with HMGET so the cost of a run does not grow with the days kept.
 */
export async function readPoolData(
  redis: RpcRedis,
  chain: RpcChain,
  poolIds: readonly string[],
  dayRanges: Readonly<Record<string, DayRange>> = {},
): Promise<Record<string, PoolData>> {
  const entries = await Promise.all(
    poolIds.map(async (id): Promise<[string, PoolData]> => {
      const range = dayRanges[id] ?? "all";
      const [buckets, days, liquidity] = await Promise.all([
        redis.hgetall(bucketKey(chain, id)),
        range === "all" ? redis.hgetall(dayKey(chain, id)) : redis.hmget(dayKey(chain, id), ...dayFields(range)),
        redis.hgetall(liquidityKey(chain, id)),
      ]);
      const data: PoolData = { buckets: new Map(), days: new Map(), liquidity: new Map() };
      for (const [field, value] of Object.entries(buckets ?? {})) {
        const bucket = parseJson<Bucket>(value);
        if (bucket) data.buckets.set(Number(field), bucket);
      }
      for (const [field, value] of Object.entries(days ?? {})) {
        const day = parseJson<DayRow>(value);
        if (day) data.days.set(Number(field), day);
      }
      for (const [field, value] of Object.entries(liquidity ?? {})) data.liquidity.set(field, decodeLiquidity(value));
      return [id, data];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * One PositionManager liquidity change, stored under `tokenId:block:logIndex` so that a chunk only adds fields
 * and the cron never reads the key. `d` is the signed liquidity delta as a decimal string.
 */
export type PositionChange = { t: number; tickLower: number; tickUpper: number; d: string };

export const positionField = (tokenId: bigint, block: number, logIndex: number) => `${tokenId}:${block}:${logIndex}`;

/** A position's liquidity changes in block order, from its pool's positions key. */
export async function readPositionChanges(
  redis: Pick<RpcRedis, "hgetall">,
  chain: RpcChain,
  poolId: string,
  tokenId: bigint,
): Promise<(PositionChange & { block: number; logIndex: number })[]> {
  const raw = (await redis.hgetall(positionsKey(chain, poolId))) ?? {};
  const prefix = `${tokenId}:`;
  const changes: (PositionChange & { block: number; logIndex: number })[] = [];
  for (const [field, value] of Object.entries(raw)) {
    if (!field.startsWith(prefix)) continue;
    const [, block, logIndex] = field.split(":").map(Number);
    const change = parseJson<PositionChange>(value);
    if (!change || !Number.isFinite(block) || !Number.isFinite(logIndex)) continue;
    changes.push({ ...change, d: String(change.d), block, logIndex });
  }
  return changes.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

/** What one chunk changed, written together with the cursor or the backfill progress. */
export type ChunkWrite = {
  buckets: Record<string, { set: Record<string, string>; delete: string[] }>;
  days: Record<string, { set: Record<string, string>; delete: string[] }>;
  liquidity: Record<string, { set: Record<string, string>; delete: string[] }>;
  /** New PositionManager liquidity changes per pool; fields are only ever added. */
  positions?: Record<string, Record<string, string>>;
  state: Record<string, unknown>;
  cursor?: Cursor;
  backfill?: BackfillProgress;
};

export async function writeChunk(redis: RpcRedis, chain: RpcChain, write: ChunkWrite): Promise<void> {
  const tx = redis.multi();
  const apply = (key: string, change: { set: Record<string, string>; delete: string[] }) => {
    if (Object.keys(change.set).length) tx.hset(key, change.set);
    if (change.delete.length) tx.hdel(key, ...change.delete);
  };
  for (const [id, change] of Object.entries(write.buckets)) apply(bucketKey(chain, id), change);
  for (const [id, change] of Object.entries(write.days)) apply(dayKey(chain, id), change);
  for (const [id, change] of Object.entries(write.liquidity)) apply(liquidityKey(chain, id), change);
  for (const [id, fields] of Object.entries(write.positions ?? {})) if (Object.keys(fields).length) tx.hset(positionsKey(chain, id), fields);
  if (Object.keys(write.state).length) tx.hset(stateKey(chain), write.state);
  if (write.cursor) tx.hset(cursorKey(chain), { ...write.cursor, pools: JSON.stringify(write.cursor.pools) });
  if (write.backfill) tx.hset(backfillKey(chain), write.backfill);
  await tx.exec();
}

/**
 * Deletes every `rpc:` key of the chain's pools and its v3 payload (the backfill's reset), so that no payload
 * from before the reset is served while the chain is rebuilt. The lock is left to the caller.
 */
export async function clearChain(redis: RpcRedis, chain: RpcChain, poolIds: readonly string[]): Promise<void> {
  const keys = [cursorKey(chain), stateKey(chain), backfillKey(chain), v3Key(chain)];
  for (const id of poolIds) keys.push(bucketKey(chain, id), dayKey(chain, id), liquidityKey(chain, id), positionsKey(chain, id));
  await redis.del(...keys);
}

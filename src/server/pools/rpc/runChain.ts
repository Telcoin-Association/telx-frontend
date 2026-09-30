import "server-only";

import { blockTimestampOf } from "./client";
import { TEL, type ChainConfig } from "./chains";
import { addSwap, dayStart, emptyDay, expiredKeys } from "./buckets";
import { fetchPoolEvents, type PoolEvent } from "./logs";
import { buildPayload, type V3Pool } from "./payload";
import { priceChain, type ChainPrices } from "./pricing";
import { readChainSnapshot, type ChainSnapshot } from "./snapshot";
import {
  clearChain,
  emptyPoolState,
  encodeLiquidity,
  readBackfill,
  readCursor,
  readPoolData,
  readState,
  writeChunk,
  backfillKey,
  positionField,
  type ChunkWrite,
  type PoolData,
  type PositionChange,
  type RpcRedis,
  type StoredState,
} from "./store";
import { swapPrices, valueSwap } from "./swapMath";
import { poolReserves, positionSum, reservesUsd } from "./tvl";
import { chainConfig, rpcPoolsFor, type RpcPool } from "../registry";
import type { RpcChain } from "@/lib/rpc";
import type { RpcRequester } from "@/server/chain/logs";

/**
 * The Uniswap v4 RPC pipeline for one chain. Both entry points fold PoolManager events into the stored
 * aggregate one chunk at a time; every chunk is priced with a snapshot read at its last block and written
 * with its cursor in one transaction.
 *
 * - `runChain` (the 5-minute cron) reads from the cursor to the chain's head tag block (`safe` on Base and
 *   Ethereum, `finalized` on Polygon; see `headTag` in chains.ts), in chunks of up to 12 hours
 *   of blocks, at most MAX_CHUNKS or RUN_BUDGET_MS per run, and returns the payload.
 * - `runBackfill` (the admin route) starts at the earliest pool's creation block, walks one hour of blocks at
 *   a time with archive snapshots and position-sum TVL, and writes the cursor when it reaches the finalized
 *   block.
 * The backfill reads to the finalized block. The cron reads to the head tag block and does not rewind if a
 * `safe` block is later reorganized, which needs Ethereum to reorganize before finalizing. The caller holds
 * the chain's lock.
 */

export const MAX_CHUNKS = 4;
export const RUN_BUDGET_MS = 120_000;
export const BACKFILL_BUDGET_MS = 150_000;

/** Alchemy compute units, for the run report. */
const CU = { eth_call: 26, eth_getLogs: 60 };

export type RunDeps = {
  client: RpcRequester;
  redis: RpcRedis;
  now?: () => number;
  /** Merkl's TEL price; the cron fetches it once per run, the backfill does not use it. */
  merklTel?: () => Promise<{ usd: number | null; warning?: string }>;
  config?: ChainConfig;
  pools?: readonly RpcPool[];
};

export type Loaded = { state: StoredState; data: Record<string, PoolData> };

/** An aggregate with nothing stored yet. */
export function emptyLoaded(pools: readonly RpcPool[]): Loaded {
  const loaded: Loaded = { state: { block: null, timestamp: null, prices: null, pools: {} }, data: {} };
  for (const pool of pools) {
    loaded.state.pools[pool.id] = emptyPoolState();
    loaded.data[pool.id] = { buckets: new Map(), days: new Map(), liquidity: new Map() };
  }
  return loaded;
}

export type RunReport = { fromBlock: number; toBlock: number; chunks: number; logs: number; calls: number; computeUnits: number; durationMs: number };

export type FoldContext = { chain: RpcChain; config: ChainConfig; pools: readonly RpcPool[] };
type Context = FoldContext & { deps: RunDeps; now: () => number };

function contextOf(chain: RpcChain, deps: RunDeps): Context {
  return { chain, config: deps.config ?? chainConfig(chain), pools: deps.pools ?? rpcPoolsFor(chain), deps, now: deps.now ?? Date.now };
}

async function load(ctx: Context): Promise<Loaded> {
  const [state, data] = await Promise.all([
    readState(ctx.deps.redis, ctx.chain),
    readPoolData(
      ctx.deps.redis,
      ctx.chain,
      ctx.pools.map(pool => pool.id),
    ),
  ]);
  for (const pool of ctx.pools) state.pools[pool.id] ??= emptyPoolState();
  return { state, data };
}

/** Polygon's TEL price is used by other chains only while Polygon's stored state is at most this old. */
export const POLYGON_TEL_MAX_AGE_SECONDS = 3600;

/**
 * Polygon's latest stored TEL price, for chains without a usable TEL route. Null, with a warning, when Polygon's
 * state is older than POLYGON_TEL_MAX_AGE_SECONDS at `now` (unix seconds) or has no TEL price.
 */
export async function polygonTelPrice(redis: RpcRedis, now: number): Promise<{ usd: number | null; warning?: string }> {
  const polygon = await readState(redis, "polygon");
  const usd = polygon.prices?.tokens[TEL]?.usd ?? null;
  if (usd === null || polygon.timestamp === null) return { usd: null };
  const age = now - polygon.timestamp;
  if (age > POLYGON_TEL_MAX_AGE_SECONDS) return { usd: null, warning: `Polygon's TEL price is ${age}s old; not used` };
  return { usd };
}

async function polygonTel(ctx: Context, warnings: string[]): Promise<number | null> {
  if (ctx.chain === "polygon") return null;
  const { usd, warning } = await polygonTelPrice(ctx.deps.redis, Math.floor(ctx.now() / 1000));
  if (warning) warnings.push(`Uniswap ${ctx.chain} RPC: ${warning}`);
  return usd;
}

/** Sorted ids of the pools a chain's cursor covers. */
const poolSet = (pools: readonly RpcPool[]) => pools.map(pool => pool.id).sort();

function requirePrice(ctx: FoldContext, prices: ChainPrices, address: string): number {
  const usd = prices.tokens[address]?.usd;
  if (usd === undefined) throw new Error(`${ctx.chain}: no price for ${ctx.config.tokens[address]?.symbol ?? address}`);
  return usd;
}

async function processChunk(
  ctx: Context,
  loaded: Loaded,
  from: { block: number; timestamp: number },
  snapshot: ChainSnapshot,
  mode: "live" | "backfill",
  tel: number | null,
  merklTel: number | null = null,
) {
  const range = { fromBlock: from.block + 1, toBlock: snapshot.block, fromTime: from.timestamp, toTime: snapshot.timestamp };
  const { events, calls } = await fetchPoolEvents(
    ctx.deps.client,
    ctx.config.contracts.poolManager,
    ctx.pools.map(pool => pool.id),
    range,
  );
  return { ...foldChunk(ctx, loaded, events, snapshot, mode, tel, merklTel), logs: events.length, calls };
}

/**
 * Folds one chunk's events (sorted) into `loaded`, prices them with the snapshot at the chunk's last block, and
 * returns the writes. Liquidity changes are applied first, so TVL and the thin-route check see the positions at
 * the chunk's end. `live` takes reserves from the lens when it answered; `backfill` always uses the position sum.
 */
export function foldChunk(
  ctx: FoldContext,
  loaded: Loaded,
  events: readonly PoolEvent[],
  snapshot: ChainSnapshot,
  mode: "live" | "backfill",
  tel: number | null,
  merklTel: number | null = null,
): { write: ChunkWrite; warnings: string[] } {
  const { config, pools } = ctx;
  const write: ChunkWrite = { buckets: {}, days: {}, liquidity: {}, positions: {}, state: {} };
  const positionManager = config.contracts.positionManager.toLowerCase();
  const warnings: string[] = [];
  const changed = (map: ChunkWrite["buckets"], id: string) => (map[id] ??= { set: {}, delete: [] });

  for (const event of events) {
    if (event.kind !== "liquidity") continue;
    const liquidity = loaded.data[event.poolId].liquidity;
    const range = `${event.tickLower}:${event.tickUpper}`;
    const next = (liquidity.get(range) ?? 0n) + event.liquidityDelta;
    if (next < 0n)
      warnings.push(`${ctx.chain}: range ${range} of pool ${event.poolId} would hold negative liquidity; its liquidity history is incomplete`);
    if (next === 0n) {
      liquidity.delete(range);
      changed(write.liquidity, event.poolId).delete.push(range);
    } else {
      liquidity.set(range, next);
      changed(write.liquidity, event.poolId).set[range] = encodeLiquidity(next);
    }
    if (event.sender === positionManager) {
      const change: PositionChange = { t: event.timestamp, tickLower: event.tickLower, tickUpper: event.tickUpper, d: event.liquidityDelta.toString() };
      const fields = (write.positions![event.poolId] ??= {});
      fields[positionField(BigInt(event.salt), event.block, event.logIndex)] = JSON.stringify(change);
    }
    const state = loaded.state.pools[event.poolId];
    state.lastActivityAt = Math.max(state.lastActivityAt ?? 0, event.timestamp);
  }

  const reserves = Object.fromEntries(
    pools.map(pool => [pool.id, poolReserves(loaded.data[pool.id].liquidity, snapshot.pools[pool.id], mode === "live")]),
  );
  const last = Object.fromEntries(Object.entries(loaded.state.prices?.tokens ?? {}).map(([address, price]) => [address, price.usd]));
  const prices = priceChain({ config, pools, snapshot, reserves, last, polygonTel: tel, merklTel });
  const poolPrices = Object.fromEntries(
    pools.map(pool => [pool.id, [requirePrice(ctx, prices, pool.key.currency0), requirePrice(ctx, prices, pool.key.currency1)] as const]),
  );
  const decimalsOf = (pool: RpcPool) => [config.tokens[pool.key.currency0].decimals, config.tokens[pool.key.currency1].decimals] as const;

  for (const event of events) {
    if (event.kind !== "swap") continue;
    const pool = pools.find(candidate => candidate.id === event.poolId) as RpcPool;
    const protocolFee = snapshot.pools[pool.id]?.slot0?.protocolFee ?? 0;
    const decimals = decimalsOf(pool);
    const prices = swapPrices(event.sqrtPriceX96, pool.anchor, poolPrices[pool.id][pool.anchor], decimals);
    const value = valueSwap(event, pool.anchor, decimals, prices, protocolFee);
    const data = loaded.data[pool.id];
    const keys = addSwap(data.buckets, data.days, event.timestamp, value);
    changed(write.buckets, pool.id).set[keys.bucket] = JSON.stringify(data.buckets.get(keys.bucket));
    changed(write.days, pool.id).set[keys.day] = JSON.stringify(data.days.get(keys.day));
    const state = loaded.state.pools[pool.id];
    state.feesUSD += value.feesUSD;
    state.swaps += 1;
    state.lastSwapAt = Math.max(state.lastSwapAt ?? 0, event.timestamp);
    state.lastActivityAt = Math.max(state.lastActivityAt ?? 0, event.timestamp);
  }

  const today = dayStart(snapshot.timestamp);
  for (const pool of pools) {
    const state = loaded.state.pools[pool.id];
    const data = loaded.data[pool.id];
    const point = snapshot.pools[pool.id];
    const decimals = decimalsOf(pool);
    const held = reserves[pool.id];
    const positions = positionSum(data.liquidity, point);
    state.sqrtPriceX96 = point?.slot0?.sqrtPriceX96.toString() ?? state.sqrtPriceX96;
    state.tick = point?.slot0?.tick ?? state.tick;
    state.liquidity = point?.liquidity?.toString() ?? state.liquidity;
    state.reserves = held && { amount0: held.amount0.toString(), amount1: held.amount1.toString(), source: held.source };
    state.tvlUSD = held ? reservesUsd(held, decimals, poolPrices[pool.id]) : null;
    state.tvlLensUSD = point?.reserves ? reservesUsd(point.reserves, decimals, poolPrices[pool.id]) : null;
    state.tvlPositionsUSD = positions ? reservesUsd(positions, decimals, poolPrices[pool.id]) : null;

    if (state.createdAt === null || snapshot.timestamp >= state.createdAt) {
      const day = data.days.get(today) ?? emptyDay();
      day.tvlUSD = state.tvlUSD;
      day.sqrtPriceX96 = state.sqrtPriceX96;
      day.tick = state.tick;
      [day.price0USD, day.price1USD] = poolPrices[pool.id];
      data.days.set(today, day);
      changed(write.days, pool.id).set[today] = JSON.stringify(day);
    }

    const expired = expiredKeys(data.buckets, data.days, snapshot.timestamp);
    for (const key of expired.buckets) {
      data.buckets.delete(key);
      changed(write.buckets, pool.id).delete.push(String(key));
      delete changed(write.buckets, pool.id).set[key];
    }
    for (const key of expired.days) {
      data.days.delete(key);
      changed(write.days, pool.id).delete.push(String(key));
      delete changed(write.days, pool.id).set[key];
    }
    write.state[`pool:${pool.id}`] = JSON.stringify(state);
  }

  loaded.state.block = snapshot.block;
  loaded.state.timestamp = snapshot.timestamp;
  loaded.state.prices = { tokens: prices.tokens, telRoutes: prices.telRoutes, impliedEusd: prices.impliedEusd };
  write.state.block = snapshot.block;
  write.state.timestamp = snapshot.timestamp;
  write.state.prices = JSON.stringify(loaded.state.prices);

  return { write, warnings: [...warnings, ...prices.warnings] };
}

export type RunResult = { pools: V3Pool[]; asOf: number; warnings: string[]; report: RunReport };

/** One cron run. Throws when the chain has no cursor (no backfill yet) or a read fails; nothing past the last full chunk is written. */
export async function runChain(chain: RpcChain, deps: RunDeps): Promise<RunResult> {
  const ctx = contextOf(chain, deps);
  const started = ctx.now();
  const cursor = await readCursor(deps.redis, chain);
  if (!cursor) throw new Error(`Uniswap ${chain} RPC: no cursor; run the backfill first`);
  const expected = poolSet(ctx.pools);
  if (expected.join() !== cursor.pools.join()) {
    const added = expected.filter(id => !cursor.pools.includes(id));
    const removed = cursor.pools.filter(id => !expected.includes(id));
    throw new Error(
      `Uniswap ${chain} RPC: backfill needed; the active pools changed since it ran (added ${added.join(", ") || "none"}, removed ${removed.join(", ") || "none"}). Run the backfill once with ?reset=1`,
    );
  }

  const loaded = await load(ctx);
  const head = await readChainSnapshot(deps.client, ctx.config, ctx.pools, ctx.config.headTag);
  const warnings: string[] = [];
  const tel = await polygonTel(ctx, warnings);
  const merkl = (await deps.merklTel?.().catch(() => null)) ?? { usd: null };
  if (merkl.warning) warnings.push(merkl.warning);
  const report: RunReport = {
    fromBlock: cursor.block + 1,
    toBlock: cursor.block,
    chunks: 0,
    logs: 0,
    calls: 0,
    computeUnits: CU.eth_call,
    durationMs: 0,
  };

  let current = { block: cursor.block, timestamp: cursor.timestamp };
  while (current.block < head.block && report.chunks < MAX_CHUNKS && ctx.now() - started < RUN_BUDGET_MS) {
    const end = Math.min(head.block, current.block + ctx.config.maxBlocksPerChunk);
    const snapshot = end === head.block ? head : await readChainSnapshot(deps.client, ctx.config, ctx.pools, end);
    if (snapshot !== head) report.computeUnits += CU.eth_call;
    const chunk = await processChunk(ctx, loaded, current, snapshot, "live", tel, merkl.usd);
    chunk.write.cursor = { block: snapshot.block, timestamp: snapshot.timestamp, updatedAt: ctx.now(), pools: expected };
    await writeChunk(deps.redis, chain, chunk.write);
    current = { block: snapshot.block, timestamp: snapshot.timestamp };
    warnings.push(...chunk.warnings);
    report.chunks += 1;
    report.logs += chunk.logs;
    report.calls += chunk.calls;
    report.computeUnits += CU.eth_getLogs * chunk.calls;
    report.toBlock = snapshot.block;
  }

  const now = Math.floor(ctx.now() / 1000);
  const limit = ctx.config.lagLimitSeconds;
  const lagging = head.timestamp - current.timestamp > limit || now - current.timestamp > limit;
  if (lagging) warnings.push(`Uniswap ${chain} RPC: data at block ${current.block} is behind the chain; 24h values withheld`);
  report.durationMs = ctx.now() - started;
  return {
    pools: buildPayload({ pools: ctx.pools, state: loaded.state, data: loaded.data, asOf: current.timestamp, now, lagging }),
    asOf: current.timestamp,
    warnings: [...new Set(warnings)],
    report,
  };
}

export type BackfillResult = { done: boolean; nextBlock: number; finalizedBlock: number; chunks: number; warnings: string[] };

/**
 * One call of the backfill. Resumes from `rpc:<chain>:backfill`, or starts at the earliest pool's creation
 * block (reading each pool's creation time). Stops at the finalized block, where it writes the cursor, or
 * after BACKFILL_BUDGET_MS. `reset` first deletes the chain's `rpc:` keys. A chain that already has a cursor
 * is done.
 */
export async function runBackfill(chain: RpcChain, deps: RunDeps, options: { reset?: boolean } = {}): Promise<BackfillResult> {
  const ctx = contextOf(chain, deps);
  const started = ctx.now();
  const ids = ctx.pools.map(pool => pool.id);
  if (options.reset) await clearChain(deps.redis, chain, ids);

  const cursor = await readCursor(deps.redis, chain);
  if (cursor) return { done: true, nextBlock: cursor.block + 1, finalizedBlock: cursor.block, chunks: 0, warnings: [] };

  const loaded = await load(ctx);
  let progress = await readBackfill(deps.redis, chain);
  if (!progress) {
    const first = Math.min(...ctx.pools.map(pool => pool.createdBlock));
    progress = { nextBlock: first, timestamp: await blockTimestampOf(deps.client, first - 1), updatedAt: ctx.now() };
  }
  for (const pool of ctx.pools) {
    const state = loaded.state.pools[pool.id];
    state.createdAt ??= await blockTimestampOf(deps.client, pool.createdBlock);
  }

  const finalized = await readChainSnapshot(deps.client, ctx.config, ctx.pools, "finalized");
  const warnings: string[] = [];
  const tel = await polygonTel(ctx, warnings);
  let current = { block: progress.nextBlock - 1, timestamp: progress.timestamp };
  let chunks = 0;
  while (current.block < finalized.block && ctx.now() - started < BACKFILL_BUDGET_MS) {
    const end = Math.min(finalized.block, current.block + ctx.config.backfillChunkBlocks);
    const snapshot = end === finalized.block ? finalized : await readChainSnapshot(deps.client, ctx.config, ctx.pools, end);
    const chunk = await processChunk(ctx, loaded, current, snapshot, "backfill", tel);
    chunk.write.backfill = { nextBlock: snapshot.block + 1, timestamp: snapshot.timestamp, updatedAt: ctx.now() };
    if (snapshot.block === finalized.block) {
      chunk.write.cursor = { block: snapshot.block, timestamp: snapshot.timestamp, updatedAt: ctx.now(), pools: poolSet(ctx.pools) };
    }
    await writeChunk(deps.redis, chain, chunk.write);
    current = { block: snapshot.block, timestamp: snapshot.timestamp };
    warnings.push(...chunk.warnings);
    chunks += 1;
  }

  const done = current.block >= finalized.block;
  if (done) await deps.redis.del(backfillKey(chain));
  return { done, nextBlock: current.block + 1, finalizedBlock: finalized.block, chunks, warnings: [...new Set(warnings)] };
}

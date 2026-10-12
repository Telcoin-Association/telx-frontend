import "server-only";

import { randomUUID } from "node:crypto";

import { describeError } from "@/app/api/backendHelpers/errors";
import type { RpcChain } from "@/lib/rpc";
import type { RpcRequester } from "@/server/chain/logs";

import { lastBlockBefore, type BlockTime } from "../merkl/backfill";
import { getRedis } from "../redis";
import { chainConfig, rpcPoolsFor, type RpcPool } from "../registry";
import { DAY, dayStart, HOUR, HOUR_RETENTION, hourStart, type StoredHour } from "./buckets";
import { TEL, type ChainConfig } from "./chains";
import { blockTimestampOf, rpcClient } from "./client";
import { fetchPoolEvents, type PoolEvent, type SwapEvent } from "./logs";
import { priceChain } from "./pricing";
import { readChainSnapshot, type ChainSnapshot } from "./snapshot";
import { acquireLock, hourKey, readCursor, readHours, readPoolData, readState, releaseLock, type RpcRedis } from "./store";
import { swapPrices, valueSwap } from "./swapMath";
import { poolReserves, reservesUsd } from "./tvl";

/**
 * Backfill of the hourly closing rows (`rpc:<chain>:hour:<poolId>`) for the hours of the retention window that
 * have none, such as the hours before the cron started writing them. Each call, under the chain's lock:
 *
 * 1. picks the missing hours: every UTC hour from the start of the retention window to the hour before the
 *    cursor's (the cron owns that one), for each pool created by the hour's end, that has no stored row. A chain
 *    hour is missing when any pool's row is. The newest `limit` of them are filled first.
 * 2. finds each hour's closing block, the last block before the hour ends, and the closing block of the hour
 *    before it (where the hour's swaps start), with a block time search below the cursor.
 * 3. reads the archive bundle at each closing block, and the PoolManager events from the oldest boundary to the
 *    cursor block. Each pool's liquidity map at a closing block is the stored map (which is at the cursor) with
 *    the later ModifyLiquidity deltas taken back out.
 * 4. prices each hour as a cron run prices its chunk: `priceChain` on the bundle, with lens reserves and the
 *    position sum as the fallback, the previous hour's prices as the last stored ones, and Polygon's TEL price
 *    for the same hour from its hourly rows. Swaps in the hour are valued at the hour's closing prices.
 * 5. writes each row with HSETNX, so a row that exists by then is never replaced.
 *
 * A dry run stops after step 1: it reads Redis only and makes no RPC call. A call answers `next`, the oldest hour
 * it tried; passing it back as `before` continues below it, so hours that could not be priced are not retried.
 */

export const DEFAULT_HOUR_LIMIT = 48;
export const MAX_HOUR_LIMIT = HOUR_RETENTION / HOUR;
/** A call stops looking for closing blocks after this share of HOUR_BACKFILL_BUDGET_MS, leaving the rest for the logs, pricing and writes. */
export const HOUR_BACKFILL_BUDGET_MS = 120_000;
const SEARCH_SHARE = 0.5;
/** Archive bundles read at once. */
const SNAPSHOT_BATCH = 6;
/** Seconds of slack in the first step below a known block, so that it usually lands just before the hour's end. */
const STEP_MARGIN_SECONDS = 300;

export type HourBackfillRedis = Pick<RpcRedis, "hgetall" | "hmget" | "get" | "set" | "del"> & {
  hsetnx(key: string, field: string, value: string): Promise<unknown>;
};

export type HourBackfillDeps = {
  /** Created on first use, so a dry run needs no RPC client. */
  client: () => RpcRequester;
  redis: HourBackfillRedis;
  now: () => number;
  config: ChainConfig;
  pools: readonly RpcPool[];
  /** Polygon's pools, for the TEL price of the chains without a usable route. */
  polygonPools: readonly RpcPool[];
  budgetMs: number;
};

export type HourBackfillOptions = { dryRun?: boolean; limit?: number; before?: number };

export type HourBackfillBody = {
  chain: RpcChain;
  dryRun: boolean;
  /** The first and last hour considered, as ISO times. */
  from: string | null;
  to: string | null;
  hoursInWindow: number;
  /** Chain hours with at least one pool's row missing, and the rows missing over all pools. */
  hoursMissing: number;
  rowsMissing: number;
  /** The hours this call fills, or would fill in a dry run. */
  hoursToFill: number;
  hoursFilled: number;
  rowsWritten: number;
  /** Rows that existed by the time of the write, left as they were. */
  rowsKept: number;
  /** The oldest hour this call tried (unix seconds), to pass as `before` on the next call; null when none is left below it. */
  next: number | null;
  done: boolean;
  warnings: string[];
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** The hours the backfill considers at `now` (unix seconds): the retention window, up to the hour before the cursor's. */
export function backfillWindow(now: number, cursorTimestamp: number, before?: number): { first: number; last: number } {
  const last = hourStart(cursorTimestamp) - HOUR;
  return { first: hourStart(now) - HOUR_RETENTION + HOUR, last: before === undefined ? last : Math.min(last, hourStart(before) - HOUR) };
}

export type PoolHours = { id: string; createdAt: number | null; stored: ReadonlySet<number> };

export type MissingHours = {
  /** Chain hours with a row missing, newest first. */
  hours: number[];
  /** The pools missing a row, per hour. */
  pools: Map<number, string[]>;
  rows: number;
  hoursInWindow: number;
};

/** The hours from `first` to `last` where a pool created by the hour's end has no stored row. */
export function missingHours(pools: readonly PoolHours[], first: number, last: number): MissingHours {
  const byHour = new Map<number, string[]>();
  let rows = 0;
  let hoursInWindow = 0;
  for (let hour = last; hour >= first; hour -= HOUR) {
    hoursInWindow += 1;
    const ids = pools.filter(pool => (pool.createdAt === null || pool.createdAt < hour + HOUR) && !pool.stored.has(hour)).map(pool => pool.id);
    if (!ids.length) continue;
    byHour.set(hour, ids);
    rows += ids.length;
  }
  return { hours: [...byHour.keys()], pools: byHour, rows, hoursInWindow };
}

/**
 * The last block of the hour that starts at `hour`, below `upper` (a block at or after the hour's end). Steps down
 * from `upper` by the block time until a block is before the hour's end, doubling the step each time it is not,
 * then searches between the two.
 */
export async function closingBlock(timeOf: (block: number) => Promise<number>, hour: number, upper: BlockTime, blockTime: number): Promise<BlockTime> {
  const end = hour + HOUR;
  if (upper.timestamp < end) return upper;
  let hi = upper;
  let step = Math.max(1, Math.ceil((hi.timestamp - end + STEP_MARGIN_SECONDS) / blockTime));
  for (;;) {
    const block = Math.max(0, hi.block - step);
    const timestamp = await timeOf(block);
    if (timestamp < end) return lastBlockBefore(timeOf, end, { block, timestamp }, hi);
    if (block === 0) throw new Error(`no block before ${iso(end)}`);
    hi = { block, timestamp };
    step *= 2;
  }
}

/**
 * Each pool's liquidity map at each of `blocks`, from the maps at the cursor and the events (sorted) from below the
 * lowest block to the cursor: every ModifyLiquidity delta after a block is taken back out.
 */
export function liquidityAt(
  current: Readonly<Record<string, ReadonlyMap<string, bigint>>>,
  events: readonly PoolEvent[],
  blocks: readonly number[],
): { maps: Map<number, Record<string, Map<string, bigint>>>; warnings: string[] } {
  const maps = Object.fromEntries(Object.entries(current).map(([id, map]) => [id, new Map(map)]));
  const result = new Map<number, Record<string, Map<string, bigint>>>();
  const warnings: string[] = [];
  let i = events.length - 1;
  for (const block of [...blocks].sort((a, b) => b - a)) {
    for (; i >= 0 && events[i].block > block; i--) {
      const event = events[i];
      if (event.kind !== "liquidity") continue;
      const map = (maps[event.poolId] ??= new Map());
      const range = `${event.tickLower}:${event.tickUpper}`;
      const previous = (map.get(range) ?? 0n) - event.liquidityDelta;
      if (previous < 0n) warnings.push(`range ${range} of pool ${event.poolId} held negative liquidity before block ${event.block}`);
      if (previous === 0n) map.delete(range);
      else map.set(range, previous);
    }
    result.set(block, Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, new Map(map)])));
  }
  return { maps: result, warnings };
}

/** USD price per token from rows that carry their pools' closing prices. */
export function pricesFromRows(
  pools: readonly RpcPool[],
  rows: Readonly<Record<string, { price0USD?: number | null; price1USD?: number | null } | undefined>>,
): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const pool of pools) {
    const row = rows[pool.id];
    if (typeof row?.price0USD === "number" && row.price0USD > 0) prices[pool.key.currency0] = row.price0USD;
    if (typeof row?.price1USD === "number" && row.price1USD > 0) prices[pool.key.currency1] = row.price1USD;
  }
  return prices;
}

export type HourInput = {
  snapshot: ChainSnapshot;
  liquidity: Readonly<Record<string, ReadonlyMap<string, bigint>>>;
  /** The swaps of the hour, any pool. */
  swaps: readonly SwapEvent[];
  /** The previous hour's token prices. */
  last: Readonly<Record<string, number>>;
  polygonTel: number | null;
  /** The pools whose row is missing. */
  poolIds: readonly string[];
  createdAt: Readonly<Record<string, number | null>>;
};

/**
 * One hour's rows for the pools that miss one, as the cron would have closed the hour: the bundle priced with
 * `priceChain`, reserves from the lens or else the position sum, and the hour's swaps valued at the closing
 * prices. A pool without a price or a pool price at the closing block gets no row, with a warning.
 */
export function hourRows(
  config: ChainConfig,
  pools: readonly RpcPool[],
  input: HourInput,
): { rows: Record<string, StoredHour>; prices: Record<string, number>; warnings: string[] } {
  const { snapshot } = input;
  const reserves = Object.fromEntries(
    pools.map(pool => [pool.id, poolReserves(input.liquidity[pool.id] ?? new Map(), snapshot.pools[pool.id], true)]),
  );
  const priced = priceChain({ config, pools, snapshot, reserves, last: input.last, polygonTel: input.polygonTel, merklTel: null });
  const prices = Object.fromEntries(Object.entries(priced.tokens).map(([address, price]) => [address, price.usd]));
  const warnings = [...priced.warnings];
  const rows: Record<string, StoredHour> = {};

  for (const id of input.poolIds) {
    const pool = pools.find(candidate => candidate.id === id);
    if (!pool) continue;
    const createdAt = input.createdAt[id] ?? null;
    if (createdAt !== null && snapshot.timestamp < createdAt) continue;
    const slot0 = snapshot.pools[id]?.slot0;
    const usd = [prices[pool.key.currency0], prices[pool.key.currency1]] as const;
    if (!slot0) {
      warnings.push(`pool ${id} has no price at block ${snapshot.block}`);
      continue;
    }
    if (usd[0] === undefined || usd[1] === undefined) {
      warnings.push(`pool ${id} has a token without a USD price at block ${snapshot.block}`);
      continue;
    }
    const poolPrices = usd as readonly [number, number];
    const decimals = [config.tokens[pool.key.currency0].decimals, config.tokens[pool.key.currency1].decimals] as const;
    const totals = { swaps: 0, volumeUSD: 0, feesUSD: 0 };
    for (const swap of input.swaps) {
      if (swap.poolId !== id) continue;
      const swapUsd = swapPrices(swap.sqrtPriceX96, pool.anchor, poolPrices[pool.anchor], decimals);
      const value = valueSwap(swap, pool.anchor, decimals, swapUsd, slot0.protocolFee);
      totals.swaps += 1;
      totals.volumeUSD += value.volumeUSD;
      totals.feesUSD += value.feesUSD;
    }
    const held = reserves[id];
    rows[id] = {
      ...totals,
      tvlUSD: held ? reservesUsd(held, decimals, poolPrices) : null,
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
      price0USD: poolPrices[0],
      price1USD: poolPrices[1],
    };
  }
  return { rows, prices, warnings };
}

/** Polygon's TEL price per hour, the mean of its TEL pools' closing TEL prices in their hourly rows. */
async function polygonTelByHour(redis: HourBackfillRedis, pools: readonly RpcPool[], first: number, last: number): Promise<Map<number, number>> {
  const sums = new Map<number, number[]>();
  for (const pool of pools) {
    const side = pool.key.currency0 === TEL ? "price0USD" : pool.key.currency1 === TEL ? "price1USD" : null;
    if (!side) continue;
    for (const [hour, row] of await readHours(redis, "polygon", pool.id, first, last)) {
      const price = row[side];
      if (typeof price === "number" && price > 0) sums.set(hour, [...(sums.get(hour) ?? []), price]);
    }
  }
  return new Map([...sums].map(([hour, prices]) => [hour, prices.reduce((sum, price) => sum + price, 0) / prices.length]));
}

/** The PoolManager events from `points[0]` (exclusive) to the last point, read between known blocks in pieces of at most `maxSpan` blocks. */
async function eventsBetween(
  client: RpcRequester,
  config: ChainConfig,
  pools: readonly RpcPool[],
  points: readonly BlockTime[],
  maxSpan: number,
): Promise<PoolEvent[]> {
  const events: PoolEvent[] = [];
  const ids = pools.map(pool => pool.id);
  for (let p = 1; p < points.length; p++) {
    const [a, b] = [points[p - 1], points[p]];
    const timeAt = (block: number) => Math.round(a.timestamp + ((block - a.block) * (b.timestamp - a.timestamp)) / Math.max(1, b.block - a.block));
    for (let from = a.block + 1; from <= b.block; from += maxSpan) {
      const to = Math.min(b.block, from + maxSpan - 1);
      const range = { fromBlock: from, toBlock: to, fromTime: timeAt(from - 1), toTime: timeAt(to) };
      events.push(...(await fetchPoolEvents(client, config.contracts.poolManager, ids, range)).events);
    }
  }
  return events;
}

/** One call of the hourly backfill for `chain`. The caller holds the chain's lock unless this is a dry run. */
export async function runHourBackfill(chain: RpcChain, deps: HourBackfillDeps, options: HourBackfillOptions = {}): Promise<HourBackfillBody> {
  const started = deps.now();
  const { config, pools, redis } = deps;
  const dryRun = options.dryRun === true;
  const limit = Math.min(MAX_HOUR_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_HOUR_LIMIT)));
  const warnings: string[] = [];

  const cursor = await readCursor(redis, chain);
  if (!cursor) throw new Error(`Uniswap ${chain} RPC: no cursor; run the backfill first`);
  const state = await readState(redis, chain);
  const createdAt = Object.fromEntries(pools.map(pool => [pool.id, state.pools[pool.id]?.createdAt ?? null]));
  const { first, last } = backfillWindow(Math.floor(started / 1000), cursor.timestamp, options.before);

  const stored = new Map<string, Map<number, StoredHour>>();
  if (last >= first) for (const pool of pools) stored.set(pool.id, await readHours(redis, chain, pool.id, first, last));
  const missing = missingHours(
    pools.map(pool => ({ id: pool.id, createdAt: createdAt[pool.id], stored: new Set(stored.get(pool.id)?.keys() ?? []) })),
    first,
    last,
  );
  const selected = missing.hours.slice(0, limit);
  const body: HourBackfillBody = {
    chain,
    dryRun,
    from: last >= first ? iso(first) : null,
    to: last >= first ? iso(last) : null,
    hoursInWindow: missing.hoursInWindow,
    hoursMissing: missing.hours.length,
    rowsMissing: missing.rows,
    hoursToFill: selected.length,
    hoursFilled: 0,
    rowsWritten: 0,
    rowsKept: 0,
    next: null,
    done: missing.hours.length === 0,
    warnings,
  };
  if (dryRun || selected.length === 0) {
    body.next = missing.hours.length > selected.length ? selected[selected.length - 1] : null;
    return body;
  }

  // Closing blocks, newest first, each search starting from the block found before it.
  const client = deps.client();
  const timeOf = (block: number) => blockTimestampOf(client, block);
  const closings = new Map<number, BlockTime>();
  const tried: number[] = [];
  let upper: BlockTime = { block: cursor.block, timestamp: cursor.timestamp };
  for (const hour of selected) {
    if (tried.length && deps.now() - started > deps.budgetMs * SEARCH_SHARE) break;
    for (const boundary of [hour, hour - HOUR]) {
      if (closings.has(boundary)) continue;
      upper = await closingBlock(timeOf, boundary, upper, config.blockTime);
      closings.set(boundary, upper);
    }
    tried.push(hour);
  }
  body.hoursToFill = tried.length;

  const snapshots = new Map<number, ChainSnapshot>();
  for (let i = 0; i < tried.length; i += SNAPSHOT_BATCH) {
    const batch = tried.slice(i, i + SNAPSHOT_BATCH);
    const read = await Promise.all(batch.map(hour => readChainSnapshot(client, config, pools, closings.get(hour)!.block)));
    batch.forEach((hour, j) => snapshots.set(hour, read[j]));
  }

  const points = [...closings.values(), { block: cursor.block, timestamp: cursor.timestamp }].sort((a, b) => a.block - b.block);
  const events = await eventsBetween(client, config, pools, points, config.maxBlocksPerChunk);
  const data = await readPoolData(redis, chain, pools.map(pool => pool.id));
  const liquidity = liquidityAt(
    Object.fromEntries(pools.map(pool => [pool.id, data[pool.id].liquidity])),
    events,
    tried.map(hour => closings.get(hour)!.block),
  );
  warnings.push(...liquidity.warnings);

  const oldest = tried[tried.length - 1];
  const polygonTel = chain === "polygon" ? new Map<number, number>() : await polygonTelByHour(redis, deps.polygonPools, oldest, tried[0]);
  const swapsByHour = new Map<number, SwapEvent[]>();
  for (const event of events) {
    if (event.kind !== "swap") continue;
    const hour = hourStart(event.timestamp);
    const swaps = swapsByHour.get(hour);
    if (swaps) swaps.push(event);
    else swapsByHour.set(hour, [event]);
  }

  // Oldest first, so each hour's pricing sees the hour before it as its last stored prices.
  const computed = new Map<number, Record<string, number>>();
  for (const hour of [...tried].reverse()) {
    const previous = hour - HOUR;
    const storedBefore = Object.fromEntries(pools.map(pool => [pool.id, stored.get(pool.id)?.get(previous)]));
    let lastPrices = computed.get(previous) ?? pricesFromRows(pools, storedBefore);
    if (!Object.keys(lastPrices).length) {
      // The day row of the day before only seeds the feed and pool prices: TEL is left out, since pricing clamps a
      // move against it as against the previous run, and TEL can move further than that in a day.
      const days = Object.fromEntries(pools.map(pool => [pool.id, data[pool.id].days.get(dayStart(hour) - DAY)]));
      const { [TEL]: _tel, ...withoutTel } = pricesFromRows(pools, days);
      lastPrices = withoutTel;
    }
    const block = closings.get(hour)!.block;
    const result = hourRows(config, pools, {
      snapshot: snapshots.get(hour)!,
      liquidity: liquidity.maps.get(block)!,
      swaps: swapsByHour.get(hour) ?? [],
      last: lastPrices,
      polygonTel: polygonTel.get(hour) ?? null,
      poolIds: missing.pools.get(hour) ?? [],
      createdAt,
    });
    computed.set(hour, { ...lastPrices, ...result.prices });
    for (const warning of result.warnings) warnings.push(`${iso(hour)}: ${warning}`);

    const writes = Object.entries(result.rows).map(([id, row]) => redis.hsetnx(hourKey(chain, id), String(hour), JSON.stringify(row)));
    const replies = await Promise.all(writes);
    const written = replies.filter(reply => Number(reply) === 1).length;
    body.rowsWritten += written;
    body.rowsKept += replies.length - written;
    if (written) body.hoursFilled += 1;
  }

  const remaining = missing.hours.length - tried.length;
  body.next = remaining > 0 ? oldest : null;
  body.done = remaining === 0;
  body.warnings = [...new Set(warnings)];
  return body;
}

export type HourBackfillResult =
  | { status: 200; body: HourBackfillBody }
  | { status: 409; body: { error: string } }
  | { status: 500; body: { error: string } };

/**
 * One call for the admin route. A write run holds the chain's lock (shared with the cron job, so the two never run
 * at once and the cursor and liquidity maps stay put); a dry run only reads Redis and takes no lock. Errors are
 * logged redacted and answered with a fixed message.
 */
export async function runHourBackfillJob(
  chain: RpcChain,
  options: HourBackfillOptions,
  deps?: Partial<HourBackfillDeps>,
): Promise<HourBackfillResult> {
  const redis = deps?.redis ?? (getRedis() as unknown as HourBackfillRedis);
  const runId = randomUUID();
  const locked = !options.dryRun;
  if (locked && !(await acquireLock(redis, chain, runId))) return { status: 409, body: { error: "A run for this chain is in progress" } };
  try {
    const body = await runHourBackfill(
      chain,
      {
        client: deps?.client ?? (() => rpcClient(chain)),
        redis,
        now: deps?.now ?? Date.now,
        config: deps?.config ?? chainConfig(chain),
        pools: deps?.pools ?? rpcPoolsFor(chain),
        polygonPools: deps?.polygonPools ?? rpcPoolsFor("polygon"),
        budgetMs: deps?.budgetMs ?? HOUR_BACKFILL_BUDGET_MS,
      },
      options,
    );
    for (const warning of body.warnings) console.warn(`Uniswap ${chain} hourly backfill: ${warning}`);
    return { status: 200, body };
  } catch (err) {
    console.error(`Uniswap ${chain} hourly backfill: ${describeError(err)}`);
    return { status: 500, body: { error: "Hourly backfill failed" } };
  } finally {
    if (locked) await releaseLock(redis, chain, runId).catch(() => {});
  }
}

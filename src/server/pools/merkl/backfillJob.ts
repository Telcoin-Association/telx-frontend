import "server-only";

import { randomUUID } from "node:crypto";

import { describeError } from "@/app/api/backendHelpers/errors";
import type { RpcChain } from "@/lib/rpc";
import type { RpcRequester } from "@/server/chain/logs";

import { getRedis } from "../redis";
import { DAY, dayStart } from "../rpc/buckets";
import { blockTimestampOf, rpcClient } from "../rpc/client";
import { TEL } from "../rpc/chains";
import { readChainSnapshot } from "../rpc/snapshot";
import { chainConfig, rpcPoolsFor, type RpcPool } from "../registry";
import {
  backfillDays,
  lastBlockBefore,
  readSubscribedTokenIds,
  rewardsRowsForDay,
  sampleDay,
  SUBSCRIBER_FROM_BLOCK,
  writeChainRows,
  type BlockTime,
  type ChainRewardsRow,
  type RewardsWriteRedis,
} from "./backfill";
import { fetchPoolCampaigns, type Campaign } from "./campaigns";

export const rewardsBackfillKey = (chain: RpcChain) => `merkl-rewards:${chain}:backfill`;
export const rewardsBackfillLockKey = (chain: RpcChain) => `merkl-rewards:${chain}:backfill-lock`;

const LOCK_TTL_MS = 240_000;

/** A call stops starting new days after this long, well inside the route's 180-second limit. */
export const BACKFILL_BUDGET_MS = 120_000;

/**
 * Progress between calls: the subscription logs read so far and the positions they named, the next day to
 * sample, the last sampled block (a lower bound for the next day's search), and its prices (the next day's
 * fallback, as the cron carries its last prices).
 */
export type BackfillCursor = { logsTo: number; tokenIds: string[]; nextDay: number | null; lastBlock: BlockTime | null; lastPrices: Record<string, number> };

export type JobRedis = RewardsWriteRedis & {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string, options?: { nx: true; px: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

export type JobDeps = {
  client: RpcRequester;
  redis: JobRedis;
  fetchImpl: typeof fetch;
  now: () => number;
  pools: readonly RpcPool[];
  budgetMs: number;
};

export type PoolSummary = { poolId: string; days: number; from: string | null; svlUSD: number | null; svlAllUSD: number | null; apr: number | null };

export type BackfillBody = {
  done: boolean;
  /** The next day a call will sample, as YYYY-MM-DD. Once done it is today, which each later call refreshes. */
  nextDay: string | null;
  campaigns: number;
  positions: number;
  daysSampled: number;
  rowsWritten: number;
  /** Rows the cron had already recorded, left as they were. */
  rowsKept: number;
  pools: PoolSummary[];
  warnings: string[];
};

export type RewardsBackfillResult =
  | { status: 200; body: BackfillBody }
  | { status: 409; body: { error: string } }
  | { status: 500; body: { error: string } };

const iso = (day: number) => new Date(day * 1000).toISOString().slice(0, 10);

function parseCursor(value: unknown): BackfillCursor | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const cursor = parsed as Partial<BackfillCursor> | null;
  if (!cursor || typeof cursor.logsTo !== "number" || !Array.isArray(cursor.tokenIds)) return null;
  return {
    logsTo: cursor.logsTo,
    tokenIds: cursor.tokenIds.map(String),
    nextDay: typeof cursor.nextDay === "number" ? cursor.nextDay : null,
    lastBlock: cursor.lastBlock ?? null,
    lastPrices: cursor.lastPrices ?? {},
  };
}

/** One call of the rewards backfill: reads new subscriptions, then samples days until the budget runs out. */
export async function runRewardsBackfill(chain: RpcChain, deps: JobDeps, options: { reset?: boolean } = {}): Promise<BackfillBody> {
  const config = chainConfig(chain);
  const started = deps.now();
  const warnings: string[] = [];

  const campaigns: Campaign[] = await fetchPoolCampaigns(chain, deps.pools, deps.fetchImpl);
  const stored = options.reset ? null : parseCursor(await deps.redis.get(rewardsBackfillKey(chain)));
  const cursor: BackfillCursor = stored ?? { logsTo: SUBSCRIBER_FROM_BLOCK[chain] - 1, tokenIds: [], nextDay: null, lastBlock: null, lastPrices: {} };

  const head = await readChainSnapshot(deps.client, config, deps.pools, config.headTag);
  const today = dayStart(head.timestamp);
  const days = backfillDays(campaigns, today);
  const summaries = new Map<string, PoolSummary>(deps.pools.map(pool => [pool.id, { poolId: pool.id, days: 0, from: null, svlUSD: null, svlAllUSD: null, apr: null }]));
  const body: BackfillBody = { done: false, nextDay: null, campaigns: campaigns.length, positions: 0, daysSampled: 0, rowsWritten: 0, rowsKept: 0, pools: [], warnings };

  if (days.length === 0) {
    await deps.redis.del(rewardsBackfillKey(chain));
    return { ...body, done: true };
  }

  if (cursor.logsTo < head.block) {
    const ids = await readSubscribedTokenIds(deps.client, config, cursor.logsTo + 1, head.block, config.maxBlocksPerChunk);
    cursor.tokenIds = [...new Set([...cursor.tokenIds, ...ids])];
    cursor.logsTo = head.block;
  }
  body.positions = cursor.tokenIds.length;

  const merklTel = campaigns.find(campaign => campaign.token === TEL)?.priceUSD ?? null;
  const timeOf = (block: number) => blockTimestampOf(deps.client, block);
  const headTime: BlockTime = { block: head.block, timestamp: head.timestamp };
  let lower: BlockTime = cursor.lastBlock ?? { block: SUBSCRIBER_FROM_BLOCK[chain], timestamp: await timeOf(SUBSCRIBER_FROM_BLOCK[chain]) };

  let day = Math.max(cursor.nextDay ?? days[0], days[0]);
  while (day <= today) {
    if (deps.now() - started > deps.budgetMs) break;
    const end = day + DAY;
    // Today closes at the head block. A day that ended before the lower bound (only one before the subscriber
    // existed) had no subscribed liquidity to sample, so its rows carry the rewards alone.
    const sampled = day === today ? headTime : end <= lower.timestamp ? null : await lastBlockBefore(timeOf, end, lower, headTime);
    const sample = sampled
      ? await sampleDay(deps.client, config, deps.pools, cursor.tokenIds, day, sampled.block, cursor.lastPrices, merklTel)
      : { day, block: lower.block, prices: { ...cursor.lastPrices }, svlUSD: {}, svlAllUSD: {}, warnings: [] };
    for (const warning of sample.warnings) warnings.push(`${iso(day)}: ${warning}`);

    const rows = rewardsRowsForDay(campaigns, sample, deps.now());
    for (const [poolId, row] of rows) {
      const written = await writeChainRows(deps.redis, chain, poolId, new Map<number, ChainRewardsRow>([[day, row]]));
      body.rowsWritten += written;
      body.rowsKept += 1 - written;
      const summary = summaries.get(poolId);
      if (summary) {
        summary.days += 1;
        summary.from ??= iso(day);
        summary.svlUSD = row.subscribedTvlUSD;
        summary.svlAllUSD = sample.svlAllUSD[poolId] ?? null;
        summary.apr = row.apr;
      }
    }
    body.daysSampled += 1;
    if (sampled) lower = cursor.lastBlock = sampled;
    cursor.lastPrices = { ...cursor.lastPrices, ...sample.prices };
    // Today is sampled again by the next call, since its closing block is still ahead.
    cursor.nextDay = day === today ? today : day + DAY;
    day += DAY;
  }

  await deps.redis.set(rewardsBackfillKey(chain), JSON.stringify(cursor));
  body.done = day > today;
  body.nextDay = cursor.nextDay === null ? null : iso(cursor.nextDay);
  body.pools = [...summaries.values()].filter(summary => summary.days > 0);
  return body;
}

/** One call for the admin route, under the backfill's own lock. Errors are logged redacted and answered with a fixed message. */
export async function runRewardsBackfillJob(chain: RpcChain, options: { reset?: boolean }, deps?: Partial<JobDeps>): Promise<RewardsBackfillResult> {
  const redis = deps?.redis ?? (getRedis() as unknown as JobRedis);
  const runId = randomUUID();
  if ((await redis.set(rewardsBackfillLockKey(chain), runId, { nx: true, px: LOCK_TTL_MS })) !== "OK") {
    return { status: 409, body: { error: "A rewards backfill for this chain is in progress" } };
  }
  try {
    const body = await runRewardsBackfill(
      chain,
      {
        client: deps?.client ?? rpcClient(chain),
        redis,
        fetchImpl: deps?.fetchImpl ?? fetch,
        now: deps?.now ?? Date.now,
        pools: deps?.pools ?? rpcPoolsFor(chain),
        budgetMs: deps?.budgetMs ?? BACKFILL_BUDGET_MS,
      },
      options,
    );
    for (const warning of body.warnings) console.warn(`Rewards backfill ${chain}: ${warning}`);
    return { status: 200, body };
  } catch (err) {
    console.error(`Rewards backfill ${chain}: ${describeError(err)}`);
    return { status: 500, body: { error: "Rewards backfill failed" } };
  } finally {
    if ((await redis.get(rewardsBackfillLockKey(chain)).catch(() => null)) === runId) await redis.del(rewardsBackfillLockKey(chain)).catch(() => {});
  }
}

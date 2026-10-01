import "server-only";

import { z } from "zod";

import { timestampMsOrNull } from "@/lib/timestamps";

import { dayStart } from "../rpc/buckets";
import type { Chain } from "../registry";
import type { PoolRewardsEntry } from "./match";

/**
 * Merkl rewards history: one hash per pool, a field per UTC day (day start, unix seconds) holding that day's
 * rewards as the latest run saw them. Each run rewrites today's field, so a day closes on its last run, the same
 * convention as the pipeline's day rows, and running twice writes the same row. Kept for good: there is no TTL
 * and nothing trims it (one small row per pool per day). A pool with no matched campaign that day has no row.
 */
export const rewardsDayKey = (chain: Chain, poolId: string) => `merkl-rewards:${chain}:day:${poolId.toLowerCase()}`;

export type RewardsDayRow = {
  status: "LIVE" | "SOON" | "PAST";
  apr: number | null;
  dailyRewards: number | null;
  subscribedTvlUSD: number | null;
  /** Merkl's on-chain ids of the live campaigns that make up the APR. */
  campaignIds: string[];
  campaignStart: number | null;
  campaignEnd: number | null;
  /** Live, but Merkl had not measured the campaign yet. */
  pending: boolean;
  /** When the run that wrote the row read Merkl, unix ms. */
  at: number;
  /**
   * "chain" on a row the rewards backfill derived from campaign funding and on-chain subscriptions; absent on
   * Merkl's own figures as the cron recorded them.
   */
  source?: "chain";
};

const Nullable = z.number().nullable();

export const RewardsDayRowSchema = z.object({
  status: z.enum(["LIVE", "SOON", "PAST"]),
  apr: Nullable,
  dailyRewards: Nullable,
  subscribedTvlUSD: Nullable,
  campaignIds: z.array(z.string()),
  campaignStart: z.number().nullable().transform(timestampMsOrNull),
  campaignEnd: z.number().nullable().transform(timestampMsOrNull),
  pending: z.boolean(),
  at: z.number(),
  source: z.literal("chain").optional(),
}) satisfies z.ZodType<RewardsDayRow, unknown>;

export type RewardsHistoryRedis = { hset(key: string, values: Record<string, unknown>): Promise<unknown> };

/** The day row for one matched pool, from the run that read Merkl at `at` (unix ms). */
export function rewardsDayRow({ rewards }: PoolRewardsEntry, at: number): RewardsDayRow {
  return {
    status: rewards.status,
    apr: rewards.apr,
    dailyRewards: rewards.dailyRewards,
    subscribedTvlUSD: rewards.subscribedTvlUSD,
    campaignIds: rewards.aprBreakdown.map(({ campaignId }) => campaignId),
    campaignStart: rewards.campaignStart,
    campaignEnd: rewards.campaignEnd,
    pending: rewards.pending === true,
    at,
  };
}

/** Writes today's row (by the UTC day of `at`) for every matched pool on `chain`. */
export async function writeRewardsDays(redis: RewardsHistoryRedis, chain: Chain, entries: readonly PoolRewardsEntry[], at: number): Promise<void> {
  const day = String(dayStart(Math.floor(at / 1000)));
  await Promise.all(entries.map(entry => redis.hset(rewardsDayKey(chain, entry.id), { [day]: JSON.stringify(rewardsDayRow(entry, at)) })));
}

/**
 * A pool's rewards history from its raw hash, oldest first, as `[day start (unix seconds), row]`. Fields that
 * aren't a day or don't parse are skipped.
 */
export function parseRewardsDays(hash: Record<string, unknown> | null | undefined): [number, RewardsDayRow][] {
  const days: [number, RewardsDayRow][] = [];
  for (const [field, value] of Object.entries(hash ?? {})) {
    const day = Number(field);
    if (!Number.isInteger(day) || day <= 0) continue;
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const row = RewardsDayRowSchema.safeParse(parsed);
    if (row.success) days.push([day, row.data]);
  }
  return days.sort(([a], [b]) => a - b);
}

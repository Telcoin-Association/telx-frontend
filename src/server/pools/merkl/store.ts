import "server-only";

import { z } from "zod";

import type { PoolRewards } from "@/types/PoolRewards";

import type { CachedPool, GroupedResponse, Snapshot } from "../cache";
import type { CronWriteOptions, SourceFetch } from "../cronWrite";
import { poolIdsFor, protocolChainOf, type Chain, type Group } from "../registry";
import { fetchOpportunities } from "./fetch";
import { matchRewards, type PoolRewardsEntry, type StoredRewards } from "./match";

/**
 * Merkl rewards are stored per chain in their own data hash, in the shape the cron writer uses for pool
 * data (`fetchedAt` plus a JSON `data` array, here one `{ id, rewards }` per matched pool). A failed run
 * leaves the hash as it was and records the error on `status:<key>`.
 */
export const rewardsKey = (chain: Chain) => `merkl-rewards:${chain}:v1`;

/** Written every 10 minutes: an hour is 6 missed runs. Past it, every pool on the chain gets `rewards: null`. */
export const REWARDS_MAX_AGE_MS = 60 * 60 * 1000;

const Nullable = z.number().nullable();

export const StoredRewardsSchema = z.object({
  status: z.enum(["LIVE", "SOON", "PAST"]),
  apr: Nullable,
  aprBreakdown: z.array(z.object({ campaignId: z.string(), apr: z.number(), distributionType: z.string().nullable() })),
  dailyRewards: Nullable,
  subscribedTvlUSD: Nullable,
  campaignStart: Nullable,
  campaignEnd: Nullable,
}) satisfies z.ZodType<StoredRewards>;

export const PoolRewardsEntrySchema = z.object({ id: z.string(), rewards: StoredRewardsSchema }) satisfies z.ZodType<PoolRewardsEntry>;

/** An empty list is valid: a chain whose pools have no campaign yet. */
export const RewardsResponseSchema = z.array(PoolRewardsEntrySchema);

/** Fetches `chain`'s opportunities and matches them to the chain's registry Uniswap pools, active or archived. */
export async function fetchRewards(chain: Chain, fetchImpl?: typeof fetch): Promise<SourceFetch<PoolRewardsEntry>> {
  const poolIds = poolIdsFor("uniswap", chain);
  const groups = poolIds.length ? matchRewards(chain, poolIds, await fetchOpportunities(chain, fetchImpl)) : [];
  return { groups, indexedAt: null, hasIndexingErrors: false, warnings: [] };
}

const rewardsJob = (chain: Chain): CronWriteOptions => ({
  key: rewardsKey(chain),
  fetch: () => fetchRewards(chain),
  schema: RewardsResponseSchema,
  label: `Merkl ${chain} rewards`,
});

/** One cron job per chain, so a failed chain keeps its last rewards while the others update. */
export const MERKL_JOBS = {
  "merkl-rewards-base": rewardsJob("base"),
  "merkl-rewards-polygon": rewardsJob("polygon"),
  "merkl-rewards-ethereum": rewardsJob("ethereum"),
} satisfies Record<string, CronWriteOptions>;

/** The rewards key read alongside each Uniswap group. Other protocols carry no rewards. */
export function rewardsReadsFor(groups: readonly Group[]): { group: Group; key: string }[] {
  return groups.flatMap(group => {
    const { protocol, chain } = protocolChainOf(group);
    return protocol === "uniswap" ? [{ group, key: rewardsKey(chain) }] : [];
  });
}

/**
 * Rewards by lowercase pool id from a parsed rewards hash. Empty when the hash is missing, past
 * REWARDS_MAX_AGE_MS at `now`, or unreadable; entries that fail validation are skipped. A LIVE entry
 * whose campaign has ended by `now` reads as PAST, so a campaign that ends between runs never reads
 * as earning.
 */
export function rewardsById(snapshot: Snapshot | null, now: number): Map<string, PoolRewards> {
  const byId = new Map<string, PoolRewards>();
  if (!snapshot || now - snapshot.fetchedAt > REWARDS_MAX_AGE_MS) return byId;

  for (const item of snapshot.data as unknown[]) {
    const parsed = PoolRewardsEntrySchema.safeParse(item);
    if (!parsed.success) continue;
    let rewards: StoredRewards = parsed.data.rewards;
    if (rewards.status === "LIVE" && rewards.campaignEnd !== null && rewards.campaignEnd <= now) {
      rewards = { ...rewards, status: "PAST", apr: null, aprBreakdown: [], dailyRewards: null, subscribedTvlUSD: null };
    }
    byId.set(parsed.data.id.toLowerCase(), { ...rewards, fetchedAt: snapshot.fetchedAt });
  }
  return byId;
}

/**
 * Gives every pool of a loaded Uniswap group its `rewards`, null when none is known. Pass a null
 * snapshot for a rewards read that failed or found nothing; the pool data itself is never affected.
 */
export function attachRewards(response: GroupedResponse | undefined, snapshot: Snapshot | null, now: number): void {
  if (!response) return;
  const byId = rewardsById(snapshot, now);
  response.data = (response.data as CachedPool[]).map(pool => ({ ...pool, rewards: byId.get(pool.id.toLowerCase()) ?? null }));
}

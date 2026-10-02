import "server-only";

import type { PoolRewards, RewardsCampaignApr } from "@/types/PoolRewards";

import { CHAIN_IDS, OPPORTUNITY_TYPE, type Opportunity } from "./fetch";
import type { Chain } from "../registry";

/** Rewards as the cron stores them: `fetchedAt` is the snapshot's and is added on read. */
export type StoredRewards = Omit<PoolRewards, "fetchedAt">;

/** One stored entry per registry pool that matched an opportunity. */
export type PoolRewardsEntry = { id: string; rewards: StoredRewards };

/**
 * Merkl identifies a Uniswap v4 opportunity by the low 20 bytes of the 32-byte pool id, as a
 * (checksummed) address. Both sides are lowercased before comparing.
 */
export function opportunityIdentifierOf(poolId: string): string | null {
  const hex = poolId.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(hex) ? `0x${hex.slice(-40)}` : null;
}

const sumOrNull = (values: (number | null)[]): number | null =>
  values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value as number), 0);

/** TEL per day across an opportunity's live campaigns, or null without a rewards record. */
function dailyTelOf(opportunity: Opportunity): number | null {
  const breakdowns = opportunity.rewardsRecord?.breakdowns;
  if (!breakdowns) return null;
  let total = 0;
  for (const { token, amount } of breakdowns) {
    if (token.symbol.toUpperCase() !== "TEL" || !/^\d+$/.test(amount)) continue;
    const raw = BigInt(amount);
    const scale = 10n ** BigInt(token.decimals);
    total += Number(raw / scale) + Number(raw % scale) / Number(scale);
  }
  return total;
}

const known = (values: (number | null)[]): number[] => values.filter((value): value is number => value !== null);

/**
 * Live opportunities summed. APR and daily rewards add up across campaigns; subscribed TVL is the
 * largest reported, since every opportunity on a pool measures the same pool's liquidity. The window
 * runs from the earliest latest-campaign start to the latest end.
 *
 * Merkl reports 0 for the APR, daily rewards and TVL of a campaign it has not measured yet, and gives it
 * no `aprRecord`. The rates come from the measured opportunities only; when none is measured, they are
 * null and the rewards are marked `pending`, so a new campaign never reads as earning 0%.
 */
function liveRewards(live: Opportunity[]): StoredRewards {
  const measured = live.filter(opportunity => opportunity.aprRecord != null);
  const starts = known(live.map(opportunity => opportunity.latestCampaignStart));
  const ends = known(live.map(opportunity => opportunity.latestCampaignEnd));
  const window = { campaignStart: starts.length ? Math.min(...starts) : null, campaignEnd: ends.length ? Math.max(...ends) : null };
  if (measured.length === 0) {
    return { status: "LIVE", apr: null, aprBreakdown: [], dailyRewards: null, subscribedTvlUSD: null, ...window, pending: true };
  }

  const aprBreakdown: RewardsCampaignApr[] = measured.flatMap(opportunity =>
    (opportunity.aprRecord?.breakdowns ?? [])
      .filter(breakdown => breakdown.type === "CAMPAIGN")
      .map(breakdown => ({ campaignId: breakdown.identifier, apr: breakdown.value, distributionType: breakdown.distributionType ?? null })),
  );
  const tvls = known(measured.map(opportunity => opportunity.tvl));
  return {
    status: "LIVE",
    apr: sumOrNull(measured.map(opportunity => opportunity.apr)),
    aprBreakdown,
    dailyRewards: sumOrNull(measured.map(opportunity => opportunity.dailyRewards)),
    dailyRewardsTEL: sumOrNull(measured.map(dailyTelOf)),
    subscribedTvlUSD: tvls.length ? Math.max(...tvls) : null,
    ...window,
  };
}

/** A campaign that is not paying: its window only. The rates are null, never 0 or the last recorded value. */
function idleRewards(opportunity: Opportunity, status: "SOON" | "PAST"): StoredRewards {
  return {
    status,
    apr: null,
    aprBreakdown: [],
    dailyRewards: null,
    subscribedTvlUSD: null,
    campaignStart: opportunity.latestCampaignStart,
    campaignEnd: opportunity.latestCampaignEnd,
  };
}

const byStartAsc = (a: Opportunity, b: Opportunity) => (a.latestCampaignStart ?? Infinity) - (b.latestCampaignStart ?? Infinity);
const byEndDesc = (a: Opportunity, b: Opportunity) => (b.latestCampaignEnd ?? -Infinity) - (a.latestCampaignEnd ?? -Infinity);

/**
 * One pool's rewards from the opportunities matching it. LIVE ones win and are summed. Without a live
 * one, the next SOON campaign (earliest start) is reported, then the most recent PAST one (latest end).
 * Statuses other than these three (Merkl's NONE, or one added later) are ignored. Null when nothing
 * usable matches.
 */
export function rewardsFromOpportunities(matches: Opportunity[]): StoredRewards | null {
  const live = matches.filter(opportunity => opportunity.status === "LIVE");
  if (live.length) return liveRewards(live);

  const soon = matches.filter(opportunity => opportunity.status === "SOON").sort(byStartAsc)[0];
  if (soon) return idleRewards(soon, "SOON");

  const past = matches.filter(opportunity => opportunity.status === "PAST").sort(byEndDesc)[0];
  if (past) return idleRewards(past, "PAST");

  return null;
}

/**
 * Matches `chain`'s opportunities to its registry pool ids. Only opportunities of the subscription type
 * on that chain count, and a pool with no usable match gets no entry.
 */
export function matchRewards(chain: Chain, poolIds: readonly string[], opportunities: readonly Opportunity[]): PoolRewardsEntry[] {
  const byIdentifier = new Map<string, Opportunity[]>();
  for (const opportunity of opportunities) {
    if (opportunity.chainId !== CHAIN_IDS[chain] || opportunity.type !== OPPORTUNITY_TYPE) continue;
    const identifier = opportunity.identifier.trim().toLowerCase();
    byIdentifier.set(identifier, [...(byIdentifier.get(identifier) ?? []), opportunity]);
  }

  const entries: PoolRewardsEntry[] = [];
  for (const id of new Set(poolIds.map(poolId => poolId.trim().toLowerCase()))) {
    const identifier = opportunityIdentifierOf(id);
    const rewards = identifier ? rewardsFromOpportunities(byIdentifier.get(identifier) ?? []) : null;
    if (rewards) entries.push({ id, rewards });
  }
  return entries;
}

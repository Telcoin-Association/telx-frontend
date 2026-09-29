import formatShortDate from "./formatShortDate";
import formatNumberToCurrencyString from "./formatNumberToCurrencyString";
import type { RewardsStatus } from "@/types/PoolRewards";

// The Merkl fields the Uniswap reader puts on contract data. Other protocols have none of them.
export type MerklRewardsFields = {
  rewardsStatus?: RewardsStatus | null;
  rewardsApr?: number | null;
  rewardsDailyRewards?: number | null;
  rewardsCampaignStart?: number | null;
  rewardsCampaignEnd?: number | null;
};

export type MerklRewards = {
  status: RewardsStatus | null;
  apr: number | null;
  dailyRewards: number | null;
  campaignStart: number | null; // unix ms
  campaignEnd: number | null; // unix ms
};

const finiteOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A pool's Merkl rewards with every field null when unknown, whatever the protocol. */
export function getMerklRewards(contractData: unknown): MerklRewards {
  const fields = (contractData ?? {}) as MerklRewardsFields;
  const status = fields.rewardsStatus;
  return {
    status: status === "LIVE" || status === "SOON" || status === "PAST" ? status : null,
    apr: finiteOrNull(fields.rewardsApr),
    dailyRewards: finiteOrNull(fields.rewardsDailyRewards),
    campaignStart: finiteOrNull(fields.rewardsCampaignStart),
    campaignEnd: finiteOrNull(fields.rewardsCampaignEnd),
  };
}

const aprFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "64.8%" */
export function formatAprPercent(apr: number): string {
  return `${aprFormat.format(apr)}%`;
}

/** "64.8% APR" */
export function formatApr(apr: number): string {
  return `${formatAprPercent(apr)} APR`;
}

/** Short date for a unix millisecond timestamp, e.g. "Oct 2". */
export function formatCampaignDate(ms: number, now: Date = new Date()): string {
  return formatShortDate(ms / 1000, now);
}

/** "Sep 25 - Oct 2", or the one known end of the window; null when neither date is known. */
export function formatCampaignWindow(start: number | null, end: number | null, now: Date = new Date()): string | null {
  if (start != null && end != null) return `${formatCampaignDate(start, now)} - ${formatCampaignDate(end, now)}`;
  if (start != null) return `From ${formatCampaignDate(start, now)}`;
  if (end != null) return `Until ${formatCampaignDate(end, now)}`;
  return null;
}

/** "$164.48 per day" */
export function formatDailyRewards(dailyRewards: number): string {
  return `${formatNumberToCurrencyString(dailyRewards)} per day`;
}

/** Hover text for the APR: Merkl computes it over subscribed liquidity, not the pool's whole TVL. */
export const SUBSCRIBED_APR_HELP = "Subscribed APR: annualised TELx rewards per dollar of subscribed liquidity, from Merkl.";

/**
 * What a pool shows for Subscribed Value Locked (SVL), the liquidity in positions subscribed to TELx rewards.
 * - `value`: a live campaign with a known subscribed TVL, and its share of the pool's TVL when both are known
 * - `unavailable`: a live campaign whose subscribed TVL is unknown
 * - `not-started`: a scheduled campaign
 * - `none`: no campaign, an ended one, or a protocol without Merkl campaigns
 */
export type SubscribedValue =
  | { kind: "value"; usd: number; share: number | null }
  | { kind: "unavailable" }
  | { kind: "not-started" }
  | { kind: "none" };

export function getSubscribedValue(contractData: unknown): SubscribedValue {
  const fields = (contractData ?? {}) as MerklRewardsFields & { protocol?: string; subscribedTvlUSD?: unknown; totalLiquidity?: unknown };
  if (fields.protocol !== "uniswap") return { kind: "none" };
  const { status } = getMerklRewards(contractData);
  if (status === "SOON") return { kind: "not-started" };
  if (status !== "LIVE") return { kind: "none" };
  const usd = finiteOrNull(fields.subscribedTvlUSD);
  if (usd === null) return { kind: "unavailable" };
  return { kind: "value", usd, share: subscribedShare(usd, finiteOrNull(fields.totalLiquidity)) };
}

/**
 * Subscribed liquidity as a fraction of TVL, capped at 1: Merkl and our TVL are priced separately, so the
 * subscribed side can read slightly above TVL. Null when either side is unknown or TVL is not positive.
 */
export function subscribedShare(subscribed: number | null, tvl: number | null): number | null {
  if (subscribed === null || tvl === null || tvl <= 0) return null;
  return Math.min(Math.max(subscribed / tvl, 0), 1);
}

/** "34% of TVL", or "<1% of TVL" for a small but non-zero share. */
export function formatShareOfTvl(share: number): string {
  if (share > 0 && share < 0.01) return "<1% of TVL";
  return `${Math.round(share * 100)}% of TVL`;
}

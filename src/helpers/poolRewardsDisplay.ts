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

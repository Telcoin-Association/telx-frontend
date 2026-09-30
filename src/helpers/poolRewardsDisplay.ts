import formatShortDate from "./formatShortDate";
import formatNumberToCurrencyString from "./formatNumberToCurrencyString";
import { timestampMsOrNull } from "@/lib/timestamps";
import { isRewardsStatus, type RewardsStatus } from "@/types/PoolRewards";
import type { UniswapContractData } from "@/web3/getContracts/uniswapv4/getSingleContractData";

// The Merkl fields the Uniswap reader puts on contract data. Other protocols have none of them.
// `rewardsKnown` is false when the rewards could not be read, so a null status means "unknown", not
// "no campaign"; contract data without the field is treated as known.
// Taken from the reader's own declaration, so renaming a field there fails to compile here.
export type MerklRewardsFields = Partial<
  Pick<
    UniswapContractData,
    "rewardsKnown" | "rewardsStatus" | "rewardsApr" | "rewardsDailyRewards" | "rewardsCampaignStart" | "rewardsCampaignEnd" | "subscribedTvlUSD" | "totalLiquidity"
  >
>;

export type MerklRewards = {
  status: RewardsStatus | null;
  apr: number | null;
  dailyRewards: number | null;
  campaignStart: number | null; // unix ms
  campaignEnd: number | null; // unix ms
};

const finiteOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * A pool's Merkl rewards at `now` (unix ms), with every field null when unknown, whatever the protocol. A
 * campaign date outside the range a real date can take reads as unknown. A LIVE campaign whose end has passed
 * reads as PAST with no APR or daily rewards, the same rule the server applies when it serves the data, so a
 * campaign that ends while the tab is open stops reading as earning.
 */
export function getMerklRewards(contractData: unknown, now: number = Date.now()): MerklRewards {
  const fields = (contractData ?? {}) as MerklRewardsFields;
  const status = fields.rewardsStatus;
  const rewards: MerklRewards = {
    status: isRewardsStatus(status) ? status : null,
    apr: finiteOrNull(fields.rewardsApr),
    dailyRewards: finiteOrNull(fields.rewardsDailyRewards),
    campaignStart: timestampMsOrNull(fields.rewardsCampaignStart),
    campaignEnd: timestampMsOrNull(fields.rewardsCampaignEnd),
  };
  if (rewards.status === "LIVE" && rewards.campaignEnd !== null && rewards.campaignEnd <= now) {
    return { ...rewards, status: "PAST", apr: null, dailyRewards: null };
  }
  return rewards;
}

/** False when the pool's rewards could not be read, so its campaign state is unknown. */
export function rewardsKnown(contractData: unknown): boolean {
  return (contractData as MerklRewardsFields | null | undefined)?.rewardsKnown !== false;
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

/**
 * Short UTC date for a unix millisecond timestamp, e.g. "Oct 2". Campaigns start and end at 00:00 UTC, so the
 * UTC day is the one the campaign names in every time zone.
 */
export function formatCampaignDate(ms: number, now: Date = new Date()): string {
  return formatShortDate(ms / 1000, now);
}

/** "Sep 25 - Oct 2 (UTC)", or the one known end of the window; null when neither date is known. */
export function formatCampaignWindow(start: number | null, end: number | null, now: Date = new Date()): string | null {
  if (start != null && end != null) return `${formatCampaignDate(start, now)} - ${formatCampaignDate(end, now)} (UTC)`;
  if (start != null) return `From ${formatCampaignDate(start, now)} (UTC)`;
  if (end != null) return `Until ${formatCampaignDate(end, now)} (UTC)`;
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
 * This is the one SVL rule: the pool cells, the pool page row and the header total all read it.
 * - `value`: a live campaign with a known subscribed TVL, and its share of the pool's TVL when both are known
 * - `unavailable`: rewards that could not be read, or a live campaign whose subscribed TVL is unknown
 * - `not-started`: a scheduled campaign
 * - `none`: no campaign, an ended one, or a protocol without Merkl campaigns
 */
export type SubscribedValue =
  | { kind: "value"; usd: number; share: number | null }
  | { kind: "unavailable" }
  | { kind: "not-started" }
  | { kind: "none" };

export function getSubscribedValue(contractData: unknown, now: number = Date.now()): SubscribedValue {
  const fields = (contractData ?? {}) as MerklRewardsFields & { protocol?: string };
  if (fields.protocol !== "uniswap") return { kind: "none" };
  if (!rewardsKnown(contractData)) return { kind: "unavailable" };
  const { status } = getMerklRewards(contractData, now);
  if (status === "SOON") return { kind: "not-started" };
  if (status !== "LIVE") return { kind: "none" };
  const usd = finiteOrNull(fields.subscribedTvlUSD);
  if (usd === null) return { kind: "unavailable" };
  return { kind: "value", usd, share: subscribedShare(usd, finiteOrNull(fields.totalLiquidity)) };
}

/**
 * Subscribed liquidity as a fraction of TVL, uncapped. Merkl and our TVL are priced separately, so the
 * subscribed side can read above TVL; formatShareOfTvl says so rather than hiding it. Null when either side
 * is unknown or TVL is not positive.
 */
export function subscribedShare(subscribed: number | null, tvl: number | null): number | null {
  if (subscribed === null || tvl === null || tvl <= 0) return null;
  return Math.max(subscribed / tvl, 0);
}

/**
 * Pricing noise between Merkl's subscribed figure and our TVL: a share at most this far above 100% reads as
 * 100%, and one further above as "Over 100%".
 */
const SHARE_PRICING_TOLERANCE = 0.01;

/**
 * "34% of TVL". The ends never round to a misleading value: a small non-zero share reads "<1% of TVL", one
 * that is close to but under 100% reads ">99% of TVL", and one past 100% by more than pricing noise reads
 * "Over 100% of TVL".
 */
export function formatShareOfTvl(share: number): string {
  if (share > 0 && share < 0.01) return "<1% of TVL";
  if (share >= 0.995 && share < 1) return ">99% of TVL";
  if (share > 1 + SHARE_PRICING_TOLERANCE) return "Over 100% of TVL";
  return `${Math.min(Math.round(share * 100), 100)}% of TVL`;
}

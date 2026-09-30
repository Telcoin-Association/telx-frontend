// Merkl reward data for one Uniswap v4 pool. The Merkl cron (src/server/pools/merkl) stores it per
// chain and /api/pools serves it on each Uniswap pool as `rewards`.

/**
 * `LIVE`: a campaign is paying out now. `SOON`: a campaign is scheduled but has not started.
 * `PAST`: every campaign has ended. Only `LIVE` carries rates; the others have `apr`, `dailyRewards`
 * and `subscribedTvlUSD` set to null, so an ended or future campaign never reads as earning.
 */
export const REWARDS_STATUSES = ["LIVE", "SOON", "PAST"] as const;
export type RewardsStatus = (typeof REWARDS_STATUSES)[number];

export function isRewardsStatus(value: unknown): value is RewardsStatus {
  return (REWARDS_STATUSES as readonly unknown[]).includes(value);
}

/** One campaign's share of a pool's rewards APR. */
export type RewardsCampaignApr = {
  campaignId: string; // Merkl's on-chain campaign id
  apr: number; // percent
  distributionType: string | null;
};

export type PoolRewards = {
  status: RewardsStatus;
  apr: number | null; // percent (66.9 means 66.9%), summed over the live campaigns
  aprBreakdown: RewardsCampaignApr[];
  dailyRewards: number | null; // USD per day, summed over the live campaigns
  subscribedTvlUSD: number | null; // liquidity subscribed for rewards, not the pool's total TVL
  campaignStart: number | null; // unix ms
  campaignEnd: number | null; // unix ms
  fetchedAt: number; // unix ms, when the cron read Merkl
};

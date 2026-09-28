/**
 * TypeScript types for Merkl API responses and parsed reward data.
 */

export interface MerklToken {
  chainId: number;
  address: string;
  decimals: number;
  symbol: string;
  name?: string;
  icon?: string;
  price?: number;
}

export interface MerklRewardEntry {
  amount: string;
  claimed: string;
  pending: string;
  proofs: string[];
  token: MerklToken;
  root?: string;
  distributionChainId?: number;
  recipient?: string;
  breakdowns?: unknown[];
}

export interface MerklChainRewardsResponse {
  chain: {
    id: number;
    name: string;
  };
  amountUSD?: string;
  claimedUSD?: string;
  pendingUSD?: string;
  rewards: MerklRewardEntry[];
}

/** Parsed reward data ready for display and on-chain claiming */
export interface ParsedMerklReward {
  /** Cumulative amount credited in the Merkle tree */
  amount: string;
  /** Cumulative amount already claimed onchain */
  claimed: string;
  /** Earned but not yet in any Merkle root — NOT claimable */
  pending: string;
  /** Claimable = amount - claimed (never includes pending) */
  claimable: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenIcon?: string;
  tokenDecimals: number;
  tokenPrice?: number;
  /** USD values derived from Merkl token.price */
  amountUSD: number;
  claimedUSD: number;
  claimableUSD: number;
  pendingUSD: number;
  proofs: string[];
  /** True when proofs exist and claimable > 0 */
  isClaimable: boolean;
  raw: MerklRewardEntry;
}

export interface MerklRewardsSummary {
  rewards: ParsedMerklReward[];
  totalAmount: string;
  totalClaimed: string;
  totalClaimable: string;
  totalPending: string;
  /** USD totals from Merkl token.price (summed across TEL rewards) */
  totalAmountUSD: number;
  totalClaimedUSD: number;
  totalClaimableUSD: number;
  totalPendingUSD: number;
  /** Total Merkle proofs across claimable reward entries */
  totalProofsCount: number;
  claimableRewards: ParsedMerklReward[];
}

export interface FetchMerklRewardsResult {
  raw: MerklChainRewardsResponse[];
  summary: MerklRewardsSummary;
  isEmpty: boolean;
}

export interface FetchMerklRewardsOptions {
  /** Bypass API cache after a claim tx (up to ~5 min stale otherwise) */
  reloadChainId?: number;
}

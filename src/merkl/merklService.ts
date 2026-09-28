/**
 * Merkl API service — handles all communication with the Merkl rewards API.
 * Completely separate from the existing TELx claim system.
 */

import {
  MERKL_CHAIN_ID,
  TEL_TOKEN_ADDRESSES,
} from "./merklConstants";
import { merklAmountToUSD } from "./merklUtils";
import type {
  FetchMerklRewardsOptions,
  FetchMerklRewardsResult,
  MerklChainRewardsResponse,
  MerklRewardEntry,
  MerklRewardsSummary,
  ParsedMerklReward,
} from "./merklTypes";

/**
 * Parse a single Merkl reward entry into display/claim-ready fields.
 * Claimable = amount - claimed. Pending is tracked separately and never added to claimable.
 */
function parseRewardEntry(entry: MerklRewardEntry): ParsedMerklReward {
  const amount = BigInt(entry.amount || "0");
  const claimed = BigInt(entry.claimed || "0");
  const pending = BigInt(entry.pending || "0");
  const claimable = amount > claimed ? amount - claimed : 0n;
  const hasProofs = Array.isArray(entry.proofs) && entry.proofs.length > 0;
  const decimals = entry.token.decimals;
  const price = entry.token.price;

  const claimableStr = claimable.toString();

  return {
    amount: entry.amount || "0",
    claimed: entry.claimed || "0",
    pending: entry.pending || "0",
    claimable: claimableStr,
    tokenAddress: entry.token.address,
    tokenSymbol: entry.token.symbol,
    tokenName: entry.token.name || entry.token.symbol,
    tokenIcon: entry.token.icon,
    tokenDecimals: decimals,
    tokenPrice: price,
    amountUSD: merklAmountToUSD(entry.amount || "0", decimals, price),
    claimedUSD: merklAmountToUSD(entry.claimed || "0", decimals, price),
    claimableUSD: merklAmountToUSD(claimableStr, decimals, price),
    pendingUSD: merklAmountToUSD(entry.pending || "0", decimals, price),
    proofs: entry.proofs || [],
    isClaimable: hasProofs && claimable > 0n,
    raw: entry,
  };
}

/**
 * Extract rewards for a specific chain from the summary response array.
 */
function extractChainRewards(
  data: MerklChainRewardsResponse[],
  chainId: number
): MerklRewardEntry[] {
  const rewards: MerklRewardEntry[] = [];

  for (const chainRewards of data) {
    if (chainRewards.chain.id !== chainId) continue;
    for (const reward of chainRewards.rewards) {
      rewards.push(reward);
    }
  }

  return rewards;
}

/**
 * Filter rewards to TEL token for the queried chain.
 */
function filterTelRewards(
  rewards: ParsedMerklReward[],
  chainId: number
): ParsedMerklReward[] {
  const telAddress = TEL_TOKEN_ADDRESSES[chainId]?.toLowerCase();

  return rewards.filter((reward) => {
    const symbolMatch = reward.tokenSymbol.toUpperCase() === "TEL";
    const addressMatch =
      telAddress &&
      reward.tokenAddress.toLowerCase() === telAddress;
    return symbolMatch || addressMatch;
  });
}

/**
 * When the chain response only contains TEL rewards, use Merkl's official
 * amountUSD / claimedUSD / pendingUSD fields directly.
 */
function applyChainUsdFromApi(
  summary: MerklRewardsSummary,
  chainEntry: MerklChainRewardsResponse | undefined,
  telRewardCount: number
): MerklRewardsSummary {
  if (!chainEntry || telRewardCount === 0) return summary;

  const chainRewardCount = chainEntry.rewards?.length ?? 0;
  const onlyTelOnChain = chainRewardCount === telRewardCount;

  if (!onlyTelOnChain) return summary;

  const amountUSD = parseFloat(chainEntry.amountUSD || "0");
  const claimedUSD = parseFloat(chainEntry.claimedUSD || "0");
  const pendingUSD = parseFloat(chainEntry.pendingUSD || "0");

  return {
    ...summary,
    totalAmountUSD: amountUSD,
    totalClaimedUSD: claimedUSD,
    totalClaimableUSD: Math.max(0, amountUSD - claimedUSD),
    totalPendingUSD: pendingUSD,
  };
}

/**
 * Find the chain entry matching a chain ID from the API response.
 */
function findChainEntry(
  data: MerklChainRewardsResponse[],
  chainId: number
): MerklChainRewardsResponse | undefined {
  return data.find((entry) => entry.chain.id === chainId);
}

/**
 * Aggregate parsed rewards into summary totals.
 * Pending is summed separately and never included in claimable.
 */
function buildSummary(rewards: ParsedMerklReward[]): MerklRewardsSummary {
  let totalAmount = 0n;
  let totalClaimed = 0n;
  let totalClaimable = 0n;
  let totalPending = 0n;
  let totalAmountUSD = 0;
  let totalClaimedUSD = 0;
  let totalClaimableUSD = 0;
  let totalPendingUSD = 0;
  let totalProofsCount = 0;

  const claimableRewards = rewards.filter((r) => r.isClaimable);

  for (const reward of rewards) {
    totalAmount += BigInt(reward.amount);
    totalClaimed += BigInt(reward.claimed);
    totalClaimable += BigInt(reward.claimable);
    totalPending += BigInt(reward.pending);
    totalAmountUSD += reward.amountUSD;
    totalClaimedUSD += reward.claimedUSD;
    totalClaimableUSD += reward.claimableUSD;
    totalPendingUSD += reward.pendingUSD;
  }

  for (const reward of claimableRewards) {
    totalProofsCount += reward.proofs.length;
  }

  return {
    rewards,
    totalAmount: totalAmount.toString(),
    totalClaimed: totalClaimed.toString(),
    totalClaimable: totalClaimable.toString(),
    totalPending: totalPending.toString(),
    totalAmountUSD,
    totalClaimedUSD,
    totalClaimableUSD,
    totalPendingUSD,
    totalProofsCount,
    claimableRewards,
  };
}

/**
 * Fetch Merkl rewards for a user on a given chain via /rewards/summary.
 * Returns parsed TEL reward data; gracefully handles empty/error responses.
 */
export async function fetchMerklRewards(
  userAddress: string,
  chainId: number = MERKL_CHAIN_ID,
  options: FetchMerklRewardsOptions = {}
): Promise<FetchMerklRewardsResult> {
  const emptyResult: FetchMerklRewardsResult = {
    raw: [],
    summary: buildSummary([]),
    isEmpty: true,
  };

  if (!userAddress) {
    return emptyResult;
  }

  const params = new URLSearchParams({
    userAddress: userAddress.toLowerCase(),
    chainId: String(chainId),
  });

  // Only bypass cache after a successful claim — not on every fetch
  if (options.reloadChainId !== undefined) {
    params.set("reloadChainId", String(options.reloadChainId));
  }

  const url = `/api/merkl-user-rewards?${params}`;
  const response = await fetch(url);

  if (response.status === 404) {
    return emptyResult;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { error?: string }).error ||
      `Merkl API error: ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  const data = (await response.json()) as MerklChainRewardsResponse[];

  if (!Array.isArray(data) || data.length === 0) {
    return emptyResult;
  }

  const chainRewards = extractChainRewards(data, chainId);
  const parsed = chainRewards.map(parseRewardEntry);
  const telRewards = filterTelRewards(parsed, chainId);
  const chainEntry = findChainEntry(data, chainId);
  const summary = applyChainUsdFromApi(
    buildSummary(telRewards),
    chainEntry,
    telRewards.length
  );

  return {
    raw: data,
    summary,
    isEmpty: telRewards.length === 0,
  };
}

import "server-only";

import { formatUnits, type Address } from "viem";

import type { AdminMerklReward } from "@/lib/adminWallet";
import type { RpcChain } from "@/lib/rpc";
import { applyClaimedAmounts, readClaimedAmounts } from "@/merkl/merklClaimed";
import { MERKL_API_BASE_URL, MERKL_BASE_CHAIN_ID, MERKL_ETHEREUM_CHAIN_ID, MERKL_POLYGON_CHAIN_ID } from "@/merkl/merklConstants";
import type { MerklChainRewardsResponse } from "@/merkl/merklTypes";
import { positionsChain } from "../positions/chains";
import { getChainPositions } from "../positions/service";
import type { ReportClient, WalletReportDeps } from "./walletReport";

const MERKL_CHAIN_IDS: Record<RpcChain, number> = {
  polygon: MERKL_POLYGON_CHAIN_ID,
  base: MERKL_BASE_CHAIN_ID,
  ethereum: MERKL_ETHEREUM_CHAIN_ID,
};

const MERKL_TIMEOUT_MS = 10_000;

const units = (wei: bigint, decimals: number) => formatUnits(wei < 0n ? 0n : wei, decimals);

/**
 * The wallet's Merkl rewards on one chain, per token, from Merkl's rewards summary with each token's claimed
 * amount raised to the Distributor's onchain figure, since Merkl's index can trail a claim.
 */
export async function merklRewards(chain: RpcChain, owner: Address): Promise<AdminMerklReward[]> {
  const chainId = MERKL_CHAIN_IDS[chain];
  const url = new URL(`users/${owner.toLowerCase()}/rewards/summary`, `${MERKL_API_BASE_URL}/`);
  url.searchParams.set("chainId", String(chainId));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(MERKL_TIMEOUT_MS) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Merkl answered ${response.status}`);

  let entries = (await response.json()) as MerklChainRewardsResponse[];
  const entry = Array.isArray(entries) ? entries.find(candidate => candidate?.chain?.id === chainId) : undefined;
  if (!entry || !Array.isArray(entry.rewards)) return [];

  const { claimed } = await readClaimedAmounts(positionsChain(chain).client, owner.toLowerCase() as Address, entry.rewards.map(reward => reward.token.address));
  entries = applyClaimedAmounts(entries, { [chainId]: claimed });
  const corrected = entries.find(candidate => candidate?.chain?.id === chainId) ?? entry;

  return corrected.rewards.map(reward => {
    const { decimals, symbol, price } = reward.token;
    const amount = BigInt(reward.amount || "0");
    const claimedWei = BigInt(reward.claimed || "0");
    const claimable = amount - claimedWei;
    return {
      symbol,
      amount: units(amount, decimals),
      claimed: units(claimedWei, decimals),
      claimable: units(claimable, decimals),
      pending: units(BigInt(reward.pending || "0"), decimals),
      claimableUSD: typeof price === "number" && Number.isFinite(price) ? Number(units(claimable, decimals)) * price : null,
    };
  });
}

export const liveWalletReportDeps: WalletReportDeps = {
  client: chain => positionsChain(chain).client as unknown as ReportClient,
  heldPositions: (chain, owner) => getChainPositions(chain, owner),
  merklRewards,
};

"use client";

/**
 * Custom hook for Merkl reward fetching and claiming.
 * Parallel to the existing claim system — does not interact with it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletClient } from "wagmi";
import { base, polygon } from "viem/chains";
import { UserRejectedRequestError } from "viem";
import {
  publicClientBase,
  publicClientPolygon,
} from "@/app/api/backendHelpers/helpers";
import { fetchMerklRewards } from "./merklService";
import {
  MERKL_DISTRIBUTOR_ABI,
  MERKL_DISTRIBUTOR_ADDRESS,
  type MerklBlockchain,
} from "./merklConstants";
import type { FetchMerklRewardsResult } from "./merklTypes";
import { formatMerklTokenAmount } from "./merklUtils";

interface UseMerklClaimResult {
  merklRewards: FetchMerklRewardsResult | null;
  totalEarnedAmount: string;
  claimableAmount: string;
  claimedAmount: string;
  pendingAmount: string;
  totalEarnedUSD: number;
  claimableUSD: number;
  claimedUSD: number;
  pendingUSD: number;
  totalProofsCount: number;
  tokenInfo: {
    name: string;
    symbol: string;
    icon?: string;
    address: string;
    decimals: number;
  } | null;
  isFetching: boolean;
  isClaiming: boolean;
  error: string | null;
  claimSuccess: boolean;
  claimMerklRewards: () => Promise<void>;
  refetch: (options?: { reloadChainId?: number }) => Promise<void>;
}

const CHAIN_CONFIG = {
  base: {
    chain: base,
    publicClient: publicClientBase,
  },
  polygon: {
    chain: polygon,
    publicClient: publicClientPolygon,
  },
} as const;

/**
 * Hook to fetch and claim Merkl TEL rewards for a connected wallet on a given chain.
 */
export function useMerklClaim(
  userAddress: string | undefined,
  chainId: number,
  blockchain: MerklBlockchain
): UseMerklClaimResult {
  const { data: walletClient } = useWalletClient();
  const [merklRewards, setMerklRewards] =
    useState<FetchMerklRewardsResult | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  const { chain, publicClient } = CHAIN_CONFIG[blockchain];

  const refetch = useCallback(
    async (options?: { reloadChainId?: number }) => {
      if (!userAddress) {
        setMerklRewards(null);
        return;
      }

      setIsFetching(true);
      setError(null);
      if (!options?.reloadChainId) {
        setClaimSuccess(false);
      }

      try {
        const result = await fetchMerklRewards(userAddress, chainId, options);
        setMerklRewards(result);
      } catch (err) {
        console.error("Merkl rewards fetch error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch Merkl rewards"
        );
        setMerklRewards(null);
      } finally {
        setIsFetching(false);
      }
    },
    [userAddress, chainId]
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const tokenDecimals = useMemo(() => {
    const first = merklRewards?.summary.rewards[0];
    return first?.tokenDecimals ?? 2;
  }, [merklRewards]);

  const tokenInfo = useMemo(() => {
    const first = merklRewards?.summary.rewards[0];
    if (!first) return null;
    return {
      name: first.tokenName,
      symbol: first.tokenSymbol,
      icon: first.tokenIcon,
      address: first.tokenAddress,
      decimals: first.tokenDecimals,
    };
  }, [merklRewards]);

  const totalEarnedAmount = useMemo(() => {
    if (!merklRewards) return "0";
    return formatMerklTokenAmount(
      merklRewards.summary.totalAmount,
      tokenDecimals
    );
  }, [merklRewards, tokenDecimals]);

  const claimableAmount = useMemo(() => {
    if (!merklRewards) return "0";
    return formatMerklTokenAmount(
      merklRewards.summary.totalClaimable,
      tokenDecimals
    );
  }, [merklRewards, tokenDecimals]);

  const claimedAmount = useMemo(() => {
    if (!merklRewards) return "0";
    return formatMerklTokenAmount(
      merklRewards.summary.totalClaimed,
      tokenDecimals
    );
  }, [merklRewards, tokenDecimals]);

  const pendingAmount = useMemo(() => {
    if (!merklRewards) return "0";
    return formatMerklTokenAmount(
      merklRewards.summary.totalPending,
      tokenDecimals
    );
  }, [merklRewards, tokenDecimals]);

  const totalEarnedUSD = merklRewards?.summary.totalAmountUSD ?? 0;
  const claimableUSD = merklRewards?.summary.totalClaimableUSD ?? 0;
  const claimedUSD = merklRewards?.summary.totalClaimedUSD ?? 0;
  const pendingUSD = merklRewards?.summary.totalPendingUSD ?? 0;
  const totalProofsCount = merklRewards?.summary.totalProofsCount ?? 0;

  /**
   * Claim Merkl rewards via the Distributor contract.
   * Passes cumulative `amount` values — the contract deducts claimed internally.
   */
  const claimMerklRewards = useCallback(async () => {
    if (!userAddress || !walletClient) {
      setError("Please connect your wallet first.");
      return;
    }

    const claimable = merklRewards?.summary.claimableRewards ?? [];
    if (claimable.length === 0) {
      setError("No Merkl rewards available to claim.");
      return;
    }

    setIsClaiming(true);
    setError(null);
    setClaimSuccess(false);

    try {
      await walletClient.switchChain({ id: chain.id });

      const users = claimable.map(() => userAddress as `0x${string}`);
      const tokens = claimable.map(
        (r) => r.tokenAddress as `0x${string}`
      );
      const amounts = claimable.map((r) => BigInt(r.amount));
      const proofs = claimable.map(
        (r) => r.proofs as `0x${string}`[]
      );

      const hash = await walletClient.writeContract({
        address: MERKL_DISTRIBUTOR_ADDRESS,
        abi: MERKL_DISTRIBUTOR_ABI,
        functionName: "claim",
        args: [users, tokens, amounts, proofs],
        chain,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setClaimSuccess(true);
      await refetch({ reloadChainId: chainId });
    } catch (err) {
      console.error("Merkl claim error:", err);

      if (err instanceof UserRejectedRequestError) {
        setError("Transaction rejected by user.");
        return;
      }

      const message =
        (err as { shortMessage?: string })?.shortMessage ||
        (err instanceof Error ? err.message : "Claim transaction failed");
      setError(message);
    } finally {
      setIsClaiming(false);
    }
  }, [
    userAddress,
    walletClient,
    merklRewards,
    refetch,
    chain,
    publicClient,
    chainId,
  ]);

  return {
    merklRewards,
    totalEarnedAmount,
    claimableAmount,
    claimedAmount,
    pendingAmount,
    totalEarnedUSD,
    claimableUSD,
    claimedUSD,
    pendingUSD,
    totalProofsCount,
    tokenInfo,
    isFetching,
    isClaiming,
    error,
    claimSuccess,
    claimMerklRewards,
    refetch,
  };
}

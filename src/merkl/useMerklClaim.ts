"use client";

/**
 * Custom hook for Merkl reward fetching and claiming.
 * Parallel to the existing claim system — does not interact with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { base, polygon } from "viem/chains";
import { BaseError, UserRejectedRequestError } from "viem";
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
import {
  notifyMerklClaimError,
  notifyMerklClaimRejected,
  notifyMerklClaimSuccess,
} from "./merklToasts";

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
  isReconcilingAfterClaim: boolean;
  error: string | null;
  claimSuccess: boolean;
  claimMerklRewards: () => Promise<void>;
  refetch: (options?: { reloadChainId?: number }) => Promise<void>;
}

/**
 * Wallet rejections arrive wrapped in a ContractFunctionExecutionError, so the
 * cause chain has to be walked instead of checking the top-level error type.
 */
function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return true;
  }
  const code = (err as { code?: number | string })?.code;
  return code === 4001 || code === "ACTION_REJECTED";
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
  // Merkl's index updates `claimed` a few minutes after the tx is mined.
  // We disable the claim button while we poll for that reconciliation.
  const [isReconcilingAfterClaim, setIsReconcilingAfterClaim] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  const { chain, publicClient } = CHAIN_CONFIG[blockchain];
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
      notifyMerklClaimSuccess();
      // Immediately after tx mining, Merkl may still serve cached/old `claimed`.
      // Poll for reconciliation so the UI doesn't allow double-claiming.
      setIsReconcilingAfterClaim(true);

      try {
        const maxAttempts = 20; // up to ~5 minutes of reconciliation (Merkl indexing lag)
        const delayMs = 15000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (!isMountedRef.current) return;

          const result = await fetchMerklRewards(userAddress, chainId, {
            reloadChainId: chainId,
          });
          setMerklRewards(result);

          // Stop once Merkl reports no claimable rewards.
          if (BigInt(result.summary.totalClaimable || "0") === 0n) break;

          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      } finally {
        if (isMountedRef.current) setIsReconcilingAfterClaim(false);
      }
    } catch (err) {
      if (isUserRejection(err)) {
        notifyMerklClaimRejected();
        return;
      }

      console.error("Merkl claim error:", err);

      const message =
        (err as { shortMessage?: string })?.shortMessage ||
        (err instanceof Error ? err.message : "Claim transaction failed");
      notifyMerklClaimError(message);
    } finally {
      setIsClaiming(false);
    }
  }, [
    userAddress,
    walletClient,
    merklRewards,
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
    isReconcilingAfterClaim,
    error,
    claimSuccess,
    claimMerklRewards,
    refetch,
  };
}

"use client";

/**
 * Custom hook for Merkl reward fetching and claiming.
 * Parallel to the existing claim system — does not interact with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { base, mainnet, polygon } from "viem/chains";
import { BaseError, UserRejectedRequestError } from "viem";
import {
  publicClientBase,
  publicClientEthereum,
  publicClientPolygon,
} from "@/lib/publicClients";
import { fetchMerklRewards, withRewardsClaimed } from "./merklService";
import {
  MERKL_DISTRIBUTOR_ABI,
  MERKL_DISTRIBUTOR_ADDRESS,
  TEL_DECIMALS,
  TEL_TOKEN_ADDRESSES,
  TEL_TOKEN_INFO,
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
  ethereum: {
    chain: mainnet,
    publicClient: publicClientEthereum,
  },
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
 * Waits between the polls that confirm a mined claim, in ms. The first poll
 * goes out as soon as the receipt arrives, because the rewards route reads the
 * claimed amounts from the chain and normally confirms at once. Later polls
 * wait these in turn, and the last one repeats.
 */
export const CLAIM_CONFIRM_POLL_DELAYS_MS = [3_000, 3_000, 5_000, 10_000, 15_000] as const;

/** No confirming poll goes out later than this after the receipt. */
export const CLAIM_CONFIRM_TIMEOUT_MS = 5 * 60_000;

/**
 * Polls the rewards API after a mined claim until it returns at least
 * `targetClaimed` claimed in total, and returns that result. A result below the
 * target is stale, since Merkl's index can trail the chain by minutes, and is
 * dropped. A failed fetch is logged and polling goes on, because the claim
 * itself already succeeded. Returns null once the next poll would go out past
 * CLAIM_CONFIRM_TIMEOUT_MS, or when `isActive` turns false. Never throws.
 */
async function pollForClaimedRewards(
  userAddress: string,
  chainId: number,
  targetClaimed: bigint,
  isActive: () => boolean
): Promise<FetchMerklRewardsResult | null> {
  const startedAt = Date.now();

  for (let attempt = 0; isActive(); attempt++) {
    try {
      const result = await fetchMerklRewards(userAddress, chainId, {
        reloadChainId: chainId,
      });
      if (BigInt(result.summary.totalClaimed) >= targetClaimed) return result;
    } catch (err) {
      console.warn("Merkl rewards poll after claim failed:", err);
    }

    const delayMs =
      CLAIM_CONFIRM_POLL_DELAYS_MS[
        Math.min(attempt, CLAIM_CONFIRM_POLL_DELAYS_MS.length - 1)
      ];
    if (Date.now() - startedAt + delayMs > CLAIM_CONFIRM_TIMEOUT_MS) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

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
  // True from a mined claim until the rewards API reports it, polling gives
  // up, or the wallet or chain changes. The claim button stays off meanwhile,
  // and the card refreshes the portfolio total when it ends.
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

  // Bumped when the wallet or chain changes, so a claim started for the old
  // ones neither applies its result nor holds up the new wallet's claim button.
  const identityRef = useRef(0);
  useEffect(() => {
    identityRef.current += 1;
    setIsReconcilingAfterClaim(false);
  }, [userAddress, chainId]);

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
    return first?.tokenDecimals ?? TEL_DECIMALS;
  }, [merklRewards]);

  const tokenInfo = useMemo(() => {
    const first = merklRewards?.summary.rewards[0];
    if (first) {
      return {
        name: first.tokenName,
        symbol: first.tokenSymbol,
        icon: first.tokenIcon,
        address: first.tokenAddress,
        decimals: first.tokenDecimals,
      };
    }

    const fallback = TEL_TOKEN_INFO[chainId];
    const address = TEL_TOKEN_ADDRESSES[chainId];
    if (!fallback || !address) return null;

    return {
      name: fallback.name,
      symbol: fallback.symbol,
      icon: fallback.icon,
      address,
      decimals: fallback.decimals,
    };
  }, [merklRewards, chainId]);

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
   * The claim ends at the receipt; confirming it with the rewards API goes on
   * in the background.
   */
  const claimMerklRewards = useCallback(async () => {
    if (!userAddress || !walletClient) {
      setError("Please connect your wallet first.");
      return;
    }

    const claimable = merklRewards?.summary.claimableRewards ?? [];
    if (!merklRewards || claimable.length === 0) {
      setError("No Merkl rewards available to claim.");
      return;
    }

    setIsClaiming(true);
    setError(null);
    setClaimSuccess(false);

    // What this claim finds applies only while the card still shows the wallet
    // and chain it was sent from.
    const identity = identityRef.current;
    const isCurrent = () =>
      isMountedRef.current && identityRef.current === identity;

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

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // A mined transaction can still revert, and then nothing was claimed.
      if (receipt.status !== "success") {
        throw new Error("Claim transaction reverted");
      }

      notifyMerklClaimSuccess();
      // The card now shows another wallet or chain, which this claim says nothing about.
      if (!isCurrent()) return;

      // The receipt proves these cumulative amounts are claimed, so the card
      // shows them now instead of waiting for Merkl's index to catch up.
      const claimedResult = withRewardsClaimed(merklRewards, chainId, claimable);
      setMerklRewards(claimedResult);
      setClaimSuccess(true);

      // Polling only confirms: a polled result replaces the state once it
      // reports at least what the receipt proves, so a stale one cannot bring
      // the claimed rewards back. It is not awaited, so the claim ends here and
      // nothing that goes wrong while polling can reach the catch below. It
      // stops, and applies nothing, once the wallet or chain changes.
      setIsReconcilingAfterClaim(true);
      void pollForClaimedRewards(
        userAddress,
        chainId,
        BigInt(claimedResult.summary.totalClaimed),
        isCurrent
      )
        .then((confirmed) => {
          if (confirmed && isCurrent()) setMerklRewards(confirmed);
        })
        .finally(() => {
          if (isCurrent()) setIsReconcilingAfterClaim(false);
        });
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

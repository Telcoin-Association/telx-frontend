"use client";

/**
 * Standalone Merkl rewards claim card — separate from existing TELx claim UI.
 * One card per chain (Base / Polygon), matching the Uniswap rewards layout.
 */

import React, { useState } from "react";
import Button from "@/components/common/Button";
import ChainLogo from "@/components/common/ChainLogo";
import ReturnAsset from "@/components/common/ReturnAsset";
import LoadingAnimation from "@/components/common/LoadingAnimationCircle";
import { numberToDecimalFixed } from "@/helpers/returnNumber";
import { useMerklClaim } from "./useMerklClaim";
import {
  MERKL_CHAIN_CONFIG,
  type MerklBlockchain,
} from "./merklConstants";
import { formatMerklUSD, truncateAddress } from "./merklUtils";

interface MerklClaimCardProps {
  userAddress: string | undefined;
  blockchain: MerklBlockchain;
}

interface RewardRowProps {
  label: string;
  telAmount: number;
  usdAmount: number;
  highlight?: boolean;
}

const RewardRow = ({ label, telAmount, usdAmount, highlight }: RewardRowProps) => (
  <div className="flex flex-col gap-1">
    <p className="text-xs text-white/50 uppercase tracking-wide">{label}</p>
    <div className="flex items-end justify-between gap-2">
      <div className="flex items-center gap-1">
        <ReturnAsset ticker="TEL" size={20} />
        <p className={`text-sm ${highlight ? "text-white font-semibold" : "text-white"}`}>
          {numberToDecimalFixed(telAmount, 2)} TEL
        </p>
      </div>
      <p className="text-xs text-primary">{formatMerklUSD(usdAmount)}</p>
    </div>
  </div>
);

const MerklClaimCard = ({ userAddress, blockchain }: MerklClaimCardProps) => {
  const { chainId, label } = MERKL_CHAIN_CONFIG[blockchain];
  const [tokenIconFailed, setTokenIconFailed] = useState(false);
  const {
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
    merklRewards,
  } = useMerklClaim(userAddress, chainId, blockchain);

  const totalEarnedNumber = parseFloat(totalEarnedAmount) || 0;
  const claimableNumber = parseFloat(claimableAmount) || 0;
  const claimedNumber = parseFloat(claimedAmount) || 0;
  const pendingNumber = parseFloat(pendingAmount) || 0;
  const hasClaimable = (merklRewards?.summary.claimableRewards.length ?? 0) > 0;
  const hasPending = pendingNumber > 0;
  const isWalletConnected = Boolean(userAddress);
  const hasAnyRewards =
    totalEarnedNumber > 0 || claimableNumber > 0 || claimedNumber > 0 || pendingNumber > 0;

  // Claimable balance exists but Merkl hasn't generated proofs yet
  const awaitingProofs =
    claimableNumber > 0 && totalProofsCount === 0;

  return (
    <div className="flex w-full flex-col gap-2 justify-center rounded-xl bg-black/20 p-4 md:p-4 border border-white/10">
      <section className="flex flex-col gap-4">
        <div className="flex gap-2 items-center justify-between">
          <div className="flex gap-2 items-center">
            <ChainLogo chain={blockchain} size={25} />
            <div>
              <p className="text-sm text-white font-semibold">Merkl Rewards</p>
              <p className="text-xs text-white/50">{label} (testing)</p>
            </div>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-tblue/20 text-tblue border border-tblue/30">
            Beta
          </span>
        </div>

        {!isWalletConnected ? (
          <p className="text-sm text-white/60">
            Connect your wallet to view Merkl rewards.
          </p>
        ) : isFetching ? (
          <LoadingAnimation
            theme="extra-light"
            message="Loading Merkl rewards"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {tokenInfo && hasAnyRewards && (
              <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                {tokenInfo.icon && !tokenIconFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tokenInfo.icon}
                    alt={tokenInfo.symbol}
                    width={24}
                    height={24}
                    className="rounded-full object-contain shrink-0"
                    onError={() => setTokenIconFailed(true)}
                  />
                ) : (
                  <ReturnAsset ticker="TEL" size={24} />
                )}
                <div className="flex flex-col min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {tokenInfo.name}
                  </p>
                  <p className="text-xs text-white/50">
                    {tokenInfo.symbol} · {truncateAddress(tokenInfo.address)} ·{" "}
                    {tokenInfo.decimals} decimals
                  </p>
                </div>
              </div>
            )}

            {hasAnyRewards && (
              <>
                <RewardRow
                  label="Claimable"
                  telAmount={claimableNumber}
                  usdAmount={claimableUSD}
                  highlight
                />

                <RewardRow
                  label="Total earned (in Merkle tree)"
                  telAmount={totalEarnedNumber}
                  usdAmount={totalEarnedUSD}
                />
                <p className="text-xs text-white/40 -mt-1">
                  Includes amounts already claimed. Merkl cumulative total.
                </p>

                {hasPending && (
                  <div className="flex flex-col gap-1 rounded-lg bg-white/5 px-3 py-2">
                    <p className="text-xs text-white/50 uppercase tracking-wide">
                      Pending (not yet claimable)
                    </p>
                    <div className="flex items-end justify-between gap-2">
                      <p className="text-sm text-white/80">
                        {numberToDecimalFixed(pendingNumber, 2)} TEL
                      </p>
                      <p className="text-xs text-primary">
                        {formatMerklUSD(pendingUSD)}
                      </p>
                    </div>
                    <p className="text-xs text-white/50">
                      Becomes claimable after the next Merkle root update (~2
                      hours). Not included in claimable amount.
                    </p>
                  </div>
                )}

                <RewardRow
                  label="Already claimed"
                  telAmount={claimedNumber}
                  usdAmount={claimedUSD}
                />

                {hasClaimable && (
                  <p className="text-xs text-green-400/80">
                    Proofs available: {totalProofsCount}
                  </p>
                )}

                {awaitingProofs && (
                  <p className="text-sm text-amber-400" role="status">
                    No proofs available yet — cannot claim until Merkl
                    generates Merkle proofs.
                  </p>
                )}
              </>
            )}

            {!hasAnyRewards && (
              <p className="text-sm text-white/60">
                No Merkl TEL rewards found on {blockchain} for this wallet.
              </p>
            )}

            {hasAnyRewards && !hasClaimable && claimableNumber === 0 && (
              <p className="text-sm text-white/60">
                {hasPending
                  ? "No claimable rewards right now. Pending rewards will become available after the next Merkle root update."
                  : "All Merkl TEL rewards have been claimed."}
              </p>
            )}

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            {claimSuccess && (
              <p className="text-sm text-green-400" role="status">
                Merkl rewards claimed successfully!
              </p>
            )}

            <Button
              className="w-full rounded-lg"
              external={false}
              disabled={
                !isWalletConnected ||
                isFetching ||
                isClaiming ||
                isReconcilingAfterClaim ||
                !hasClaimable
              }
              onClick={claimMerklRewards}
              type="primary"
              linkText={
                isClaiming ? (
                  <div className="flex items-center">
                    <LoadingAnimation size={24} className="mt-2" />
                    <span className="ml-2 whitespace-nowrap">
                      Claiming {numberToDecimalFixed(claimableNumber, 2)} TEL
                    </span>
                  </div>
                ) : (
                  `Claim ${numberToDecimalFixed(claimableNumber, 2)} TEL`
                )
              }
            />
          </div>
        )}
      </section>
    </div>
  );
};

export default MerklClaimCard;

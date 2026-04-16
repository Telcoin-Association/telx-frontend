"use client";

import React, { useEffect } from "react";
import BigNumber from "bignumber.js";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import ReturnAsset from "../common/ReturnAsset";
import { useSkrimContext } from "@/components/providers/SkrimProvider";
import PoolWeightChip from "@/components/pool/PoolWeightChip";
import { formatProtocol } from "@/helpers/formatProtocol";
import { useRouter } from "next/navigation";

interface ContractItemProps {
  contract: ProtocolsContractData;
  stakedLPTOverride?: number | string;
  stakedUSDOverride?: number;
}

export default function WalletItemContractItem({
  contract,
  stakedLPTOverride,
  stakedUSDOverride,
}: ContractItemProps) {
  const contractURL = `/pool/${contract.poolContractAddress}`;
  const router = useRouter();
  const { clear } = useSkrimContext();

  useEffect(() => {
    router.prefetch(contractURL);
  }, [contractURL, router]);

  const handleContractClick = () => {
    router.push(contractURL);
    clear();
  };

  const { assets } = contract;
  const userStakedUSD = formatNumberToCurrencyString(
    stakedUSDOverride ?? contract.user.stakedUSD ?? 0
  );
  const shouldShowStakedUSD: boolean =
    contract.user.stakedUSD !== undefined && contract.user.stakedUSD !== 0.0;

  return (
    <div
      key={contract.poolContractAddress}
      className="group flex cursor-pointer items-center justify-between gap-1 rounded-xl bg-white-100 p-2 hover-bg-ocean-gradient"
      onClick={handleContractClick}
    >
      <div className="grid gap-1">
        {assets.map(
          (
            asset: {
              ticker: string;
              weight: number;
            },
            i: number
          ) => {
            return (
              <div key={i} className="gap flex items-center ">
                <ReturnAsset ticker={asset?.ticker} size={20} />
                <PoolWeightChip
                  asset={asset}
                  className="hidden md:block"
                />
              </div>
            );
          }
        )}
      </div>
      <div className="grid gap-1 text-right">
        <p className="text-xs text-primary group-hover:text-white-100">
          {formatProtocol(contract.protocol)}
        </p>
        <div className="min-w-45 overflow-hidden wrap-break-word text-xs leading-3 text-primary group-hover:text-white-100">
          {new BigNumber(stakedLPTOverride ?? contract.user.stakedLPT ?? 0)
            .toFixed()
            .toLocaleString()}{" "}
          LPT
        </div>
        {shouldShowStakedUSD && (
          <div className="text-xs text-primary group-hover:text-white-100">
            {userStakedUSD + "*"}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { SingleContract } from "../../web3/getContracts/shared";
import LoadingWrapper from "../common/LoadingWrapper";
import PoolSnapshot from "../pool/PoolSnapshot";
import { DefaultRewardsInfo as DefaultRewardsInfoProps } from "@/types/DefaultRewardsInfo";

interface ArchiveCardsProps {
  contractsData: SingleContract[];
  endListText?: boolean;
  displayLabels?: boolean;
  defaultRewards?: DefaultRewardsInfoProps;
}

const SearchPoolsCards = (props: ArchiveCardsProps) => {
  const { contractsData, defaultRewards } = props;
  return (
    <div>
      {contractsData?.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="">
            <div className="mx-auto w-full max-w-7xl min-w-5xl rounded-2xl border border-white/10 shadow-2xl">
              {contractsData?.map((contractData: any, i: number) => {
                return <PoolSnapshot key={i} contractData={contractData} isLast={i === contractsData.length - 1} />;
              })}
            </div>
          </div>
        </div>
      ) : (
        <LoadingWrapper />
      )}
    </div>
  );
};

export default SearchPoolsCards;

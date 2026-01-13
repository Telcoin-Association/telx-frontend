// components
import React from "react";
import ContractSectionDeprecated from "./ContractSectionDeprecated";
import ContractSectionStake from "./ContractSectionStake";
import { ZERO_TOKEN_BALANCE } from "@/lib/constants";

//types
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export default function ContractActions({
  selectedPool,
  notices,
  currentPoolAddress,
}: {
  selectedPool: ProtocolsContractData;
  notices?: any;
  currentPoolAddress: string;
}) {
  const { protocol, user } = selectedPool;
  const { deprecated } = user || {};
  let stakedLPTDeprecated: string | number = 0;
  if (deprecated) {
    stakedLPTDeprecated = deprecated.stakedLPT;
  }

  const contractData = selectedPool;
  return (
    <div className=" mb-4 p-4 md:mx-auto rounded-2xl bg-black/20 shadow-xl shadow-[#10124333]/20 w-full">
      {Number(stakedLPTDeprecated) > 0 &&
        stakedLPTDeprecated !== ZERO_TOKEN_BALANCE ? (
        <div className="rounded-2xl bg-ston e-gradient px-4 py-8 w-full">
          <div className="mx-auto">
            <ContractSectionDeprecated
              protocol={protocol}
              contractData={contractData}
              notices={notices}
            />
          </div>
        </div>
      ) : (
        // --- Pass new props down ---
        <ContractSectionStake
          selectedPool={selectedPool}
          notices={notices}
          currentPoolAddress={currentPoolAddress}
        />
      )}
    </div>
  );
}
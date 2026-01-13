import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import ReturnStatus from "./ReturnStatus";
import ContractUpdateRequiresAction from "../contract/ContractUpdateRequiresAction";

export default function LabelStatusRow({ contractData, defaultRewards,
  type = "default",
  rewardsInterval, }: {
    contractData: ProtocolsContractData; defaultRewards: any;
    type?: "default" | "generalized";
    rewardsInterval?: string;
  }) {
  const { deprecated } = contractData;
  const stakingPeriod = type === "generalized" ? rewardsInterval : contractData?.stakingPeriod;
  const defaultPeriod = defaultRewards?.staking_period;

  return (
    <div className="flex flex-row sm:flex-col lg:flex-row justify-between items-start lg:items-end gap-4 py-3 px-4 text-primary bg-black/20 rounded-2xl">
      <div>
        <h4 className="text-xs text-primary">Status</h4>
        <ReturnStatus status={deprecated ? "deprecated" : "active"} />
      </div>
      <div>
        <ContractUpdateRequiresAction contractData={contractData} />
        <p className="text-xs text-primary text-end">
          {stakingPeriod ? stakingPeriod : defaultPeriod}
        </p>
      </div>
    </div>
  );
}

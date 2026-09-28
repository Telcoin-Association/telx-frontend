
import React from "react";
import LabelStatusRow from "../common/LabelStatusRow";
import LabelProtocolRow from "../common/LabelProtocolRow";
import LabelStakeAddressRow from "../common/LabelStakeAddressRow";
import LabelTotalLiquidityRow from "../common/LabelTotalLiquidityRow";
import LabelStakedLiquidityRow from "../common/LabelStakedLiquidityRow";
import LabelVolumeRow from "../common/LabelVolumeRow";
import LabelFeesRow from "../common/LabelFeesRow";
import LabelPoolAnalyticsRow from "../common/LabelPoolAnalyticsRow";
import LabelStakePeriod from "../common/LabelStakePeriod";
import LabelRewardsRow from "../common/LabelRewardsRow";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelViewPoolRow from "../common/LabelViewPoolRow";
import LabelPoolAddressRow from "../common/LabelPoolAddressRow";
import LabelTokenAddressesRow from "../common/LabelTokenAddressesRow";

export default function ContractInfo({ selectedPool, defaultRewards }: { selectedPool: ProtocolsContractData; defaultRewards?: any }) {
  const contractData = selectedPool;

  return (
    <div className="mx-auto max-w-xl flex flex-col gap-2">
      <LabelStatusRow contractData={contractData} defaultRewards={defaultRewards} />
      <LabelRewardsRow contractData={contractData} defaultRewards={defaultRewards} />
      <LabelTotalLiquidityRow contractData={contractData} />
      <LabelStakedLiquidityRow contractData={contractData} />
      <LabelVolumeRow contractData={contractData} />
      <LabelFeesRow contractData={contractData} />
      <LabelStakePeriod contractData={contractData} defaultRewards={defaultRewards} />
      <LabelProtocolRow contractData={contractData} />
      {contractData.protocol !== "uniswap" &&
        <LabelStakeAddressRow contractData={contractData} />
      }
      {contractData.protocol === "uniswap" &&
        <LabelViewPoolRow contractData={contractData} />
      }
      <LabelPoolAnalyticsRow contractData={contractData} />
      <LabelTokenAddressesRow contractData={contractData} />
      <LabelPoolAddressRow contractData={contractData} />
    </div>
  );
}

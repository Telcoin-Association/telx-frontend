import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelValueRow from "@/components/common/LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import { numberToDecimal } from "@/helpers/returnNumber";
import BigNumber from "bignumber.js";

export default function YourDeposits({ contractData }: { contractData: ProtocolsContractData; }) {
  if (!contractData?.user || !contractData.user.stakedUSD || contractData.user.stakedUSD <= 0) {
    return null;
  }
  const { user } = contractData;

  return user?.stakedUSD && user?.stakedUSD > 0 ? (
    <LabelValueRow
      label="Your LPT Deposits"
      smallValue
      value={
        <div className="flex justify-between items-center">
          <p className="text-[14px] md:text-base">{user?.stakedLPT !== undefined ? numberToDecimal(new BigNumber(user?.stakedLPT).toNumber(), 10) || 0 : null}</p>
          <p className="text-end text-xs font-normal text-primary">${stringNumbertoUSD(user?.stakedUSD)}</p>
        </div>
      }
    />
  ) : null;
}

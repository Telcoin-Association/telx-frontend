import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export default function LabelTotalLiquidityRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { totalLiquidity } = contractData;
  const helpText = "The amount of liquidity in the pool.";

  return totalLiquidity && totalLiquidity > 0 ?
    (
      <LabelValueRow label="TVL" helpText={helpText} value={<p>${totalLiquidity ? stringNumbertoUSD(totalLiquidity) : 0}</p>} />
    ) : (
      null
    );
}

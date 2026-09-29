import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";

export default function LabelTotalLiquidityRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { totalLiquidity } = contractData;
  const helpText = "The amount of liquidity in the pool.";

  return <LabelValueRow label="TVL" helpText={helpText} value={<p>{formatPoolAmount(totalLiquidity)}</p>} />;
}

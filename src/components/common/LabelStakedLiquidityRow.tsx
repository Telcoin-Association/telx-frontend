import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export const contractsWithoutStaking = ["TEL/BAL", "TEL/BAL/USDC"];

export default function LabelStakedLiquidityRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { stakedLiquidity, name } = contractData;
  const helpText = "The amount of liquidity staked for TELx rewards.";

  return stakedLiquidity && stakedLiquidity > 0 && !contractsWithoutStaking.includes(name) ? (
    <LabelValueRow label="Staked" helpText={helpText} value={<p>${stakedLiquidity ? stringNumbertoUSD(stakedLiquidity) : 0}</p>} />
  ) : (
    <></>
  );
}

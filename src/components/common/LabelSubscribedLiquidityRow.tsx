import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import { formatShareOfTvl, getSubscribedValue } from "@/helpers/poolRewardsDisplay";

export const SUBSCRIBED_VALUE_HELP = "Liquidity in positions subscribed to TELx rewards.";

export default function LabelSubscribedLiquidityRow({ contractData }: { contractData: ProtocolsContractData }) {
  const subscribed = getSubscribedValue(contractData);
  const value =
    subscribed.kind === "value" ? (
      <p>
        ${stringNumbertoUSD(subscribed.usd)}
        {subscribed.share !== null && <span className="text-primary"> ({formatShareOfTvl(subscribed.share)})</span>}
      </p>
    ) : (
      <p>{subscribed.kind === "unavailable" ? "Unavailable" : subscribed.kind === "not-started" ? "Campaign not started" : "No campaign"}</p>
    );

  return <LabelValueRow label="Subscribed Value Locked" helpText={SUBSCRIBED_VALUE_HELP} value={value} />;
}

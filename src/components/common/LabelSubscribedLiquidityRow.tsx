import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import { formatShareOfTvl, getSubscribedValue, PENDING_LABEL } from "@/helpers/poolRewardsDisplay";
import { useNow } from "@/hooks/useNow";

export const SUBSCRIBED_VALUE_HELP = "Liquidity in positions subscribed to TELx rewards.";

export default function LabelSubscribedLiquidityRow({ contractData }: { contractData: ProtocolsContractData }) {
  const subscribed = getSubscribedValue(contractData, useNow());
  const value =
    subscribed.kind === "value" ? (
      <p>
        ${stringNumbertoUSD(subscribed.usd)}
        {subscribed.share !== null && <span className="text-primary"> ({formatShareOfTvl(subscribed.share)})</span>}
      </p>
    ) : (
      <p>
        {subscribed.kind === "unavailable"
          ? "Unavailable"
          : subscribed.kind === "not-started"
            ? "Campaign not started"
            : subscribed.kind === "pending"
              ? `${PENDING_LABEL} (awaiting Merkl's first update)`
              : "No campaign"}
      </p>
    );

  return <LabelValueRow label="Subscribed Value Locked" helpText={SUBSCRIBED_VALUE_HELP} value={value} />;
}

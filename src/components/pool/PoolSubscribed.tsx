import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import { formatShareOfTvl, getSubscribedValue, PENDING_LABEL } from "@/helpers/poolRewardsDisplay";
import { useNow } from "@/hooks/useNow";

// SVL column of the pool lists: the subscribed value with its share of TVL below it while a campaign is live.
export default function PoolSubscribed({ contractData }: { contractData: ProtocolsContractData }) {
  const subscribed = getSubscribedValue(contractData, useNow());

  return (
    <div className="flex flex-col items-end text-end text-white">
      {subscribed.kind === "value" ? (
        <>
          <p className="text-sm text-white">${stringNumbertoUSD(subscribed.usd)}</p>
          {subscribed.share !== null && <p className="text-xs text-primary">{formatShareOfTvl(subscribed.share)}</p>}
        </>
      ) : (
        <p className="text-sm text-primary">
          {subscribed.kind === "unavailable"
            ? "Unavailable"
            : subscribed.kind === "not-started"
              ? "Not started"
              : subscribed.kind === "pending"
                ? PENDING_LABEL
                : "No campaign"}
        </p>
      )}
    </div>
  );
}

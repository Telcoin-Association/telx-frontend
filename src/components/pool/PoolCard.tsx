import React from "react";
import Link from "next/link";
import ChainLogo from "@/components/common/ChainLogo";
import PoolSnapshotAssets from "./PoolSnapshotAssets";
import PoolTotal from "./PoolTotal";
import PoolSubscribed from "./PoolSubscribed";
import PoolVolume from "./PoolVolume";
import PoolFees from "./PoolFees";
import PoolRewards from "./PoolRewards";
import { isNewPool } from "@/lib/newPool";
import { getPoolPath } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import { numberToDecimalFixed } from "@/helpers/returnNumber";
import { formatApr, formatCampaignDate, getMerklRewards, PENDING_LABEL } from "@/helpers/poolRewardsDisplay";
import { useNow } from "@/hooks/useNow";
import type { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";

/** The campaign headline a card leads with: the APR while live, otherwise when rewards start or that they ended. */
function rewardsHeadline(merkl: ReturnType<typeof getMerklRewards>): { headline: string; live: boolean } | null {
  if (merkl.status === "LIVE") return { headline: merkl.apr != null ? formatApr(merkl.apr) : `APR ${PENDING_LABEL.toLowerCase()}`, live: true };
  if (merkl.status === "SOON") return { headline: merkl.campaignStart != null ? `Starts ${formatCampaignDate(merkl.campaignStart)}` : "Starting soon", live: false };
  if (merkl.status === "PAST") return { headline: "Ended", live: false };
  return null;
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-primary">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One pool as a card, for narrow screens: the chain and pair with the rewards headline beside them, then the weekly
 * rewards line, then TVL, SVL, volume and fees as label and value rows. The whole card links to the pool page.
 */
export default function PoolCard({ contractData }: { contractData: any }) {
  const { poolContractAddress, blockchain, protocol, createdAt } = contractData;
  const merkl = getMerklRewards(contractData, useNow());
  const headline = rewardsHeadline(merkl);
  const rewards: Reward[] = Array.isArray(contractData?.rewards) ? contractData.rewards : [];
  const weekly = rewards.map(reward => `${numberToDecimalFixed(reward.amount, 0)} ${reward.ticker} / week`).join(" · ");
  const rewardsLine = merkl.status === "LIVE" ? [weekly, merkl.campaignEnd != null ? `ends ${formatCampaignDate(merkl.campaignEnd)} (UTC)` : ""].filter(Boolean).join(" · ") : "";

  return (
    <Link
      href={getPoolPath(poolContractAddress, blockchain, protocol)}
      aria-label={`${(contractData?.assets ?? []).map((asset: { ticker: string }) => asset.ticker).join("/")} on ${chainDisplayName(blockchain)}`}
      className="block rounded-2xl border border-white/10 bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 p-4 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ChainLogo chain={blockchain} />
          <PoolSnapshotAssets contractData={contractData} flex />
        </div>
        {headline && (
          <div className="shrink-0 text-right">
            {headline.live && <span className="mb-1 inline-block rounded-full bg-status-complete/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-complete">Live</span>}
            <p className={`font-bold text-white ${headline.live ? "text-lg leading-tight" : "text-sm"}`}>{headline.headline}</p>
          </div>
        )}
      </div>
      {(rewardsLine || isNewPool(createdAt)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isNewPool(createdAt) && <span className="w-fit rounded-[40px] border border-accent px-2 py-0.5 text-xs font-bold text-white">New</span>}
          {rewardsLine && <p className="text-xs text-primary">{rewardsLine}</p>}
        </div>
      )}
      <dl className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
        <Figure label="TVL">
          <PoolTotal contractData={contractData} />
        </Figure>
        <Figure label="SVL">
          <PoolSubscribed contractData={contractData} />
        </Figure>
        <Figure label="Volume (24hr)">
          <PoolVolume contractData={contractData} />
        </Figure>
        <Figure label="Fees (24hr)">
          <PoolFees contractData={contractData} />
        </Figure>
        {!headline && (
          <Figure label="Rewards">
            <PoolRewards contractData={contractData} />
          </Figure>
        )}
      </dl>
    </Link>
  );
}

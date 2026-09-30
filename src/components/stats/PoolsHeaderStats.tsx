"use client";

import React from "react";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import HoverTooltip from "../common/HoverTooltip";

export interface PoolsHeaderStatsProps {
  totalLiquidity: number | null;
  stakedLiquidity: number | null;
  totalVolume: number | null;
  totalFees: number | null;
  type?: string;
  /** The load failed for good: show "Unavailable" for missing totals instead of a spinner. */
  unavailable?: boolean;
  /** Set when some pools are missing from the totals: each shown total gets a "partial" marker with this text on hover. */
  partialNote?: string | null;
  /** Set when pools are missing from the Subscribed Value Locked total alone, for example chains whose rewards are unknown. */
  stakedPartialNote?: string | null;
}

interface StatCardProps {
  title: string;
  value: number | null;
  type?: string;
  unavailable?: boolean;
  partialNote?: string | null;
}

const StatCard = ({ title, value, unavailable, partialNote }: StatCardProps) => {
  const formattedValue =
    value !== null ? (
      partialNote ? (
        <HoverTooltip content={partialNote} placement="below" focusable className="cursor-help gap-2 rounded">
          {formatNumberToCurrencyString(value)}
          <span className="text-xs text-amber-400 underline decoration-amber-400/40 decoration-dotted underline-offset-4">partial</span>
        </HoverTooltip>
      ) : (
        formatNumberToCurrencyString(value)
      )
    ) : unavailable ? (
      "Unavailable"
    ) : (
      <LoadingAnimation size={24} />
    );

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg bg-black/20 px-4 py-3">
      <div>
        <h4 className="text-sm font-medium text-primary">{title}</h4>
      </div>
      <div>
        <div className="text-white-100 text-base">{formattedValue}</div>
      </div>
    </div>
  );
};

const PoolsHeaderStats = ({ totalLiquidity, stakedLiquidity, totalVolume, totalFees, type, unavailable, partialNote, stakedPartialNote }: PoolsHeaderStatsProps) => {
  const stakedNote = [partialNote, stakedPartialNote].filter(Boolean).join(". ") || null;
  const stats = [
    { title: "TVL", value: totalLiquidity, note: partialNote },
    { title: "Subscribed Value Locked", value: stakedLiquidity, note: stakedNote },
    { title: "Volume (24hr)", value: totalVolume, note: partialNote },
    { title: "Fees (24hr)", value: totalFees, note: partialNote },
  ];

  const getLayoutContainer = () => {
    return (
      <div className="grid grid-cols-2 mx-auto w-auto gap-4 md:grid-cols-4">
        {stats.map(stat => (
          <StatCard key={stat.title} title={stat.title} value={stat.value} type={type} unavailable={unavailable} partialNote={stat.note} />
        ))}
      </div>
    );
  };

  return getLayoutContainer();
};

export default PoolsHeaderStats;

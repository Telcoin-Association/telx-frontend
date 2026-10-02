import React from "react";
import HelpTip from "./HelpTip";
import type { Position, PositionTel } from "@/lib/positions";
import { formatUsd, type PoolAsset } from "@/lib/positionView";
import { formatMultiplier, liquidityMultiplier, rangeMarker, tokenSplit } from "@/lib/v4/positionMetrics";
import type { PositionRewardsState } from "@/hooks/usePositionRewards";

export const LM_HELP =
  "Liquidity multiplier: how much more liquidity this position provides at the current price than a full-range position holding the same value. A narrower range earns more while the price stays inside it. Full range is 1x.";

export const PENDING_TEL_HELP =
  "TEL this position has earned from TELx campaigns: what Merkl has credited, claimable now, plus what has accrued since Merkl's last update. Rewards are claimed for the whole wallet from the Portfolio page. The figure is provisional until each campaign it comes from has settled.";

const tel = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

/** A TEL amount for a position row, for example "35.7K TEL". */
export function formatPositionTel(amount: number): string {
  return `${amount > 0 && amount < 0.01 ? "<0.01" : tel.format(amount)} TEL`;
}

/** The position's LM for display, or null when it can't be computed. */
export function positionMultiplier(position: Pick<Position, "tickLower" | "tickUpper" | "amounts">): string | null {
  return formatMultiplier(liquidityMultiplier(position.tickLower, position.tickUpper, position.amounts?.sqrtPriceX96));
}

/** The LM with its explanation. */
export function MultiplierFigure({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-1 text-sm text-white">
      <span className="text-xs text-primary">LM</span>
      <span className="font-semibold">{value}</span>
      <HelpTip text={LM_HELP} label="About the liquidity multiplier" />
    </span>
  );
}

/**
 * Where the price sits within the position's range, with the value split between its tokens. Out of range the bar
 * is muted and the marker rests at the edge the price left from.
 */
export function RangeBar({ position, assets }: { position: Pick<Position, "tickLower" | "tickUpper" | "amounts" | "price">; assets: PoolAsset[] }) {
  const marker = rangeMarker(position.tickLower, position.tickUpper, position.amounts?.sqrtPriceX96);
  if (!marker) return null;
  const split = tokenSplit(position.amounts.amount0, position.amounts.amount1, Number(position.price?.price1Per0));
  const [ticker0, ticker1] = [assets[0]?.ticker ?? "Token 0", assets[1]?.ticker ?? "Token 1"];
  const splitText = split ? `${split[0]}% ${ticker0} · ${split[1]}% ${ticker1}` : null;
  const percent = Math.round(marker.fraction * 100);
  const description = marker.inRange
    ? `Price at ${percent}% of the range${splitText ? `, ${splitText}` : ""}`
    : `Price ${marker.fraction <= 0 ? "below" : "above"} the range${splitText ? `, ${splitText}` : ""}`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div role="img" aria-label={description} className="relative h-2 w-full rounded-full bg-white/10">
        <div className={`absolute inset-0 rounded-full ${marker.inRange ? "bg-accent/50" : "bg-white/10"}`} />
        <span
          data-testid="range-marker"
          className={`absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${marker.inRange ? "bg-white" : "bg-yellow-300"}`}
          style={{ left: `${percent}%` }}
        />
      </div>
      {splitText && <span className="text-xs text-primary">{splitText}</span>}
    </div>
  );
}

/** The position's TELx rewards, with what is claimable and accruing, priced at `telUsd` when given. */
export function PendingTel({ tokenId, rewards, telUsd }: { tokenId: string; rewards: PositionRewardsState | undefined; telUsd?: number }) {
  if (!rewards) return null;
  let value: React.ReactNode;
  let detail: string | null = null;
  let provisional = false;
  if (rewards.status === "loading") value = <span className="text-primary">Loading…</span>;
  else if (rewards.status === "failed") value = <span className="text-primary">Unavailable</span>;
  else {
    const entry: PositionTel | undefined = rewards.rewards.positions[tokenId];
    const reward = entry?.reward ?? 0;
    value = <span className="font-semibold text-white">{formatPositionTel(reward)}</span>;
    if (reward > 0 && telUsd !== undefined) detail = formatUsd(reward * telUsd);
    provisional = reward > 0 && entry?.final === false;
  }
  const entry = rewards.status === "ready" ? rewards.rewards.positions[tokenId] : undefined;
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1 text-xs text-primary">
        TELx rewards
        <HelpTip text={PENDING_TEL_HELP} label="About TELx rewards" />
      </span>
      <span data-testid={`pending-tel-${tokenId}`} className="text-sm">
        {value}
        {detail && <span className="ml-1 text-xs text-primary">{detail}</span>}
      </span>
      {entry && entry.reward > 0 && (
        <span className="text-xs text-primary">
          {formatPositionTel(entry.claimable)} claimable, {formatPositionTel(entry.pending)} accruing
          {provisional && <span className="ml-1 text-yellow-300">· Provisional</span>}
        </span>
      )}
    </div>
  );
}

/** A compact TEL figure for the collapsed mobile line, or null while loading or unavailable. */
export function pendingTelSummary(tokenId: string, rewards: PositionRewardsState | undefined): string | null {
  if (rewards?.status !== "ready") return null;
  return formatPositionTel(rewards.rewards.positions[tokenId]?.reward ?? 0);
}

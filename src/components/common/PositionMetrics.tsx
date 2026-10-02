import React from "react";
import HelpTip from "./HelpTip";
import type { Position, PositionTel } from "@/lib/positions";
import { formatUsd, type PoolAsset } from "@/lib/positionView";
import { formatPrice } from "@/lib/priceFormat";
import { formatMultiplier, liquidityMultiplier, rangePrices, rangeState, type RangeState } from "@/lib/v4/positionMetrics";
import type { PositionRewardsState } from "@/hooks/usePositionRewards";

export const LM_HELP =
  "Liquidity multiplier: how much more liquidity this position provides at the current price than a full-range position holding the same value. A narrower range earns more while the price stays inside it. Full range is 1x.";

export const PENDING_TEL_HELP =
  "TEL this position has earned from TELx campaigns: what Merkl has credited plus what has accrued since Merkl's last update. Claimable is the credited part not yet claimed. Rewards are claimed for the whole wallet from the Portfolio page.";

export const PROVISIONAL_HELP =
  "Merkl can still adjust this figure until each campaign it comes from has ended, been computed to its end and passed its dispute window.";

export const FULL_RANGE_HELP = "This position covers every price, so it never goes out of range. It earns fees and rewards at the lowest rate per dollar.";

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

/** The position's range state, from its ticks and the pool's price. */
export function positionRangeState(position: Pick<Position, "tickLower" | "tickUpper" | "amounts">): RangeState | null {
  return rangeState(position.tickLower, position.tickUpper, position.amounts?.sqrtPriceX96);
}

const RANGE_TONE: Record<Exclude<RangeState["kind"], "full">, { track: string; marker: string; label: string }> = {
  in: { track: "bg-green-400/50", marker: "bg-white", label: "In range" },
  near: { track: "bg-yellow-300/50", marker: "bg-yellow-300", label: "Near the edge of the range" },
  out: { track: "bg-red-400/40", marker: "bg-red-300", label: "Out of range" },
};

/**
 * Where the price stands within the position's range: a slim track from the minimum to the maximum price with a
 * marker at the current price, green in range, amber near either edge and red out of range, with the bounds below.
 * A full-range position can't leave its range, so it reads "Full range" instead.
 */
export function RangeIndicator({ position, assets }: { position: Pick<Position, "tickLower" | "tickUpper" | "amounts" | "price">; assets: PoolAsset[] }) {
  const state = positionRangeState(position);
  if (!state) return null;
  if (state.kind === "full") {
    return (
      <span data-testid="range-full" className="flex items-center gap-1 text-sm text-white">
        Full range
        <HelpTip text={FULL_RANGE_HELP} label="About full-range positions" />
      </span>
    );
  }
  const tone = RANGE_TONE[state.kind];
  const prices = rangePrices(position.tickLower, position.tickUpper, position.amounts?.sqrtPriceX96, Number(position.price?.price1Per0));
  const [ticker0, ticker1] = [assets[0]?.ticker ?? "token 0", assets[1]?.ticker ?? "token 1"];
  const unit = `${ticker1} per ${ticker0}`;
  const percent = Math.round(state.fraction * 100);
  const where = state.kind === "out" ? `price ${state.fraction <= 0 ? "below" : "above"} the range` : `price at ${percent}% of the range`;
  const bounds = prices ? `, from ${formatPrice(prices.min)} to ${formatPrice(prices.max)} ${unit}` : "";

  return (
    <div data-testid="range-indicator" data-state={state.kind} className="flex min-w-0 flex-col gap-1">
      <div role="img" aria-label={`${tone.label}: ${where}${bounds}`} className="relative h-1.5 w-full rounded-full bg-white/10">
        <div className={`absolute inset-0 rounded-full ${tone.track}`} />
        <span
          data-testid="range-marker"
          className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${tone.marker}`}
          style={{ left: `${percent}%` }}
        />
      </div>
      {prices && (
        <div aria-hidden="true" className="flex justify-between gap-2 text-[11px] text-primary">
          <span>{formatPrice(prices.min)}</span>
          <span className="truncate">{unit}</span>
          <span>{formatPrice(prices.max)}</span>
        </div>
      )}
    </div>
  );
}

/** The position's TELx rewards, with what is claimable and accruing, priced at `telUsd` when given. */
export function PendingTel({ tokenId, rewards, telUsd }: { tokenId: string; rewards: PositionRewardsState | undefined; telUsd?: number }) {
  if (!rewards) return null;
  let value: React.ReactNode;
  let detail: string | null = null;
  if (rewards.status === "loading") value = <span className="text-primary">Loading…</span>;
  else if (rewards.status === "failed") value = <span className="text-primary">Unavailable</span>;
  else {
    const reward = rewards.rewards.positions[tokenId]?.reward ?? 0;
    value = <span className="font-semibold text-white">{formatPositionTel(reward)}</span>;
    if (reward > 0 && telUsd !== undefined) detail = formatUsd(reward * telUsd);
  }
  const entry: PositionTel | undefined = rewards.status === "ready" ? rewards.rewards.positions[tokenId] : undefined;
  const provisional = entry !== undefined && entry.reward > 0 && !entry.final;
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
        <span className="flex flex-wrap items-center gap-x-1 text-xs text-primary">
          {formatPositionTel(entry.claimable)} claimable, {formatPositionTel(entry.pending)} accruing
          {provisional && (
            <span data-testid={`provisional-${tokenId}`} className="flex items-center gap-1 text-primary">
              · Provisional
              <HelpTip text={PROVISIONAL_HELP} label="About provisional rewards" />
            </span>
          )}
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

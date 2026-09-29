import React, { useId, useState } from "react";
import Image from "next/image";
import { _Loader } from "./LoadingAnimationCircle";
import { getAssetImage } from "../pool/PoolWeightChip";
import type { Position } from "@/lib/positions";
import {
  FILTER_LABEL,
  POSITION_FILTERS,
  STATUS_LABEL,
  countPositions,
  filterPositions,
  formatTokenAmount,
  formatUsd,
  isPositionInRange,
  positionStatus,
  positionUsdValue,
  type PoolAsset,
  type PositionFilter,
  type PositionStatus,
  type UsdRates,
} from "@/lib/positionView";

export type PositionAction = "subscribe" | "unsubscribe";

/**
 * The one transaction in flight, if any, with its hash once the wallet has sent it. Only one runs at a time
 * because the receipt watcher follows one hash.
 */
export type PendingPositionTx = { tokenId: string; action: PositionAction; hash?: `0x${string}` };

/** Outcome of a row's last transaction, shown under its button until the list is reloaded. */
export type PositionTxResult = { kind: "success" | "error"; message: string; txUrl?: string; txLinkLabel?: string };

export type PositionsListProps = {
  positions: Position[];
  /** Pool assets in currency0, currency1 order, matching `amount0` and `amount1`. */
  assets: PoolAsset[];
  rates?: UsdRates;
  pending: PendingPositionTx | null;
  results: Record<string, PositionTxResult>;
  onSubscribe: (tokenId: string) => void;
  onUnsubscribe: (tokenId: string) => void;
  addLiquidityLink?: string;
  /** Heading above the chips; the pool page uses the default. */
  title?: React.ReactNode;
};

const BADGE = "w-fit whitespace-nowrap rounded-[40px] border px-3 py-1 text-xs font-bold";

const STATUS_BADGE: Record<PositionStatus, string> = {
  subscribed: "border-green-500/60 bg-green-800/40 text-green-300",
  notSubscribed: "border-white/30 bg-white/5 text-white",
  closed: "border-red-500/50 bg-red-700/20 text-red-300",
};

const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
const CHIP_ACTIVE = "border-[#4967FF] bg-[#4967FF] font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-[#0E0E3E]/50 hover:text-white";

const LINK_BUTTON = "w-fit rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white duration-200 hover:scale-105";

function emptyFilterText(filter: PositionFilter): string {
  switch (filter) {
    case "all":
      return "All of your positions in this pool are closed.";
    case "subscribed":
      return "None of your positions in this pool are subscribed.";
    case "notSubscribed":
      return "All of your open positions in this pool are subscribed.";
    case "closed":
      return "You have no closed positions in this pool.";
  }
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/20 p-6 text-center text-sm text-primary">{children}</div>;
}

export default function PositionsList(props: PositionsListProps) {
  const { positions, addLiquidityLink, title = "Your positions in this pool" } = props;
  const [filter, setFilter] = useState<PositionFilter>("all");
  const headingId = useId();

  if (positions.length === 0) {
    return (
      <EmptyState>
        <p>You do not have any Uniswap v4 positions in this pool.</p>
        {addLiquidityLink && (
          <a href={addLiquidityLink} target="_blank" rel="noreferrer" className={LINK_BUTTON}>
            Add liquidity on Uniswap
          </a>
        )}
      </EmptyState>
    );
  }

  const counts = countPositions(positions);
  const visible = filterPositions(positions, filter);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h3 id={headingId} className="text-lg font-semibold text-white">
          {title}
        </h3>
        <div role="group" aria-label="Filter positions" className="flex flex-wrap gap-2">
          {POSITION_FILTERS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`${CHIP} ${filter === option ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {FILTER_LABEL[option]} <span className="font-bold">({counts[option]})</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState>
          <p>{emptyFilterText(filter)}</p>
          <button type="button" onClick={() => setFilter(filter === "all" ? "closed" : "all")} className={LINK_BUTTON}>
            {filter === "all" ? "Show closed" : "Show all"}
          </button>
        </EmptyState>
      ) : (
        <ul aria-label={`${FILTER_LABEL[filter]} positions`} className="divide-y divide-white/10 overflow-hidden rounded-2xl bg-black/20 shadow-xl">
          {visible.map(position => (
            <PositionRow key={position.tokenId} position={position} {...props} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PositionRow({ position, assets, rates, pending, results, onSubscribe, onUnsubscribe }: PositionsListProps & { position: Position }) {
  const { tokenId } = position;
  const status = positionStatus(position);
  const inRange = status === "closed" ? null : isPositionInRange(position);
  const usd = status === "closed" ? null : positionUsdValue(position, assets[0], assets[1], rates);
  const result = results[tokenId];
  const isPending = pending?.tokenId === tokenId;
  const action: PositionAction | null = status === "subscribed" ? "unsubscribe" : status === "notSubscribed" ? "subscribe" : null;

  const rangeText = inRange === null ? "" : inRange ? ", in range" : ", out of range";
  const amounts = [position.amounts.amount0, position.amounts.amount1];

  return (
    <li
      aria-label={`Position ${tokenId}, ${STATUS_LABEL[status]}${rangeText}`}
      aria-busy={isPending || undefined}
      className="flex flex-col gap-3 p-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <span className="font-mono text-sm break-all text-white">Position #{tokenId}</span>
        <div className="flex flex-wrap gap-2">
          <span className={`${BADGE} ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
          {inRange !== null &&
            (inRange ? (
              <span className={`${BADGE} border-[#4967FF] text-white`}>In range</span>
            ) : (
              <span className={`${BADGE} border-yellow-500/60 bg-yellow-500/10 text-yellow-300`}>Out of range</span>
            ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {assets.slice(0, 2).map((asset, i) => {
          const image = getAssetImage(asset);
          return (
            <div key={i} className="flex items-center gap-2 text-sm text-white">
              {image && <Image src={(image as any).src ?? image} alt="" width={18} height={18} />}
              <span className="truncate" title={`${amounts[i]} ${asset.ticker ?? ""}`}>
                {formatTokenAmount(amounts[i])} {asset.ticker}
              </span>
            </div>
          );
        })}
        {usd !== null && <p className="text-xs text-primary">{formatUsd(usd)}</p>}
      </div>

      <div className="flex flex-col gap-1 sm:items-end">
        {action && (
          <RowActionButton
            tokenId={tokenId}
            action={action}
            isPending={isPending}
            disabled={pending !== null}
            onClick={() => (action === "subscribe" ? onSubscribe(tokenId) : onUnsubscribe(tokenId))}
          />
        )}
        {isPending && <p className="text-xs text-yellow-400">{pending?.hash ? "Waiting for confirmation..." : "Confirm in your wallet."}</p>}
        <div role="status" aria-live="polite" className="text-xs sm:text-right">
          {!isPending && result && (
            <p className={result.kind === "success" ? "text-green-400" : "text-red-400"}>
              {result.message}
              {result.txUrl && (
                <>
                  {" "}
                  <a href={result.txUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                    {result.txLinkLabel ?? "View transaction"}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function RowActionButton({
  tokenId,
  action,
  isPending,
  disabled,
  onClick,
}: {
  tokenId: string;
  action: PositionAction;
  isPending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = action === "subscribe" ? "Subscribe" : "Unsubscribe";
  const pendingLabel = action === "subscribe" ? "Subscribing..." : "Unsubscribing...";
  const style =
    action === "subscribe"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "border border-red-500/60 text-red-300 hover:bg-red-700/30 hover:text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${isPending ? pendingLabel : label} position ${tokenId}`}
      className={`flex w-full min-w-32 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:w-auto disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
    >
      {isPending && <_Loader size={14} theme="extra-light" />}
      {isPending ? pendingLabel : label}
    </button>
  );
}

import React, { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { _Loader } from "./LoadingAnimationCircle";
import PositionHistory from "./PositionHistory";
import { MultiplierFigure, PendingTel, RangeBar, pendingTelSummary, positionMultiplier } from "./PositionMetrics";
import type { PositionRewardsState } from "@/hooks/usePositionRewards";
import type { CollectEstimates } from "@/hooks/useCollectEstimates";
import { collectTarget, hasCollectableFees, type CollectTarget } from "@/lib/v4/collect";
import type { RpcChain } from "@/lib/rpc";
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
  isClosedButSubscribed,
  isPositionInRange,
  positionStatus,
  positionUsdValue,
  sortPositions,
  usdRate,
  type PoolAsset,
  type PositionFilter,
  type PositionStatus,
  type UsdRates,
  withConfirmedSubscriptions,
} from "@/lib/positionView";

export type PositionAction = "subscribe" | "unsubscribe" | "collect";

/**
 * Where a row's transaction is: `checking` simulates it, `switching` waits for the wallet to change network,
 * `signing` waits for the wallet's approval, and `mining` waits for the receipt of `hash`.
 */
export type PositionTxStep = "checking" | "switching" | "signing" | "mining";

/** The one transaction in flight, if any: its row, step and the pool chain's display name. */
export type PendingPositionTx = {
  tokenId: string;
  action: PositionAction;
  step: PositionTxStep;
  chainName: string;
  hash?: `0x${string}`;
  txUrl?: string;
  txLinkLabel?: string;
};

/**
 * Outcome of a row's last transaction, shown under its button until the list is reloaded. `notice` is a step
 * the user chose not to take, such as a declined network switch. `subscribed` is the subscription state a
 * confirmed transaction set.
 */
export type PositionTxResult = {
  kind: "success" | "error" | "notice";
  message: string;
  txUrl?: string;
  txLinkLabel?: string;
  subscribed?: boolean;
};

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
  /** The pool's registry accepts only in-range positions, so Subscribe is withheld from out-of-range rows. */
  subscribeNeedsInRange?: boolean;
  /** Heading above the chips; the pool page uses the default. */
  title?: React.ReactNode;
  /** The pool's chain. With it, each open position's row offers its history (value, fees and range over time). */
  chain?: RpcChain;
  /** The pool's per-position TELx rewards. With it, each row shows the position's rewards. */
  rewards?: PositionRewardsState;
  /** The pool id. With it and `onCollect`, open positions offer to collect their trading fees. */
  poolId?: string;
  /** Collects the fees of `targets` in one transaction, showing progress on the row `rowKey` ("pool" for all). */
  onCollect?: (rowKey: string, targets: CollectTarget[]) => void;
  /** Estimated network fees for collecting, in USD. */
  collectEstimates?: CollectEstimates;
};

/** The row key the pool-wide collect reports its progress and result under. */
export const POOL_COLLECT_KEY = "pool";



const BADGE = "w-fit whitespace-nowrap rounded-[40px] border px-3 py-1 text-xs font-bold";

const STATUS_BADGE: Record<PositionStatus, string> = {
  subscribed: "border-green-500/60 bg-green-800/40 text-green-300",
  notSubscribed: "border-white/30 bg-white/5 text-white",
  closed: "border-red-500/50 bg-red-700/20 text-red-300",
};

const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

const LINK_BUTTON = "w-fit rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white duration-200 hover-lift";

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

const RESULT_COLOR: Record<PositionTxResult["kind"], string> = { success: "text-green-400", error: "text-red-400", notice: "text-primary" };

function pendingText(pending: PendingPositionTx): string {
  switch (pending.step) {
    case "checking":
      return "Checking the transaction...";
    case "switching":
      return `Switch your wallet to ${pending.chainName} to continue.`;
    case "signing":
      return "Confirm in your wallet.";
    case "mining":
      return "Waiting for confirmation...";
  }
}

export default function PositionsList(props: PositionsListProps) {
  const { addLiquidityLink, results, title = "Your positions in this pool" } = props;
  const confirmed = Object.fromEntries(Object.entries(results).map(([tokenId, result]) => [tokenId, result.subscribed]));
  const positions = sortPositions(withConfirmedSubscriptions(props.positions, confirmed), props.assets, props.rates);
  const [filter, setFilterState] = useState<PositionFilter>("all");
  const headingId = useId();
  const chipRefs = useRef<Partial<Record<PositionFilter, HTMLButtonElement | null>>>({});

  // Rows acted on under the current filter stay listed until the filter changes, so a row whose status
  // changes keeps its outcome, its explorer link and keyboard focus in view instead of leaving the list.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const pendingId = props.pending?.tokenId;
  useEffect(() => {
    if (pendingId) setKept(prev => (prev.has(pendingId) ? prev : new Set(prev).add(pendingId)));
  }, [pendingId]);

  const setFilter = (next: PositionFilter, focusChip = false) => {
    setFilterState(next);
    setKept(new Set());
    // The empty-state button that asked for the change unmounts with the empty state, so focus moves to
    // the chip now pressed instead of falling back to the page.
    if (focusChip) requestAnimationFrame(() => chipRefs.current[next]?.focus());
  };

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
  const collectable = props.onCollect && props.poolId ? positions.filter(hasCollectableFees) : [];
  const matching = new Set(filterPositions(positions, filter).map(position => position.tokenId));
  const visible = positions.filter(position => matching.has(position.tokenId) || kept.has(position.tokenId));

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
              ref={element => {
                chipRefs.current[option] = element;
              }}
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

      {collectable.length > 1 && props.onCollect && props.poolId && (
        <CollectAllBar
          positions={collectable}
          assets={props.assets}
          rates={props.rates}
          estimateUsd={props.collectEstimates?.all ?? null}
          pending={props.pending}
          result={props.results[POOL_COLLECT_KEY]}
          onCollect={() => props.onCollect!(POOL_COLLECT_KEY, collectable.map(position => collectTarget(position, props.poolId!)))}
        />
      )}

      {visible.length === 0 ? (
        <EmptyState>
          <p>{emptyFilterText(filter)}</p>
          <button type="button" onClick={() => setFilter(filter === "all" ? "closed" : "all", true)} className={LINK_BUTTON}>
            {filter === "all" ? "Show closed" : "Show all"}
          </button>
        </EmptyState>
      ) : (
        <ul aria-label={`${FILTER_LABEL[filter]} positions`} className="divide-y divide-white/10 overflow-hidden rounded-2xl bg-black/20 shadow-xl">
          {visible.map(position => (
            <PositionRow key={position.tokenId} {...props} position={position} />
          ))}
        </ul>
      )}

      {filter !== "closed" && visible.length > 0 && counts.closedSubscribed > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-primary">
          {counts.closedSubscribed === 1
            ? "1 closed position is still subscribed."
            : `${counts.closedSubscribed} closed positions are still subscribed.`}
          <button type="button" onClick={() => setFilter("closed", true)} className="text-white underline hover:text-primary">
            Show closed
          </button>
        </p>
      )}
    </section>
  );
}

function PositionRow({
  position,
  assets,
  rates,
  pending,
  results,
  onSubscribe,
  onUnsubscribe,
  subscribeNeedsInRange,
  chain,
  rewards,
  poolId,
  onCollect,
  collectEstimates,
}: PositionsListProps & { position: Position }) {
  const { tokenId } = position;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const historyId = useId();
  const detailsId = useId();
  const status = positionStatus(position);
  // Open positions only: a closed one holds nothing to value.
  const showHistory = chain !== undefined && status !== "closed";
  const stillSubscribed = isClosedButSubscribed(position);
  const inRange = status === "closed" ? null : isPositionInRange(position);
  const usd = status === "closed" ? null : positionUsdValue(position, assets[0], assets[1], rates);
  const result = results[tokenId];
  const isPending = pending?.tokenId === tokenId;
  const isCollecting = isPending && pending?.action === "collect";
  // Open positions in a pool that can collect show their uncollected fees, and offer to collect them.
  const showFees = Boolean(onCollect && poolId) && status !== "closed" && position.fees !== undefined;
  const collectable = showFees && hasCollectableFees(position);
  const feesValue = position.fees ? feesUsd(position.fees, position, assets, rates) : null;
  const action: PositionAction | null =
    status === "subscribed" || stillSubscribed ? "unsubscribe" : status === "notSubscribed" ? "subscribe" : null;
  // A subscribe the registry is certain to reject is not offered.
  const subscribeBlocked = action === "subscribe" && subscribeNeedsInRange === true && inRange === false;

  const rangeText = (stillSubscribed ? ", still subscribed" : "") + (inRange === null ? "" : inRange ? ", in range" : ", out of range");
  const amounts = [position.amounts.amount0, position.amounts.amount1];
  const multiplier = status === "closed" ? null : positionMultiplier(position);
  const telSummary = pendingTelSummary(tokenId, rewards);
  // Green when subscribed and in range, amber when out of range, grey otherwise.
  const dotColor = inRange === false ? "bg-yellow-300" : status === "subscribed" ? "bg-green-400" : status === "closed" ? "bg-red-400" : "bg-white/50";
  // On phones the range bar and amounts sit behind a Details toggle; from `sm` up they always show.
  const detailsClass = `${detailsOpen ? "flex" : "hidden"} min-w-0 flex-col gap-2 sm:flex`;

  return (
    <li
      aria-label={`Position ${tokenId}, ${STATUS_LABEL[status]}${rangeText}`}
      aria-busy={isPending || undefined}
      className="flex flex-col gap-3 p-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(8rem,14rem)] sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <span className="font-mono text-sm break-all text-white">Position #{tokenId}</span>
        <div data-testid="position-summary" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white sm:hidden">
          <span aria-hidden="true" title={STATUS_LABEL[status]} className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
          {multiplier && <span>LM {multiplier}</span>}
          {telSummary && <span>{telSummary}</span>}
          {/* A closed position has no range and holds nothing, so there is nothing to expand. */}
          {status !== "closed" && (
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen(open => !open)}
              className="ml-auto text-xs text-primary underline decoration-white/30 underline-offset-4 hover:text-white"
            >
              {detailsOpen ? "Hide details" : "Details"}
            </button>
          )}
        </div>
        <div className="hidden flex-wrap gap-2 sm:flex">
          <span className={`${BADGE} ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
          {stillSubscribed && <span className={`${BADGE} ${STATUS_BADGE.subscribed}`}>Still subscribed</span>}
          {inRange !== null &&
            (inRange ? (
              <span className={`${BADGE} border-accent text-white`}>In range</span>
            ) : (
              <span className={`${BADGE} border-yellow-500/60 bg-yellow-500/10 text-yellow-300`}>Out of range</span>
            ))}
        </div>
        {showHistory && (
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls={historyId}
            onClick={() => setHistoryOpen(open => !open)}
            className="w-fit text-xs text-primary underline decoration-white/30 underline-offset-4 hover:text-white"
          >
            {historyOpen ? "Hide history" : "History"}
          </button>
        )}
      </div>

      <div id={detailsId} data-testid="position-range" className={detailsClass}>
        {multiplier && (
          <div className="hidden sm:block">
            <MultiplierFigure value={multiplier} />
          </div>
        )}
        {status !== "closed" && <RangeBar position={position} assets={assets} />}
      </div>

      <div data-testid="position-amounts" className={`${detailsOpen ? "flex" : "hidden"} min-w-0 flex-col gap-1 sm:flex`}>
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
        {showFees && (
          <div className="mt-1 flex flex-col">
            <span className="text-xs text-primary">Uncollected fees</span>
            <span data-testid={`fees-${tokenId}`} className="text-sm text-white">
              {position.fees === null ? (
                <span className="text-primary">Unavailable</span>
              ) : collectable && position.fees ? (
                <>
                  {feeAmountsText(position.fees, assets)}
                  {feesValue !== null && <span className="ml-1 text-xs text-primary">{formatUsd(feesValue)}</span>}
                </>
              ) : (
                <span className="text-primary">None yet</span>
              )}
            </span>
          </div>
        )}
        <div className="mt-1 hidden sm:block">
          <PendingTel tokenId={tokenId} rewards={rewards} telUsd={usdRate(rates, "TEL")} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1 sm:items-end">
        {action && (
          <RowActionButton
            tokenId={tokenId}
            action={action}
            isPending={isPending && !isCollecting}
            busy={pending !== null}
            disabled={subscribeBlocked}
            onClick={() => (action === "subscribe" ? onSubscribe(tokenId) : onUnsubscribe(tokenId))}
          />
        )}
        {subscribeBlocked && !result && <p className="text-xs text-primary">Only in-range positions can be subscribed.</p>}
        {showFees && (
          <>
            <CollectButton
              label={`Collect fees from position ${tokenId}`}
              isPending={isCollecting}
              busy={pending !== null}
              disabled={!collectable}
              onClick={() => onCollect!(tokenId, [collectTarget(position, poolId!)])}
            />
            {!collectable && !result && <p className="text-xs text-primary">No fees to collect yet.</p>}
            {collectable && <NetworkFeeNote estimateUsd={collectEstimates?.perToken[tokenId] ?? null} valueUsd={feesValue} />}
          </>
        )}
        <TxStatus pending={isPending ? pending : null} result={result} />
      </div>
      {showHistory && historyOpen && (
        <div id={historyId} className="sm:col-span-4">
          <PositionHistory chain={chain} tokenId={tokenId} />
        </div>
      )}
    </li>
  );
}

/** A pending step or a finished outcome under an action, with its explorer link. */
function TxStatus({ pending, result }: { pending: PendingPositionTx | null; result: PositionTxResult | undefined }) {
  return (
    <div role="status" aria-live="polite" className="break-words text-xs sm:text-right">
      {pending && (
        <p className="text-yellow-400">
          {pendingText(pending)}
          {pending.txUrl && (
            <>
              {" "}
              <a href={pending.txUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                {pending.txLinkLabel ?? "View transaction"}
              </a>
            </>
          )}
        </p>
      )}
      {!pending && result && (
        <p className={RESULT_COLOR[result.kind]}>
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
  );
}

/** Fee amounts in both tokens, for example "0.007123 WETH · 12,830 TEL", leaving out a zero side. */
function feeAmountsText(fees: { amount0: string; amount1: string }, assets: PoolAsset[]): string {
  return [fees.amount0, fees.amount1]
    .map((amount, i) => (Number(amount) > 0 ? `${formatTokenAmount(amount)} ${assets[i]?.ticker ?? ""}`.trim() : null))
    .filter(Boolean)
    .join(" · ");
}

/** USD value of fee amounts, or null when they can't be priced. */
function feesUsd(fees: { amount0: string; amount1: string }, position: Pick<Position, "price">, assets: PoolAsset[], rates: UsdRates | undefined): number | null {
  return positionUsdValue({ amounts: { ...fees, sqrtPriceX96: "0" }, price: position.price }, assets[0], assets[1], rates);
}

/** The estimated network fee, and a warning when it is more than the fees it collects. */
function NetworkFeeNote({ estimateUsd, valueUsd }: { estimateUsd: number | null; valueUsd: number | null }) {
  if (estimateUsd === null) return null;
  const uneconomic = valueUsd !== null && estimateUsd > valueUsd;
  return (
    <p className={`text-xs ${uneconomic ? "text-yellow-300" : "text-primary"}`}>
      Network fee about {formatUsd(estimateUsd)}
      {uneconomic && ". It costs more than the fees it collects."}
    </p>
  );
}

const COLLECT_BUTTON =
  "flex w-full min-w-32 cursor-pointer items-center justify-center gap-2 rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-navy/50 sm:w-auto disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

function CollectButton({ label, isPending, busy, disabled, onClick }: { label: string; isPending: boolean; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!busy) onClick();
      }}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-label={label}
      className={COLLECT_BUTTON}
    >
      {isPending && <_Loader size={14} theme="extra-light" />}
      {isPending ? "Collecting..." : "Collect fees"}
    </button>
  );
}

/** Collect every position's fees in this pool at once, when more than one position has fees waiting. */
function CollectAllBar(props: {
  positions: Position[];
  assets: PoolAsset[];
  rates?: UsdRates;
  estimateUsd: number | null;
  pending: PendingPositionTx | null;
  result: PositionTxResult | undefined;
  onCollect: () => void;
}) {
  const { positions, assets, rates, estimateUsd, pending, result, onCollect } = props;
  const total = positions.reduce(
    (sum, position) => ({ amount0: sum.amount0 + Number(position.fees!.amount0), amount1: sum.amount1 + Number(position.fees!.amount1) }),
    { amount0: 0, amount1: 0 },
  );
  const totals = { amount0: String(total.amount0), amount1: String(total.amount1) };
  const valueUsd = positions.reduce<number | null>((sum, position) => {
    const usd = feesUsd(position.fees!, position, assets, rates);
    return sum === null || usd === null ? null : sum + usd;
  }, 0);
  const isPending = pending?.tokenId === POOL_COLLECT_KEY;

  return (
    <div data-testid="collect-all" className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-white">
          Uncollected fees across {positions.length} positions: <span className="font-semibold">{feeAmountsText(totals, assets)}</span>
          {valueUsd !== null && <span className="ml-1 text-xs text-primary">{formatUsd(valueUsd)}</span>}
        </p>
        <NetworkFeeNote estimateUsd={estimateUsd} valueUsd={valueUsd} />
        <p className="text-xs text-primary">One transaction collects them all. Positions stay subscribed and keep earning TELx rewards.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 sm:items-end">
        <CollectButton label={`Collect fees from all ${positions.length} positions`} isPending={isPending} busy={pending !== null} disabled={false} onClick={onCollect} />
        <TxStatus pending={isPending ? pending : null} result={result} />
      </div>
    </div>
  );
}

function RowActionButton({
  tokenId,
  action,
  isPending,
  busy,
  disabled,
  onClick,
}: {
  tokenId: string;
  action: PositionAction;
  isPending: boolean;
  /** Another transaction in the list is in flight. The button keeps focus and ignores presses meanwhile. */
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = action === "subscribe" ? "Subscribe" : "Unsubscribe";
  const pendingLabel = action === "subscribe" ? "Subscribing..." : "Unsubscribing...";
  const style =
    action === "subscribe"
      ? "bg-blue-1000 text-white hover:bg-blue-1100"
      : "border border-red-500/60 text-red-300 hover:bg-red-700/30 hover:text-white";

  return (
    <button
      type="button"
      onClick={() => {
        if (!busy) onClick();
      }}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-label={`${isPending ? pendingLabel : label} position ${tokenId}`}
      className={`flex w-full min-w-32 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:w-auto disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${style}`}
    >
      {isPending && <_Loader size={14} theme="extra-light" />}
      {isPending ? pendingLabel : label}
    </button>
  );
}

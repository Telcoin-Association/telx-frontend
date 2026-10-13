import React, { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { _Loader } from "./LoadingAnimationCircle";
import PositionHistory from "./PositionHistory";
import HelpTip from "./HelpTip";
import { LM_HELP, MultiplierFigure, PENDING_TEL_HELP, PendingTel, RangeIndicator, UsdSuffix, pendingTelSummary, positionMultiplier } from "./PositionMetrics";
import PositionMoreMenu, { type MoreMenuItem } from "./PositionMoreMenu";
import IncreaseLiquidityPanel from "./IncreaseLiquidityPanel";
import RemoveLiquidityPanel from "./RemoveLiquidityPanel";
import type { WithdrawOptions } from "@/hooks/usePositionActions";
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
  positionAmountsUsd,
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

export type PositionAction = "subscribe" | "unsubscribe" | "collect" | "decrease" | "close";

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
  /** A confirmed close: the position is burned, so it shows as closed until the list is reloaded. */
  closed?: boolean;
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
  /**
   * Removes part of a position's liquidity. With it, `onClosePosition`, `chain` and `poolId`, each open position's
   * More menu offers Add liquidity, Remove liquidity and Close position.
   */
  onDecrease?: (tokenId: string, options: WithdrawOptions) => void;
  /** Closes a position: all its liquidity and fees out, the NFT burned, unsubscribed first when subscribed. */
  onClosePosition?: (tokenId: string, slippageBps: number) => void;
  /** Called with the block of a confirmed add to an existing position, so the list can reload. */
  onLiquidityAdded?: (blockNumber: number) => void;
};

/** The row key the pool-wide collect reports its progress and result under. */
export const POOL_COLLECT_KEY = "pool";



const BADGE = "w-fit whitespace-nowrap rounded-[40px] border px-3 py-1 text-xs font-bold xl:py-0.5";

const STATUS_BADGE: Record<PositionStatus, string> = {
  subscribed: "border-green-500/60 bg-green-800/40 text-green-300",
  notSubscribed: "border-white/30 bg-white/5 text-white",
  closed: "border-red-500/50 bg-red-700/20 text-red-300",
};

const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

const LINK_BUTTON = "w-fit rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white duration-200 hover-lift";

/**
 * Row layout. Phones: the position and its actions side by side, details full width below. From `sm`: two lines of
 * three columns, position, range and actions first, then liquidity, fees and rewards. From `xl`: one line of six
 * columns under a shared header. Liquidity, fees and rewards each take three lines: the total, larger and bold,
 * then its two parts. The single line needs about 1,150px, so it starts at `xl`. The header and each row are
 * separate grids, so every column is sized from the template alone: the actions column has a fixed width, wide
 * enough for Collect fees and the More button, rather than sizing to content the empty header cell doesn't have.
 */
const XL_COLUMNS = "xl:grid-cols-[minmax(7.75rem,0.8fr)_minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.45fr)_11.5rem]";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-x-5 sm:gap-y-2 ${XL_COLUMNS} xl:gap-x-4 xl:py-2.5`;
// From `sm` the liquidity, fees and rewards cells top-align, so their labels line up whatever each cell's height;
// from `xl` the labels move to the header and the cells centre on the row.
const CELL = {
  position: "col-start-1 row-start-1 min-w-0",
  range: "col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1",
  liquidity: "col-span-2 sm:col-span-1 sm:col-start-1 sm:row-start-2 xl:col-start-3 xl:row-start-1 sm:self-start xl:self-center",
  fees: "col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 xl:col-start-4 xl:row-start-1 sm:self-start xl:self-center",
  rewards: "col-span-2 sm:col-span-1 sm:col-start-3 sm:row-start-2 xl:col-start-5 xl:row-start-1 sm:self-start xl:self-center",
  actions: "col-start-2 row-start-1 min-w-0 self-start justify-self-end sm:col-start-3 sm:self-center xl:col-start-6",
};

/** In the `xl` table every header and every cell's content is centred on its column, so labels and values line up. */
const HEADER_CELL = "flex items-center justify-center gap-1 text-center";

/** Column labels for the `xl` layout, carrying the explanations each row otherwise repeats. */
function PositionsHeader({ fees, rewards }: { fees: boolean; rewards: boolean }) {
  return (
    <div data-testid="positions-header" className={`hidden border-b border-white/10 px-4 py-2 text-xs text-primary xl:grid xl:items-center xl:gap-x-4 ${XL_COLUMNS}`}>
      <span className={HEADER_CELL}>Position</span>
      <span className={HEADER_CELL}>
        Range
        <HelpTip text={LM_HELP} label="About the liquidity multiplier" />
      </span>
      <span className={HEADER_CELL}>Liquidity</span>
      <span className={HEADER_CELL}>{fees ? "Uncollected fees" : ""}</span>
      <span className={HEADER_CELL}>
        {rewards && (
          <>
            TELx rewards
            <HelpTip text={PENDING_TEL_HELP} label="About TELx rewards" />
          </>
        )}
      </span>
      <span />
    </div>
  );
}

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
  // A closed position is burned, so the follow-up read no longer returns it. The row it had when the close was asked
  // for stays, emptied, under Closed with its outcome until the list is reloaded.
  const closing = useRef<Record<string, Position>>({});
  const listed = new Set(props.positions.map(position => position.tokenId));
  const burned = Object.keys(results).filter(tokenId => results[tokenId].closed && !listed.has(tokenId) && closing.current[tokenId]);
  const withClosed = [...props.positions, ...burned.map(tokenId => closing.current[tokenId])].map(position =>
    results[position.tokenId]?.closed ? emptied(position) : position,
  );
  const positions = sortPositions(withConfirmedSubscriptions(withClosed, confirmed), props.assets, props.rates);
  const onClosePosition = props.onClosePosition;
  const closeRow = onClosePosition
    ? (position: Position, slippageBps: number) => {
        closing.current[position.tokenId] = position;
        onClosePosition(position.tokenId, slippageBps);
      }
    : undefined;
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
  const collectableValue = collectable.reduce<number | null>((sum, position) => {
    const usd = feesUsd(position.fees!, position, props.assets, props.rates);
    return sum === null || usd === null ? null : sum + usd;
  }, 0);
  const showCollectAll = collectable.length > 1 && feesWorthCollecting(collectableValue, props.collectEstimates?.all);
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

      {showCollectAll && props.onCollect && props.poolId && (
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
        <div className="overflow-hidden rounded-2xl bg-black/20 shadow-xl">
          <PositionsHeader fees={Boolean(props.onCollect && props.poolId)} rewards={props.rewards !== undefined} />
          <ul aria-label={`${FILTER_LABEL[filter]} positions`} className="divide-y divide-white/10">
            {visible.map(position => (
              <PositionRow key={position.tokenId} {...props} position={position} closeRow={closeRow} />
            ))}
          </ul>
        </div>
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

/** A closed position's row: no liquidity, nothing held, no subscription and no fees. */
function emptied(position: Position): Position {
  return { ...position, liquidity: "0", isSubscribed: false, fees: undefined, amounts: { ...position.amounts, amount0: "0", amount1: "0" } };
}

/**
 * Whether collecting is worth its network fee: true when the fees are worth more than the estimate, and also when
 * either figure is unknown, since the visitor can then judge. False only when the fee is known to be larger.
 */
export function feesWorthCollecting(valueUsd: number | null, estimateUsd: number | null | undefined): boolean {
  if (valueUsd === null || estimateUsd === null || estimateUsd === undefined) return true;
  return valueUsd > estimateUsd;
}

const BUTTON_BASE =
  "flex min-h-10 min-w-32 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

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
  onDecrease,
  onLiquidityAdded,
  closeRow,
}: PositionsListProps & { position: Position; closeRow?: (position: Position, slippageBps: number) => void }) {
  const { tokenId } = position;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false);
  // The open add, remove or close panel under the row.
  const [panel, setPanel] = useState<"add" | "remove" | "close" | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
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
  const isSubscribing = isPending && pending?.action === "subscribe";
  const isWithdrawing = isPending && (pending?.action === "decrease" || pending?.action === "close");
  // Open positions in a pool that can collect show their uncollected fees, and offer to collect them.
  const showFees = Boolean(onCollect && poolId) && status !== "closed" && position.fees !== undefined;
  const collectable = showFees && hasCollectableFees(position);
  const feesValue = position.fees ? feesUsd(position.fees, position, assets, rates) : null;
  const collectEstimate = collectEstimates?.perToken[tokenId];
  const worthCollecting = collectable && feesWorthCollecting(feesValue, collectEstimate);
  const action: PositionAction | null =
    status === "subscribed" || stillSubscribed ? "unsubscribe" : status === "notSubscribed" ? "subscribe" : null;
  // A subscribe the registry is certain to reject is not offered.
  const subscribeBlocked = action === "subscribe" && subscribeNeedsInRange === true && inRange === false;

  useEffect(() => {
    if (confirmingUnsubscribe) confirmRef.current?.focus();
  }, [confirmingUnsubscribe]);

  // A confirmed removal or close has done what the remove panel was open for.
  const resultKind = result?.kind;
  useEffect(() => {
    if (resultKind === "success") setPanel(current => (current === "remove" || current === "close" ? null : current));
  }, [resultKind]);

  // Notes, confirmations and transaction progress take a full-width line under the row, only while there is one.
  const hasNotes = (subscribeBlocked && !result) || confirmingUnsubscribe || isPending || result !== undefined;

  const rangeText = (stillSubscribed ? ", still subscribed" : "") + (inRange === null ? "" : inRange ? ", in range" : ", out of range");
  const amounts: [string, string] = [position.amounts.amount0, position.amounts.amount1];
  const amountsUsd = status === "closed" ? null : positionAmountsUsd(position, assets[0], assets[1], rates);
  const multiplier = status === "closed" ? null : positionMultiplier(position);
  const telSummary = pendingTelSummary(tokenId, rewards);
  // On phones the range, amounts and fees sit behind a Details toggle; from `sm` up they always show.
  const detailsClass = `${detailsOpen ? "flex" : "hidden"} min-w-0 flex-col gap-2 sm:flex`;

  const busy = pending !== null;
  const collect = () => onCollect!(tokenId, [collectTarget(position, poolId!)]);
  const manageable = Boolean(onDecrease && closeRow && chain && poolId) && status !== "closed";
  const menuItems: MoreMenuItem[] = [
    ...(showHistory ? [{ key: "history", label: historyOpen ? "Hide history" : "Show history", onSelect: () => setHistoryOpen(open => !open) }] : []),
    ...(manageable
      ? [
          { key: "add", label: "Add liquidity", onSelect: () => setPanel("add") },
          { key: "remove", label: "Remove liquidity", onSelect: () => setPanel("remove") },
          { key: "close", label: "Close position", tone: "danger" as const, onSelect: () => setPanel("close") },
        ]
      : []),
    ...(collectable && !worthCollecting ? [{ key: "collect", label: "Collect fees anyway", onSelect: () => !busy && collect() }] : []),
    ...(action === "unsubscribe" ? [{ key: "unsubscribe", label: "Unsubscribe…", tone: "danger" as const, onSelect: () => setConfirmingUnsubscribe(true) }] : []),
  ];

  return (
    <li
      aria-label={`Position ${tokenId}, ${STATUS_LABEL[status]}${rangeText}`}
      aria-busy={isPending || undefined}
      className={ROW_GRID}
    >
      <div className={`${CELL.position} flex flex-col gap-2 xl:items-center xl:gap-1.5 xl:text-center`}>
        <span className="font-mono text-sm break-all text-white">Position #{tokenId}</span>
        <div data-testid="position-summary" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white sm:hidden">
          {usd !== null && <span>{formatUsd(usd)}</span>}
          {telSummary && <span className="text-primary">{telSummary}</span>}
          {/* A closed position has no range and holds nothing, so there is nothing to expand. */}
          {status !== "closed" && (
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen(open => !open)}
              className="ml-auto min-h-10 px-1 text-xs text-primary underline decoration-white/30 underline-offset-4 hover:text-white"
            >
              {detailsOpen ? "Hide details" : "Details"}
            </button>
          )}
        </div>
        {/* On phones the range badge sits here, since the range column collapses behind Details; from `sm` it heads the range column. */}
        <div data-testid="position-badges" className="flex flex-wrap gap-2 xl:justify-center">
          <span className={`${BADGE} ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
          {stillSubscribed && <span className={`${BADGE} ${STATUS_BADGE.subscribed}`}>Still subscribed</span>}
          {inRange !== null && (
            <span data-testid="position-badge-range" className="contents sm:hidden">
              <RangeBadge inRange={inRange} />
            </span>
          )}
        </div>
      </div>

      <div id={detailsId} data-testid="position-range" className={`${CELL.range} ${detailsClass} xl:items-center`}>
        {/* Three lines: the range state, the range bar, then the liquidity multiplier. */}
        {inRange !== null && (
          <span data-testid="position-range-badge" className="hidden sm:flex">
            <RangeBadge inRange={inRange} />
          </span>
        )}
        {status !== "closed" && (
          <div className="w-full min-w-0 xl:max-w-60">
            <RangeIndicator position={position} assets={assets} />
          </div>
        )}
        {multiplier && <MultiplierFigure value={multiplier} />}
      </div>

      <div data-testid="position-amounts" className={`${CELL.liquidity} ${detailsClass} xl:items-center`}>
        <span className="text-xs text-primary xl:sr-only">Liquidity</span>
        <AssetBreakdown testId={`liquidity-${tokenId}`} amounts={amounts} values={amountsUsd ?? [null, null]} total={usd} assets={assets} />
      </div>

      {showFees && (
        <div data-testid={`position-fees-${tokenId}`} className={`${CELL.fees} ${detailsClass} xl:items-center`}>
          <span className="text-xs text-primary xl:sr-only">Uncollected fees</span>
          {position.fees === null ? (
            <span data-testid={`fees-${tokenId}`} className="text-sm text-primary">
              Unavailable
            </span>
          ) : collectable && position.fees ? (
            <AssetBreakdown
              testId={`fees-${tokenId}`}
              amounts={[position.fees.amount0, position.fees.amount1]}
              values={feeAmountsUsd(position.fees, position, assets, rates)}
              total={feesValue}
              assets={assets}
            />
          ) : (
            <span data-testid={`fees-${tokenId}`} className="text-sm text-primary">
              None yet
            </span>
          )}
          {collectable && !worthCollecting && <span className="text-xs text-primary sm:hidden">Fees too small to collect yet</span>}
        </div>
      )}

      {rewards && (
        <div data-testid={`position-rewards-${tokenId}`} className={`${CELL.rewards} ${detailsClass} xl:items-center xl:text-center`}>
          <PendingTel tokenId={tokenId} rewards={rewards} telUsd={usdRate(rates, "TEL")} />
        </div>
      )}

      <div className={`${CELL.actions} flex flex-col gap-2 sm:items-end`}>
        <div className="flex items-center gap-2 sm:justify-end">
          {action === "subscribe" && (
            <button
              type="button"
              onClick={() => {
                if (!busy) onSubscribe(tokenId);
              }}
              disabled={subscribeBlocked}
              aria-disabled={busy || undefined}
              aria-label={`${isSubscribing ? "Subscribing..." : "Subscribe"} position ${tokenId}`}
              className={`${BUTTON_BASE} flex-1 bg-blue-1000 text-white hover:bg-blue-1100 sm:flex-none`}
            >
              {isSubscribing && <_Loader size={14} theme="extra-light" />}
              {isSubscribing ? "Subscribing..." : "Subscribe"}
            </button>
          )}
          {worthCollecting && (
            <CollectButton label={`Collect fees from position ${tokenId}`} isPending={isCollecting} busy={busy} disabled={false} onClick={collect} />
          )}
          {collectable && !worthCollecting && (
            <span data-testid={`fees-too-small-${tokenId}`} className="hidden max-w-40 items-center gap-1 text-xs text-primary sm:flex xl:max-w-32">
              Fees too small to collect yet
              <HelpTip
                text={`Uncollected fees are worth about ${formatUsd(feesValue ?? 0)}, and collecting them costs about ${formatUsd(collectEstimate ?? 0)} in network fees.`}
                label="Why the fees aren't worth collecting yet"
              />
            </span>
          )}
          <PositionMoreMenu label={`More actions for position ${tokenId}`} items={menuItems} busy={busy && !isPending} />
        </div>
      </div>

      {hasNotes && (
        <div data-testid={`position-notes-${tokenId}`} className="col-span-full flex min-w-0 flex-col gap-2 sm:items-end">
        {subscribeBlocked && !result && <p className="text-xs text-primary">Only in-range positions can be subscribed.</p>}
        {confirmingUnsubscribe && (
          <div role="group" aria-label={`Confirm unsubscribing position ${tokenId}`} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-3 sm:max-w-72">
            <p className="text-xs text-white">Unsubscribe position #{tokenId}? It stops earning TELx rewards until it is subscribed again.</p>
            <div className="flex gap-2">
              <button
                ref={confirmRef}
                type="button"
                onClick={() => setConfirmingUnsubscribe(false)}
                className={`${BUTTON_BASE} min-w-0 flex-1 border border-white/15 text-white hover:bg-navy/50`}
              >
                Keep subscribed
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingUnsubscribe(false);
                  if (!busy) onUnsubscribe(tokenId);
                }}
                aria-label={`Unsubscribe position ${tokenId}`}
                className={`${BUTTON_BASE} min-w-0 flex-1 border border-red-500/60 text-red-300 hover:bg-red-700/30 hover:text-white`}
              >
                Unsubscribe
              </button>
            </div>
          </div>
        )}
        {isPending && pending?.action === "unsubscribe" && (
          <p className="flex items-center gap-2 text-xs text-primary">
            <_Loader size={12} theme="extra-light" />
            Unsubscribing...
          </p>
        )}
        <TxStatus pending={isPending ? pending : null} result={result} />
        </div>
      )}
      {manageable && panel === "add" && (
        <div className="col-span-full">
          <IncreaseLiquidityPanel
            tokenId={tokenId}
            range={{ tickLower: position.tickLower, tickUpper: position.tickUpper }}
            chain={chain!}
            poolId={poolId!}
            assets={assets}
            rates={rates}
            subscribed={status === "subscribed"}
            onConfirmed={onLiquidityAdded}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}
      {manageable && (panel === "remove" || panel === "close") && (
        <div className="col-span-full">
          <RemoveLiquidityPanel
            key={panel}
            tokenId={tokenId}
            chain={chain!}
            poolId={poolId!}
            assets={assets}
            fees={position.fees}
            subscribed={status === "subscribed"}
            earnsTelx={rewards !== undefined}
            closing={panel === "close"}
            busy={busy}
            isPending={isWithdrawing}
            onRemove={(percent, slippageBps) => onDecrease!(tokenId, { percent, slippageBps })}
            onClose={slippageBps => closeRow!(position, slippageBps)}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}
      {showHistory && historyOpen && (
        <div id={historyId} className="col-span-full">
          <PositionHistory chain={chain} tokenId={tokenId} />
        </div>
      )}
    </li>
  );
}

/** An open position's range state as a badge: "In range" in green, "Out of range" in amber. */
export function RangeBadge({ inRange }: { inRange: boolean }) {
  return inRange ? (
    <span className={`${BADGE} border-green-500/40 bg-green-500/10 text-green-300`}>In range</span>
  ) : (
    <span className={`${BADGE} border-yellow-500/60 bg-yellow-500/10 text-yellow-300`}>Out of range</span>
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

/**
 * Two amounts on three lines: their USD total, larger and bold, then each asset with its icon, its amount and its USD
 * value, for example "6,225 eUSD · $6,225.00". The total shows only when both amounts are priced, and an amount
 * without a price, or with nothing in it, shows without a USD value. Centred on its column from `xl`.
 */
function AssetBreakdown({
  testId,
  amounts,
  values,
  total,
  assets,
}: {
  testId: string;
  amounts: [string, string];
  values: [number | null, number | null];
  total: number | null;
  assets: PoolAsset[];
}) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-0.5 xl:items-center xl:text-center">
      {total !== null && <span className="text-base font-semibold text-white tabular-nums">{formatUsd(total)}</span>}
      {assets.slice(0, 2).map((asset, i) => {
        const image = getAssetImage(asset);
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5 text-sm text-white tabular-nums">
            {image && <Image src={(image as any).src ?? image} alt="" width={16} height={16} className="shrink-0" />}
            {/* Each asset's amount and USD value stay on one line, so every figure column is three lines. */}
            <span className="min-w-0 truncate">
              <span title={`${amounts[i]} ${asset.ticker ?? ""}`}>
                {formatTokenAmount(amounts[i])} {asset.ticker}
              </span>
              <UsdSuffix value={Number(amounts[i]) > 0 ? values[i] : null} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** USD value of fee amounts, or null when they can't be priced. */
function feesUsd(fees: { amount0: string; amount1: string }, position: Pick<Position, "price">, assets: PoolAsset[], rates: UsdRates | undefined): number | null {
  return positionUsdValue({ amounts: { ...fees, sqrtPriceX96: "0" }, price: position.price }, assets[0], assets[1], rates);
}

/** USD value of each fee amount, priced like `feesUsd`; null for one that can't be priced. */
function feeAmountsUsd(
  fees: { amount0: string; amount1: string },
  position: Pick<Position, "price">,
  assets: PoolAsset[],
  rates: UsdRates | undefined,
): [number | null, number | null] {
  return positionAmountsUsd({ amounts: { ...fees, sqrtPriceX96: "0" }, price: position.price }, assets[0], assets[1], rates);
}

/** The estimated network fee for collecting. */
function NetworkFeeNote({ estimateUsd }: { estimateUsd: number | null }) {
  if (estimateUsd === null) return null;
  return <p className="text-xs text-primary">Network fee about {formatUsd(estimateUsd)}</p>;
}

const COLLECT_BUTTON = `${BUTTON_BASE} flex-1 border border-accent text-white hover:bg-navy/50 sm:flex-none`;

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
        <NetworkFeeNote estimateUsd={estimateUsd} />
        <p className="text-xs text-primary">One transaction collects them all. Positions stay subscribed and keep earning TELx rewards.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 sm:items-end">
        <CollectButton label={`Collect fees from all ${positions.length} positions`} isPending={isPending} busy={pending !== null} disabled={false} onClick={onCollect} />
        <TxStatus pending={isPending ? pending : null} result={result} />
      </div>
    </div>
  );
}

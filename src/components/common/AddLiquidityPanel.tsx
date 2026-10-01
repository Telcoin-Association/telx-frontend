import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useAddLiquidity, type AddLiquidityTask, type AddLiquidityPending, type AddLiquidityResult } from "@/hooks/useAddLiquidity";
import { useLiquidityDistribution } from "@/hooks/useLiquidityDistribution";
import { POSITION_CHAIN_IDS } from "@/hooks/usePositionActions";
import { announcePositionAdded } from "@/lib/poolPageEvents";
import { usdRate, type PoolAsset } from "@/lib/positionView";
import { swapHref } from "@/lib/swapLink";
import { amountText, otherAmount, parseAmount, planDeposit, type DepositSide } from "@/lib/v4/deposit";
import { chartWindow } from "@/lib/v4/liquidityDistribution";
import { approvalSteps, isNative } from "@/lib/v4/positionManager";
import {
  customRange,
  isFullRangeTicks,
  presetRange,
  priceAtTick,
  RANGE_PRESET_LABEL,
  RANGE_PRESETS,
  rangeProblem,
  usableTickBounds,
  type RangePreset,
  type TickRange,
} from "@/lib/v4/range";
import { useGetMarketRateQuery } from "@/redux/slices/marketRateSlice";
import { CustomConnectButton } from "../layout/CustomConnectButton";
import { getAssetImage } from "../pool/PoolWeightChip";
import { FOCUS_OUTLINE_CLASS } from "../eusdVault/focusOutline";
import { formatPrice } from "./PositionHistory";
import LoadingAnimation from "./LoadingAnimationCircle";
import RangeChart from "./RangeChart";

type RangeChoice = RangePreset | "custom";

export const SLIPPAGE_CHOICES_BPS = [10, 50, 100] as const;
const DEFAULT_SLIPPAGE_BPS = 50;
/** Native ETH kept back by MAX, for the gas of the add itself. */
export const NATIVE_GAS_RESERVE = 10n ** 15n;
/** Decimals shown in an amount field. */
const SHOWN_DECIMALS = 8;

const CHIP = `cursor-pointer rounded-full border px-3 py-1.5 text-xs transition duration-200 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50`;
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";
const CARD = "rounded-xl border border-white/10 bg-black/20 p-3";
const STEPPER = `flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-black/20 text-lg leading-none text-white hover:bg-black/40 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-40`;
const MAX_BUTTON = `shrink-0 cursor-pointer rounded-lg border-[0.70px] border-tblue-700 bg-black/10 px-2 py-0.5 text-xs font-bold text-tblue-700 hover:bg-black/20 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:border-white/20 disabled:text-white/30`;
const ACTION_BUTTON = `w-full rounded-xl bg-ocean-gradient px-4 py-3 text-base font-bold text-white duration-200 hover:scale-[1.01] ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100`;

const percent = (bps: number) => `${bps / 100}%`;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function stepText(pending: AddLiquidityPending, label: string): string {
  switch (pending.step) {
    case "checking":
      return `Checking ${label.toLowerCase()} on ${pending.chainName}...`;
    case "switching":
      return `Switch your wallet to ${pending.chainName} to continue.`;
    case "signing":
      return `Confirm in your wallet: ${label.toLowerCase()} on ${pending.chainName}.`;
    case "mining":
      return `Waiting for ${pending.chainName} to confirm...`;
  }
}

const taskLabel = (task: AddLiquidityTask): string =>
  task.kind === "add" ? "Add liquidity and subscribe" : task.kind === "erc20" ? `Approve ${task.symbol}` : `Approve ${task.symbol} (Permit2)`;

function TokenLogo({ asset, size }: { asset: PoolAsset; size: number }) {
  const src = getAssetImage(asset);
  if (!src) return <span style={{ width: size, height: size }} className="inline-block shrink-0 rounded-full bg-white/20" aria-hidden="true" />;
  return <Image src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
}

function ResultLine({ result }: { result: AddLiquidityResult }) {
  const tone = result.kind === "success" ? "text-green-400" : result.kind === "error" ? "text-red-400" : "text-primary";
  return (
    <p role={result.kind === "error" ? "alert" : "status"} className={`text-sm ${tone}`}>
      {result.message}{" "}
      {result.txUrl && (
        <a href={result.txUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {result.txLinkLabel}
        </a>
      )}
    </p>
  );
}

/**
 * Adding liquidity to a TELx Uniswap v4 pool and subscribing the new position to TELx rewards in one transaction,
 * laid out like Uniswap's add-liquidity screen: the pair, the range over a chart of the pool's liquidity with
 * draggable handles and min and max price boxes, a card per token, then slippage, the preview and the steps.
 *
 * A range is full range, a preset around the current price, or a custom range at least 5% either side of it;
 * dragging a handle, stepping a price box or typing a price makes it custom. The visitor types one token's amount
 * and the other follows from the range. Each token is approved for Permit2 and the PositionManager as needed, then
 * the add is sent. A Buy link beside each balance opens the swap page set to buy that token on the pool's chain.
 * Removing liquidity stays on Uniswap.
 */
export default function AddLiquidityPanel({
  blockchain,
  poolId,
  assets,
  onConfirmed = announcePositionAdded,
}: {
  blockchain: string | undefined;
  poolId: string;
  /** currency0 and currency1, in pool order. */
  assets: [PoolAsset, PoolAsset];
  onConfirmed?: (blockNumber: number) => void;
}) {
  const { address, chain } = useAccount();
  const { pool, wallet, loadError, reload, pending, result, approve, add, chainName } = useAddLiquidity({ blockchain, poolId, onConfirmed });
  const { data: rates } = useGetMarketRateQuery();
  const symbols: [string, string] = [assets[0]?.ticker ?? "Token 0", assets[1]?.ticker ?? "Token 1"];
  const poolChainId = POSITION_CHAIN_IDS[blockchain ?? ""] ?? 137;

  const [choice, setChoice] = useState<RangeChoice>("full");
  const [custom, setCustom] = useState<TickRange | null>(null);
  const [drafts, setDrafts] = useState<{ lower?: string; upper?: string }>({});
  const [amountTexts, setAmountTexts] = useState<[string, string]>(["", ""]);
  const [lastEdited, setLastEdited] = useState<DepositSide>(0);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<TickRange | null>(null);

  const decimals: [number, number] = pool?.decimals ?? [18, 18];
  const spacing = pool?.poolKey.tickSpacing ?? 60;
  const range: TickRange | null = useMemo(() => {
    if (!pool) return null;
    return choice === "custom" ? custom : presetRange(choice, pool.tick, pool.poolKey.tickSpacing);
  }, [pool, choice, custom]);
  const fullRange = Boolean(range && isFullRangeTicks(range, spacing));
  const problem = !pool ? null : !range ? "Enter a min and a max price." : rangeProblem(range, pool.tick, spacing);
  const usableRange = range && !problem ? range : null;

  // The chart keeps its price axis while a handle is dragged, and refits it to the range once the drag ends.
  useEffect(() => {
    if (pool && range && !dragging) setView(chartWindow(range, pool.tick, spacing, fullRange));
  }, [pool, range, spacing, fullRange, dragging]);
  const segments = useLiquidityDistribution({
    chainId: poolChainId,
    poolId,
    tickSpacing: pool?.poolKey.tickSpacing,
    window: view,
    currentTick: pool?.tick,
    activeLiquidity: pool?.poolLiquidity,
  });

  const derive = (side: DepositSide, text: string, against: TickRange | null): [string, string] => {
    const amount = parseAmount(text, decimals[side]);
    const other: DepositSide = side === 0 ? 1 : 0;
    const next: [string, string] = [...amountTexts];
    next[side] = text;
    if (pool && against && amount !== null) next[other] = amountText(otherAmount(side, amount, against, pool.sqrtPriceX96), decimals[other], SHOWN_DECIMALS);
    else if (text.trim() === "") next[other] = "";
    return next;
  };

  // A new range or price changes the other token's share, so the amount typed last is kept and the other follows.
  const rangeKey = usableRange ? `${usableRange.tickLower}:${usableRange.tickUpper}:${pool?.sqrtPriceX96}` : "";
  useEffect(() => {
    if (usableRange && amountTexts[lastEdited] !== "") setAmountTexts(derive(lastEdited, amountTexts[lastEdited], usableRange));
    // Recomputed only when the range or price changes; the typed amounts update it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const onAmount = (side: DepositSide, text: string) => {
    setLastEdited(side);
    setAmountTexts(derive(side, text, usableRange));
  };

  const maxFor = (side: DepositSide): bigint | null => {
    if (!wallet || !pool) return null;
    const currency = side === 0 ? pool.poolKey.currency0 : pool.poolKey.currency1;
    const balance = wallet.balances[side] - (isNative(currency) ? NATIVE_GAS_RESERVE : 0n);
    if (balance <= 0n) return 0n;
    // Room for slippage, which raises the most the add may take.
    return (balance * 10_000n) / BigInt(10_000 + slippageBps);
  };

  const onMax = (side: DepositSide) => {
    const max = maxFor(side);
    if (max === null) return;
    onAmount(side, amountText(max, decimals[side], decimals[side]));
  };

  const setCustomRange = (next: TickRange) => {
    setChoice("custom");
    setCustom(next);
    setDrafts({});
  };

  const chooseRange = (next: RangeChoice) => {
    setDrafts({});
    if (next === "custom" && pool) setCustom(range && !fullRange ? range : presetRange("10", pool.tick, spacing));
    setChoice(next);
  };

  const priceOf = (tick: number) => priceAtTick(tick, decimals[0], decimals[1]);
  const step = (bound: "lower" | "upper", direction: 1 | -1) => {
    if (!range) return;
    const bounds = usableTickBounds(spacing);
    if (bound === "lower") setCustomRange({ ...range, tickLower: Math.max(bounds.tickLower, Math.min(range.tickLower + direction * spacing, range.tickUpper - spacing)) });
    else setCustomRange({ ...range, tickUpper: Math.min(bounds.tickUpper, Math.max(range.tickUpper + direction * spacing, range.tickLower + spacing)) });
  };
  const commitDraft = (bound: "lower" | "upper") => {
    const text = drafts[bound];
    if (text === undefined || !range) return;
    const lower = bound === "lower" ? Number(text) : priceOf(range.tickLower);
    const upper = bound === "upper" ? Number(text) : priceOf(range.tickUpper);
    const next = customRange(lower, upper, decimals[0], decimals[1], spacing);
    if (next) setCustomRange(next);
    else setDrafts({});
  };

  const parsed = [parseAmount(amountTexts[0], decimals[0]), parseAmount(amountTexts[1], decimals[1])] as const;
  const plan = pool && usableRange && parsed[0] !== null && parsed[1] !== null ? planDeposit(usableRange, pool.sqrtPriceX96, parsed[0], parsed[1], slippageBps) : null;

  const short: DepositSide[] = [];
  if (plan && wallet) {
    if (plan.amount0Max > wallet.balances[0]) short.push(0);
    if (plan.amount1Max > wallet.balances[1]) short.push(1);
  }

  const tasks: AddLiquidityTask[] = [];
  if (plan && wallet && pool) {
    const now = Math.floor(Date.now() / 1000);
    const currencies = [pool.poolKey.currency0, pool.poolKey.currency1] as const;
    const maxima = [plan.amount0Max, plan.amount1Max] as const;
    for (const side of [0, 1] as const) {
      for (const kind of approvalSteps(currencies[side], maxima[side], wallet.approvals[side], now)) {
        tasks.push({ kind, currency: currencies[side], symbol: symbols[side] });
      }
    }
  }
  tasks.push({ kind: "add" });
  const nextTask = tasks[0];

  const share = plan && pool ? Number((plan.liquidity * 1_000_000n) / (pool.poolLiquidity + plan.liquidity)) / 10_000 : null;
  const busy = pending !== null;
  const blocked = !plan || short.length > 0;
  const wrongChain = chain?.id !== undefined && chain.id !== poolChainId;

  const send = () => {
    if (!plan || !usableRange) return;
    if (nextTask.kind === "add") void add({ ...usableRange, liquidity: plan.liquidity, amount0Max: plan.amount0Max, amount1Max: plan.amount1Max });
    else void approve(nextTask);
  };

  const priceUnit = `${symbols[1]} per ${symbols[0]}`;
  const usdValue = (side: DepositSide): string | null => {
    const amount = parsed[side];
    const rate = usdRate(rates, symbols[side]);
    if (amount === null || amount === 0n || rate === undefined) return null;
    return usd.format(Number(amountText(amount, decimals[side], SHOWN_DECIMALS)) * rate);
  };

  const priceBox = (bound: "lower" | "upper") => {
    const label = bound === "lower" ? "Min price" : "Max price";
    const shown = fullRange ? (bound === "lower" ? "0" : "∞") : range ? String(Number(priceOf(bound === "lower" ? range.tickLower : range.tickUpper).toPrecision(6))) : "";
    const inputId = `add-liquidity-${bound}-price`;
    return (
      <div className={`${CARD} flex flex-col items-center gap-1 text-center`}>
        <label htmlFor={inputId} className="text-xs text-primary">
          {label}
        </label>
        <div className="flex w-full items-center gap-2">
          <button type="button" aria-label={`Lower the ${label.toLowerCase()}`} disabled={busy || fullRange || !range} onClick={() => step(bound, -1)} className={STEPPER}>
            -
          </button>
          <input
            id={inputId}
            inputMode="decimal"
            value={drafts[bound] ?? shown}
            disabled={busy || fullRange || !range}
            onChange={(e) => setDrafts((d) => ({ ...d, [bound]: e.target.value }))}
            onBlur={() => commitDraft(bound)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft(bound);
            }}
            className={`min-w-0 flex-1 bg-transparent text-center text-xl font-bold text-white ${FOCUS_OUTLINE_CLASS} disabled:text-white/80`}
          />
          <button type="button" aria-label={`Raise the ${label.toLowerCase()}`} disabled={busy || fullRange || !range} onClick={() => step(bound, 1)} className={STEPPER}>
            +
          </button>
        </div>
        <p className="text-xs text-primary">{priceUnit}</p>
      </div>
    );
  };

  return (
    <section aria-labelledby="add-liquidity-title" className="flex flex-col gap-4 text-white">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex -space-x-2" aria-hidden="true">
          <TokenLogo asset={assets[0]} size={32} />
          <TokenLogo asset={assets[1]} size={32} />
        </div>
        <div className="flex flex-col">
          <h3 id="add-liquidity-title" className="text-lg font-bold">
            Add liquidity: {symbols[0]} / {symbols[1]}
          </h3>
          <p className="text-xs text-primary">
            {pool ? `${pool.poolKey.fee / 10_000}% fee tier on ${chainName}` : chainName}
          </p>
        </div>
        <span className="ml-auto rounded-full border border-green-500/60 bg-green-800/40 px-3 py-1 text-xs font-bold text-green-300">Earns TELx rewards</span>
      </header>
      <p className="text-sm text-primary">Creates the position and subscribes it to TELx rewards in the same transaction. Removing liquidity is done on Uniswap.</p>

      {loadError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-status-error">
            The pool could not be read from {chainName}.
          </p>
          <button type="button" onClick={() => void reload()} className={`${CHIP} ${CHIP_IDLE} w-fit`}>
            Read the pool again
          </button>
        </div>
      ) : !pool ? (
        <div className="flex items-center gap-2 text-sm text-primary">
          Reading the pool... <LoadingAnimation size={20} />
        </div>
      ) : (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">Set price range</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {[...RANGE_PRESETS, "custom" as const].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={choice === option}
                  disabled={busy}
                  onClick={() => chooseRange(option)}
                  className={`${CHIP} ${choice === option ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  {option === "custom" ? "Custom" : RANGE_PRESET_LABEL[option]}
                </button>
              ))}
            </div>
            {view && (
              <RangeChart
                segments={segments}
                window={view}
                currentTick={pool.tick}
                range={range}
                fullRange={fullRange}
                tickSpacing={spacing}
                decimals={decimals}
                priceUnit={priceUnit}
                onChange={setCustomRange}
                onDragging={setDragging}
              />
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {priceBox("lower")}
              {priceBox("upper")}
            </div>
            <p className="text-sm text-primary">
              Current price: <span className="text-white">{formatPrice(priceOf(pool.tick))}</span> {priceUnit}
            </p>
            {problem && (
              <p role="alert" className="text-sm text-status-error">
                {problem}
              </p>
            )}
          </fieldset>

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-bold">Deposit amounts</h4>
            {([0, 1] as const).map((side) => (
              <div key={side} className={`${CARD} flex flex-col gap-2 ${short.includes(side) ? "border-red-400/60" : ""}`}>
                <div className="flex items-center gap-3">
                  <input
                    id={`add-liquidity-amount-${side}`}
                    aria-label={symbols[side]}
                    inputMode="decimal"
                    placeholder="0"
                    value={amountTexts[side]}
                    disabled={busy || !usableRange}
                    aria-invalid={short.includes(side)}
                    onChange={(e) => onAmount(side, e.target.value)}
                    className={`min-w-0 flex-1 bg-transparent text-2xl text-white placeholder:text-white/30 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:text-white/40`}
                  />
                  <span className="flex shrink-0 items-center gap-2 rounded-full bg-black/30 py-1 pr-3 pl-1 text-sm font-bold">
                    <TokenLogo asset={assets[side]} size={24} />
                    {symbols[side]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-primary">{usdValue(side) ?? " "}</span>
                  <div className="flex items-center gap-3">
                    <span className={short.includes(side) ? "text-status-error" : "text-primary"}>
                      Balance: {wallet ? amountText(wallet.balances[side], decimals[side], 6) : address ? "..." : "-"}
                      {short.includes(side) && ` - not enough ${symbols[side]}`}
                    </span>
                    <button type="button" onClick={() => onMax(side)} disabled={busy || !usableRange || !wallet} className={MAX_BUTTON}>
                      MAX
                    </button>
                    <Link
                      href={swapHref({ chain: blockchain, buy: side === 0 ? pool.poolKey.currency0 : pool.poolKey.currency1 })}
                      className={`rounded font-bold text-tblue-700 underline-offset-2 hover:underline ${FOCUS_OUTLINE_CLASS}`}
                    >
                      Buy {symbols[side]}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-sm font-bold">Slippage</legend>
            {SLIPPAGE_CHOICES_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                aria-pressed={slippageBps === bps}
                disabled={busy}
                onClick={() => setSlippageBps(bps)}
                className={`${CHIP} ${slippageBps === bps ? CHIP_ACTIVE : CHIP_IDLE}`}
              >
                {percent(bps)}
              </button>
            ))}
          </fieldset>

          {plan && (
            <dl aria-label="Preview" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-black/20 p-3 text-sm">
              <dt className="text-primary">Deposit</dt>
              <dd className="text-right">
                {amountText(plan.amount0, decimals[0], 6)} {symbols[0]} and {amountText(plan.amount1, decimals[1], 6)} {symbols[1]}
              </dd>
              <dt className="text-primary">At most, with {percent(slippageBps)} slippage</dt>
              <dd className="text-right">
                {amountText(plan.amount0Max, decimals[0], 6)} {symbols[0]} and {amountText(plan.amount1Max, decimals[1], 6)} {symbols[1]}
              </dd>
              <dt className="text-primary">Share of active liquidity</dt>
              <dd className="text-right">{share !== null && share < 0.01 ? "<0.01%" : `${share}%`}</dd>
              <dt className="text-primary">TELx rewards</dt>
              <dd className="text-right">Subscribed on creation</dd>
            </dl>
          )}

          {!address ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-primary">Connect a wallet to add liquidity.</p>
              <CustomConnectButton />
            </div>
          ) : (
            <>
              {wrongChain && !busy && <p className="text-sm text-primary">Your wallet will be asked to switch to {chainName} first.</p>}

              {tasks.length > 1 && plan && (
                <ol aria-label="Steps" className="flex flex-col gap-1 text-sm text-primary">
                  {tasks.map((task, i) => (
                    <li key={`${task.kind}-${i}`} className={i === 0 ? "font-bold text-white" : undefined}>
                      {i + 1}. {taskLabel(task)}
                    </li>
                  ))}
                </ol>
              )}

              <button type="button" onClick={send} disabled={busy || blocked} className={ACTION_BUTTON}>
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    {taskLabel(pending.task)} <LoadingAnimation size={18} />
                  </span>
                ) : (
                  taskLabel(nextTask)
                )}
              </button>
            </>
          )}

          {pending && (
            <p role="status" className="text-sm text-primary">
              {stepText(pending, taskLabel(pending.task))}{" "}
              {pending.txUrl && (
                <a href={pending.txUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {pending.txLinkLabel}
                </a>
              )}
            </p>
          )}
          {!pending && result && <ResultLine result={result} />}
        </>
      )}
    </section>
  );
}

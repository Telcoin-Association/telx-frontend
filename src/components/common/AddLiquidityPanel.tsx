import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useAddLiquidity, type AddLiquidityTask, type AddLiquidityPending, type AddLiquidityResult } from "@/hooks/useAddLiquidity";
import { POSITION_CHAIN_IDS } from "@/hooks/usePositionActions";
import { amountText, otherAmount, parseAmount, planDeposit, type DepositSide } from "@/lib/v4/deposit";
import { approvalSteps, isNative } from "@/lib/v4/positionManager";
import {
  customRange,
  isFullRangeTicks,
  presetRange,
  priceAtTick,
  RANGE_PRESET_LABEL,
  RANGE_PRESETS,
  rangeProblem,
  type RangePreset,
  type TickRange,
} from "@/lib/v4/range";
import { swapHref } from "@/lib/swapLink";
import { formatPrice } from "./PositionHistory";
import { FOCUS_OUTLINE_CLASS } from "../eusdVault/focusOutline";
import LoadingAnimation from "./LoadingAnimationCircle";

type RangeChoice = RangePreset | "custom";

export const SLIPPAGE_CHOICES_BPS = [10, 50, 100] as const;
const DEFAULT_SLIPPAGE_BPS = 50;
/** Native ETH kept back by MAX, for the gas of the add itself. */
export const NATIVE_GAS_RESERVE = 10n ** 15n;
/** Decimals shown in an amount field. */
const SHOWN_DECIMALS = 8;

const CHIP = `cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200 ${FOCUS_OUTLINE_CLASS}`;
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";
const FIELD = `min-w-0 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right text-lg text-white placeholder:text-white/30 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:text-white/40`;
const MAX_BUTTON = `shrink-0 cursor-pointer rounded-lg border-[0.70px] border-tblue-700 bg-black/10 px-2 py-1 text-xs font-bold text-tblue-700 hover:bg-black/20 ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:border-white/20 disabled:text-white/30`;
const ACTION_BUTTON = `w-full rounded-lg bg-ocean-gradient px-4 py-3 text-sm font-bold text-white duration-200 hover-lift ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50`;

const percent = (bps: number) => `${bps / 100}%`;

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
 * Adding liquidity to a TELx Uniswap v4 pool and subscribing the new position to TELx rewards in one transaction.
 * The visitor picks a range (full range, a preset around the current price, or two prices at least 5% either side
 * of it), types one token's amount and gets the other from the range, then approves each token for Permit2 and the
 * PositionManager as needed and sends the add. A Buy link beside each balance opens the swap page set to buy that
 * token on the pool's chain. Removing liquidity stays on Uniswap.
 */
export default function AddLiquidityPanel({
  blockchain,
  poolId,
  symbols,
  onConfirmed,
}: {
  blockchain: string | undefined;
  poolId: string;
  /** Ticker of currency0 and currency1, in pool order. */
  symbols: [string, string];
  onConfirmed?: (blockNumber: number) => void;
}) {
  const { chain } = useAccount();
  const { pool, wallet, loadError, reload, pending, result, approve, add, chainName } = useAddLiquidity({ blockchain, poolId, onConfirmed });

  const [choice, setChoice] = useState<RangeChoice>("full");
  const [lowerText, setLowerText] = useState("");
  const [upperText, setUpperText] = useState("");
  const [amountTexts, setAmountTexts] = useState<[string, string]>(["", ""]);
  const [lastEdited, setLastEdited] = useState<DepositSide>(0);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const decimals = pool?.decimals ?? [18, 18];
  const range: TickRange | null = useMemo(() => {
    if (!pool) return null;
    if (choice !== "custom") return presetRange(choice, pool.tick, pool.poolKey.tickSpacing);
    return customRange(Number(lowerText), Number(upperText), pool.decimals[0], pool.decimals[1], pool.poolKey.tickSpacing);
  }, [pool, choice, lowerText, upperText]);
  const problem = !pool ? null : !range ? "Enter a lower and an upper price." : rangeProblem(range, pool.tick, pool.poolKey.tickSpacing);
  const usableRange = range && !problem ? range : null;

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
  const wrongChain = chain?.id !== undefined && chain.id !== POSITION_CHAIN_IDS[blockchain ?? ""];

  const send = () => {
    if (!plan || !usableRange) return;
    if (nextTask.kind === "add") void add({ ...usableRange, liquidity: plan.liquidity, amount0Max: plan.amount0Max, amount1Max: plan.amount1Max });
    else void approve(nextTask);
  };

  const chooseRange = (next: RangeChoice) => {
    if (next === "custom" && pool && lowerText === "" && upperText === "") {
      const around = presetRange("10", pool.tick, pool.poolKey.tickSpacing);
      setLowerText(String(Number(priceAtTick(around.tickLower, decimals[0], decimals[1]).toPrecision(6))));
      setUpperText(String(Number(priceAtTick(around.tickUpper, decimals[0], decimals[1]).toPrecision(6))));
    }
    setChoice(next);
  };

  const priceUnit = `${symbols[1]} per ${symbols[0]}`;

  return (
    <section aria-labelledby="add-liquidity-title" className="mb-4 flex flex-col gap-4 rounded-2xl bg-black/20 p-4 text-white">
      <div>
        <h3 id="add-liquidity-title" className="text-lg font-bold">
          Add liquidity and earn TELx rewards
        </h3>
        <p className="text-sm text-primary">
          Creates a position on {chainName} and subscribes it to TELx rewards in the same transaction. Removing liquidity is done on Uniswap.
        </p>
      </div>

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
          <p className="text-sm text-primary">
            Current price: <span className="text-white">{formatPrice(priceAtTick(pool.tick, decimals[0], decimals[1]))}</span> {priceUnit}
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-bold">Price range</legend>
            <div className="flex flex-wrap gap-2">
              {[...RANGE_PRESETS, "custom" as const].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={choice === option}
                  onClick={() => chooseRange(option)}
                  className={`${CHIP} ${choice === option ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  {option === "custom" ? "Custom" : RANGE_PRESET_LABEL[option]}
                </button>
              ))}
            </div>
            {choice === "custom" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-primary">
                  Min price ({priceUnit})
                  <input inputMode="decimal" value={lowerText} onChange={(e) => setLowerText(e.target.value)} className={FIELD} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-primary">
                  Max price ({priceUnit})
                  <input inputMode="decimal" value={upperText} onChange={(e) => setUpperText(e.target.value)} className={FIELD} />
                </label>
              </div>
            )}
            {problem ? (
              <p role="alert" className="text-sm text-status-error">
                {problem}
              </p>
            ) : (
              range && (
                <p className="text-sm text-primary">
                  {isFullRangeTicks(range, pool.poolKey.tickSpacing)
                    ? "Full range: every price."
                    : `${formatPrice(priceAtTick(range.tickLower, decimals[0], decimals[1]))} to ${formatPrice(priceAtTick(range.tickUpper, decimals[0], decimals[1]))} ${priceUnit}`}
                </p>
              )
            )}
          </fieldset>

          <div className="flex flex-col gap-3">
            {([0, 1] as const).map((side) => (
              <div key={side} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={`add-liquidity-amount-${side}`} className="w-16 shrink-0 text-sm font-bold">
                    {symbols[side]}
                  </label>
                  <input
                    id={`add-liquidity-amount-${side}`}
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amountTexts[side]}
                    disabled={busy || !usableRange}
                    aria-invalid={short.includes(side)}
                    onChange={(e) => onAmount(side, e.target.value)}
                    className={FIELD}
                  />
                  <button type="button" onClick={() => onMax(side)} disabled={busy || !usableRange || !wallet} className={MAX_BUTTON}>
                    MAX
                  </button>
                </div>
                <div className="flex items-center justify-end gap-3 text-xs">
                  <p className={short.includes(side) ? "text-status-error" : "text-primary"}>
                    Balance: {wallet ? amountText(wallet.balances[side], decimals[side], 6) : "..."} {symbols[side]}
                    {short.includes(side) && ` - not enough ${symbols[side]}`}
                  </p>
                  <Link
                    href={swapHref({ chain: blockchain, buy: side === 0 ? pool.poolKey.currency0 : pool.poolKey.currency1 })}
                    className={`rounded font-bold text-tblue-700 underline-offset-2 hover:underline ${FOCUS_OUTLINE_CLASS}`}
                  >
                    Buy {symbols[side]}
                  </Link>
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

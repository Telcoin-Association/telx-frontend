import React, { useState } from "react";
import { useAccount } from "wagmi";
import { useAddLiquidity, type AddLiquidityTask } from "@/hooks/useAddLiquidity";
import { POSITION_CHAIN_IDS } from "@/hooks/usePositionActions";
import { usdRate, type PoolAsset, type UsdRates } from "@/lib/positionView";
import { amountText, capToBalances, otherAmount, parseAmount, planDeposit, type DepositSide } from "@/lib/v4/deposit";
import { getSqrtPriceAtTick } from "@/lib/v4/liquidityMath";
import { isNative, needsErc20Approval, permitDetails } from "@/lib/v4/positionManager";
import type { TickRange } from "@/lib/v4/range";
import LoadingAnimation from "./LoadingAnimationCircle";
import {
  ACTION_BUTTON,
  CARD,
  CHIP,
  CHIP_ACTIVE,
  CHIP_IDLE,
  DEFAULT_SLIPPAGE_BPS,
  MAX_BUTTON,
  NATIVE_GAS_RESERVE,
  percent,
  ResultLine,
  SHOWN_DECIMALS,
  SLIPPAGE_CHOICES_BPS,
  stepText,
  taskLabel,
  TokenLogo,
} from "./AddLiquidityPanel";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Which tokens a deposit into `range` takes at `sqrtPriceX96`: token0 below the range's top, token1 above its bottom. */
export function depositSides(range: TickRange, sqrtPriceX96: bigint): [boolean, boolean] {
  return [sqrtPriceX96 < getSqrtPriceAtTick(range.tickUpper), sqrtPriceX96 > getSqrtPriceAtTick(range.tickLower)];
}

/**
 * Adding liquidity to an existing position, on its own token id and range, laid out like the Add Liquidity panel: a
 * card per token where the visitor types one amount and the other follows from the range, slippage, the preview with
 * what the add takes at most, then the steps. A position out of range takes only one token, so the other card is
 * off. One click runs every step (see useAddLiquidity): first-time approvals, one signed allowance, then the add.
 * The position keeps its TELx subscription.
 */
export default function IncreaseLiquidityPanel({
  tokenId,
  range,
  chain,
  poolId,
  assets,
  rates,
  subscribed,
  onConfirmed,
  onCancel,
}: {
  tokenId: string;
  range: TickRange;
  chain: string;
  poolId: string;
  /** currency0 and currency1, in pool order. */
  assets: PoolAsset[];
  rates?: UsdRates;
  subscribed: boolean;
  onConfirmed?: (blockNumber: number) => void;
  onCancel: () => void;
}) {
  const { address, chain: walletChain } = useAccount();
  const { pool, wallet, loadError, reload, pending, result, add, chainName } = useAddLiquidity({ blockchain: chain, poolId, onConfirmed });
  const symbols: [string, string] = [assets[0]?.ticker ?? "Token 0", assets[1]?.ticker ?? "Token 1"];
  const decimals: [number, number] = pool?.decimals ?? [18, 18];
  const [amountTexts, setAmountTexts] = useState<[string, string]>(["", ""]);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const sides = pool ? depositSides(range, pool.sqrtPriceX96) : [false, false];
  const busy = pending !== null;

  const onAmount = (side: DepositSide, text: string) => {
    const other: DepositSide = side === 0 ? 1 : 0;
    const amount = parseAmount(text, decimals[side]);
    const next: [string, string] = [...amountTexts];
    next[side] = text;
    if (pool && amount !== null) next[other] = amountText(otherAmount(side, amount, range, pool.sqrtPriceX96), decimals[other], SHOWN_DECIMALS);
    else if (text.trim() === "") next[other] = "";
    setAmountTexts(next);
  };

  const spendable = (side: DepositSide): bigint | null => {
    if (!wallet || !pool) return null;
    const currency = side === 0 ? pool.poolKey.currency0 : pool.poolKey.currency1;
    const balance = wallet.balances[side] - (isNative(currency) ? NATIVE_GAS_RESERVE : 0n);
    return balance > 0n ? balance : 0n;
  };
  const onMax = (side: DepositSide) => {
    const balance = spendable(side);
    if (balance === null) return;
    onAmount(side, amountText((balance * 10_000n) / BigInt(10_000 + slippageBps), decimals[side], decimals[side]));
  };

  const parsed = [parseAmount(amountTexts[0] || "0", decimals[0]), parseAmount(amountTexts[1] || "0", decimals[1])] as const;
  const plan = pool && parsed[0] !== null && parsed[1] !== null ? planDeposit(range, pool.sqrtPriceX96, parsed[0], parsed[1], slippageBps) : null;
  const spendable0 = spendable(0);
  const spendable1 = spendable(1);
  const limits = plan && spendable0 !== null && spendable1 !== null ? capToBalances(plan, [spendable0, spendable1], slippageBps) : null;
  const short: DepositSide[] = limits?.short ?? [];

  const tasks: AddLiquidityTask[] = [];
  if (limits && wallet && pool) {
    const now = Math.floor(Date.now() / 1000);
    const currencies = [pool.poolKey.currency0, pool.poolKey.currency1] as const;
    const maxima = [limits.amount0Max, limits.amount1Max] as const;
    for (const side of [0, 1] as const) {
      if (needsErc20Approval(currencies[side], maxima[side], wallet.approvals[side]))
        tasks.push({ kind: "erc20", currency: currencies[side], symbol: symbols[side] });
    }
    if (([0, 1] as const).some(side => permitDetails(currencies[side], maxima[side], wallet.approvals[side], now))) tasks.push({ kind: "permit" });
  }
  tasks.push({ kind: "add" });
  const currentStep = pending
    ? tasks.findIndex(
        task =>
          task.kind === pending.task.kind && (task.kind !== "erc20" || (pending.task.kind === "erc20" && task.currency === pending.task.currency)),
      )
    : -1;
  const blocked = !plan || !limits || short.length > 0;
  const wrongChain = walletChain?.id !== undefined && walletChain.id !== (POSITION_CHAIN_IDS[chain] ?? 137);

  const send = () => {
    if (!plan || !limits) return;
    void add({
      ...range,
      liquidity: plan.liquidity,
      amount0Max: limits.amount0Max,
      amount1Max: limits.amount1Max,
      symbols,
      tokenId: BigInt(tokenId),
    });
  };

  const usdValue = (side: DepositSide): string | null => {
    const amount = parsed[side];
    const rate = usdRate(rates, symbols[side]);
    if (amount === null || amount === 0n || rate === undefined) return null;
    return usd.format(Number(amountText(amount, decimals[side], SHOWN_DECIMALS)) * rate);
  };

  return (
    <section aria-labelledby={`increase-${tokenId}`} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`increase-${tokenId}`} className="text-base font-bold">
          Add liquidity to position #{tokenId}
        </h4>
        <button type="button" onClick={onCancel} disabled={busy} className={`${CHIP} ${CHIP_IDLE}`}>
          Cancel
        </button>
      </div>
      <p className="text-sm text-primary">
        Adds to this position on its current range{subscribed ? ", and it stays subscribed to TELx rewards" : ""}. Any uncollected fees are collected
        in the same transaction.
      </p>

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
          {!(sides[0] && sides[1]) && (
            <p className="text-sm text-primary">
              This position is out of range, so it takes only {sides[0] ? symbols[0] : symbols[1]} until the price returns to its range.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {([0, 1] as const).map(side => (
              <div key={side} className={`${CARD} flex flex-col gap-2 ${short.includes(side) ? "border-red-400/60" : ""}`}>
                <div className="flex items-center gap-3">
                  <input
                    aria-label={symbols[side]}
                    inputMode="decimal"
                    placeholder="0"
                    value={amountTexts[side]}
                    disabled={busy || !sides[side]}
                    aria-invalid={short.includes(side)}
                    onChange={e => onAmount(side, e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-2xl text-white placeholder:text-white/30 disabled:cursor-not-allowed disabled:text-white/40"
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
                    <button type="button" onClick={() => onMax(side)} disabled={busy || !wallet || !sides[side]} className={MAX_BUTTON}>
                      MAX
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-sm font-bold">Slippage</legend>
            {SLIPPAGE_CHOICES_BPS.map(bps => (
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
                {amountText((limits ?? plan).amount0Max, decimals[0], 6)} {symbols[0]} and {amountText((limits ?? plan).amount1Max, decimals[1], 6)}{" "}
                {symbols[1]}
              </dd>
              <dt className="text-primary">TELx rewards</dt>
              <dd className="text-right">{subscribed ? "Stays subscribed" : "Not subscribed"}</dd>
            </dl>
          )}

          {wrongChain && !busy && <p className="text-sm text-primary">Your wallet will be asked to switch to {chainName} first.</p>}
          {tasks.length > 1 && plan && (
            <ol aria-label="Steps, all from one click" className="flex flex-col gap-1 text-sm text-primary">
              {tasks.map((task, i) => (
                <li
                  key={`${task.kind}-${i}`}
                  aria-current={i === currentStep ? "step" : undefined}
                  className={i === currentStep ? "font-bold text-white" : i < currentStep ? "text-primary/60 line-through" : undefined}
                >
                  {i + 1}. {taskLabel(task, true)}
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={send} disabled={busy || blocked || !address} className={ACTION_BUTTON}>
            {pending ? (
              <span className="flex items-center justify-center gap-2">
                {taskLabel(pending.task, true)} <LoadingAnimation size={18} />
              </span>
            ) : (
              "Add liquidity"
            )}
          </button>
          {pending && (
            <p role="status" className="text-sm text-primary">
              {stepText(pending, taskLabel(pending.task, true))}{" "}
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

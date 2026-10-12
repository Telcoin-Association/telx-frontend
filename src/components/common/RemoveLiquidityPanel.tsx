import React, { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { POSITION_CHAIN_IDS } from "@/hooks/usePositionActions";
import { getUniswapChainAddresses } from "@/lib/contracts";
import { formatTokenAmount, type PoolAsset } from "@/lib/positionView";
import { amountText } from "@/lib/v4/deposit";
import { planWithdraw, readPositionState, WITHDRAW_PERCENTS, type PositionState } from "@/lib/v4/withdraw";
import LoadingAnimation from "./LoadingAnimationCircle";
import { ACTION_BUTTON, CHIP, CHIP_ACTIVE, CHIP_IDLE, DEFAULT_SLIPPAGE_BPS, percent, SLIPPAGE_CHOICES_BPS } from "./AddLiquidityPanel";

/** What closing a position does, and what happens to its TELx subscription and the rewards it has earned. */
export function closeExplanation({ subscribed, earnsTelx }: { subscribed: boolean; earnsTelx: boolean }): string[] {
  const lines = ["Closing withdraws all of the position's liquidity, collects its uncollected fees and burns the position NFT, in one transaction."];
  if (subscribed)
    lines.push("The position is unsubscribed from TELx rewards first, in the same transaction, so the close never depends on the rewards contract.");
  if (earnsTelx) {
    lines.push(
      "TELx rewards the position has already earned are not lost: they stay with your wallet and remain claimable from the Portfolio page. Rewards earned since Merkl's last update are added at its next update, within a few hours.",
    );
  }
  return lines;
}

const ACTION_DANGER = `${ACTION_BUTTON.replace("bg-ocean-gradient", "bg-red-600/80")}`;

/**
 * Removing part or all of a position's liquidity: a percentage slider with 25%, 50%, 75% and Max, slippage, and a
 * preview of what the removal pays out now and at least, read from the chain when the panel opens. A removal also
 * collects the position's uncollected fees. At Max the removal becomes a close, which also burns the position (see
 * closeExplanation). The transaction's progress and outcome show on the position's row.
 */
export default function RemoveLiquidityPanel({
  tokenId,
  chain,
  poolId,
  assets,
  fees,
  subscribed,
  earnsTelx,
  initialPercent = 50,
  busy,
  isPending,
  onRemove,
  onClose,
  onCancel,
}: {
  tokenId: string;
  chain: string;
  poolId: string;
  /** currency0 and currency1, in pool order. */
  assets: PoolAsset[];
  fees?: { amount0: string; amount1: string } | null;
  subscribed: boolean;
  /** The pool pays TELx rewards through Merkl, so the close explains what happens to them. */
  earnsTelx: boolean;
  initialPercent?: number;
  busy: boolean;
  isPending: boolean;
  onRemove: (percent: number, slippageBps: number) => void;
  onClose: (slippageBps: number) => void;
  onCancel: () => void;
}) {
  const chainId = POSITION_CHAIN_IDS[chain] ?? 137;
  const publicClient = usePublicClient({ chainId });
  const positionManager = getUniswapChainAddresses(chain, poolId).positionManager as `0x${string}`;
  const [state, setState] = useState<PositionState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [pct, setPct] = useState(initialPercent);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const symbols = [assets[0]?.ticker ?? "Token 0", assets[1]?.ticker ?? "Token 1"];

  useEffect(() => {
    if (!publicClient) return;
    let live = true;
    readPositionState(publicClient, { chainId, positionManager, poolId: poolId as `0x${string}`, tokenId: BigInt(tokenId) }).then(
      next => live && setState(next),
      err => {
        console.error("Reading the position failed", err);
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [publicClient, chainId, positionManager, poolId, tokenId]);

  const closes = pct >= 100;
  const plan = state ? planWithdraw(state.range, state.sqrtPriceX96, state.liquidity, pct, slippageBps) : null;
  const both = (a0: bigint, a1: bigint) =>
    `${amountText(a0, state!.decimals[0], 6)} ${symbols[0]} and ${amountText(a1, state!.decimals[1], 6)} ${symbols[1]}`;
  const feeText =
    fees && (Number(fees.amount0) > 0 || Number(fees.amount1) > 0)
      ? `${formatTokenAmount(fees.amount0)} ${symbols[0]} and ${formatTokenAmount(fees.amount1)} ${symbols[1]}`
      : null;
  const sliderId = `remove-${tokenId}-percent`;

  return (
    <section aria-labelledby={`remove-${tokenId}`} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`remove-${tokenId}`} className="text-base font-bold">
          {closes ? `Close position #${tokenId}` : `Remove liquidity from position #${tokenId}`}
        </h4>
        <button type="button" onClick={onCancel} disabled={isPending} className={`${CHIP} ${CHIP_IDLE}`}>
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={sliderId} className="flex items-baseline justify-between text-sm">
          <span className="font-bold">Amount to remove</span>
          <span className="text-2xl font-bold">{pct}%</span>
        </label>
        <input
          id={sliderId}
          type="range"
          min={1}
          max={100}
          step={1}
          value={pct}
          disabled={busy}
          onChange={e => setPct(Number(e.target.value))}
          className="w-full accent-[#5533ff]"
        />
        <div className="flex flex-wrap gap-2">
          {WITHDRAW_PERCENTS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={pct === option}
              disabled={busy}
              onClick={() => setPct(option)}
              className={`${CHIP} ${pct === option ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {option === 100 ? "Max" : `${option}%`}
            </button>
          ))}
        </div>
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

      {readFailed ? (
        <p role="alert" className="text-sm text-status-error">
          The position could not be read, so there is no preview. The amounts are read again before anything is sent.
        </p>
      ) : !state ? (
        <div className="flex items-center gap-2 text-sm text-primary">
          Reading the position... <LoadingAnimation size={20} />
        </div>
      ) : (
        <dl aria-label="Preview" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-black/20 p-3 text-sm">
          <dt className="text-primary">You receive</dt>
          <dd className="text-right">{plan ? both(plan.amount0, plan.amount1) : "Nothing"}</dd>
          <dt className="text-primary">At least, with {percent(slippageBps)} slippage</dt>
          <dd className="text-right">{plan ? both(plan.amount0Min, plan.amount1Min) : "Nothing"}</dd>
          {feeText && (
            <>
              <dt className="text-primary">Uncollected fees, also collected</dt>
              <dd className="text-right">{feeText}</dd>
            </>
          )}
          <dt className="text-primary">TELx rewards</dt>
          <dd className="text-right">
            {closes ? (subscribed ? "Unsubscribed, then closed" : "Not subscribed") : subscribed ? "Stays subscribed" : "Not subscribed"}
          </dd>
        </dl>
      )}

      {closes && (
        <div
          data-testid={`close-explanation-${tokenId}`}
          className="flex flex-col gap-1 rounded-lg border border-status-inProgress/40 bg-status-inProgress/10 px-3 py-2 text-sm text-white"
        >
          {closeExplanation({ subscribed, earnsTelx }).map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {closes ? (
        <button type="button" onClick={() => !busy && onClose(slippageBps)} aria-disabled={busy || undefined} className={ACTION_DANGER}>
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              Closing position <LoadingAnimation size={18} />
            </span>
          ) : (
            "Close position"
          )}
        </button>
      ) : (
        <button type="button" onClick={() => !busy && onRemove(pct, slippageBps)} aria-disabled={busy || undefined} className={ACTION_BUTTON}>
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              Removing liquidity <LoadingAnimation size={18} />
            </span>
          ) : (
            `Remove ${pct}%`
          )}
        </button>
      )}
    </section>
  );
}

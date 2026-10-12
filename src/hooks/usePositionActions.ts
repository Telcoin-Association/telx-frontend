import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { toast } from "react-toastify";
import { getUniswapChainAddresses, isMerklUniswapPool } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import { ClaimInProgressError, runExclusive } from "@/lib/claims/claimQueue";
import { COLLECT_DEADLINE_SECONDS, describeCollect, readCollect, type CollectPlan, type CollectTarget } from "@/lib/v4/collect";
import { closePositionCall, decreaseLiquidityArgs, positionManagerAbi as liquidityAbi } from "@/lib/v4/positionManager";
import { closeFlow, planWithdraw, readPositionState, type PositionState } from "@/lib/v4/withdraw";
import type { PendingPositionTx, PositionAction, PositionTxResult } from "@/components/common/PositionsList";

// PositionManager's subscribe and unsubscribe, with the errors they can revert with, so a simulated or
// replayed revert decodes to a name the row can explain.
export const positionManagerAbi = [
  {
    type: "function",
    name: "subscribe",
    inputs: [
      { type: "uint256", name: "tokenId" },
      { type: "address", name: "newSubscriber" },
      { type: "bytes", name: "data" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "unsubscribe",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "error",
    name: "AlreadySubscribed",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "subscriber", type: "address" },
    ],
  },
  { type: "error", name: "NotApproved", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "NotSubscribed", inputs: [] },
  { type: "error", name: "NoCodeSubscriber", inputs: [] },
  { type: "error", name: "GasLimitTooLow", inputs: [] },
  {
    type: "error",
    name: "SubscriptionReverted",
    inputs: [
      { name: "subscriber", type: "address" },
      { name: "reason", type: "bytes" },
    ],
  },
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

// The Merkl subscriber rejects a subscribe for a position out of range with OutOfRange(uint256 tokenId). The
// deployed PositionManager wraps a subscriber's revert in WrappedError(target, selector, reason, details), and
// SubscriptionReverted(subscriber, reason) is the older form; either way `reason` leads with the subscriber's
// selector. OutOfRange() without the token id is matched as well.
const OUT_OF_RANGE_SELECTORS = ["0x6f2fb69e", "0x7db3aba7"];

// The chain each pool's PositionManager lives on. Transactions are pinned to it, so a wallet on another
// network is asked to switch first rather than sending to the same address on the wrong chain.
const POLYGON_CHAIN_ID = 137 as const;
export type PositionChainId = 1 | 8453 | typeof POLYGON_CHAIN_ID;
export const POSITION_CHAIN_IDS: Record<string, PositionChainId> = { ethereum: 1, base: 8453, polygon: POLYGON_CHAIN_ID };

/** How long a sent transaction is watched before the row gives up and points to the explorer. */
export const RECEIPT_TIMEOUT_MS = 5 * 60_000;

const ACTION_DONE: Record<PositionAction, string> = {
  subscribe: "Subscribed.",
  unsubscribe: "Unsubscribed.",
  collect: "Fees collected.",
  decrease: "Liquidity removed. The tokens and the position's uncollected fees are in your wallet.",
  close: "Position closed. Its tokens and uncollected fees are in your wallet, and the position NFT is burned.",
};
const ACTION_NAME: Record<PositionAction, string> = {
  subscribe: "Subscribe",
  unsubscribe: "Unsubscribe",
  collect: "Collect fees",
  decrease: "Remove liquidity",
  close: "Close position",
};

/** Actions that pay tokens out, which take the page-wide claim queue so they never overlap a claim. */
const PAYOUT_ACTIONS: ReadonlySet<PositionAction> = new Set<PositionAction>(["collect", "decrease", "close"]);

const REVERT_REASON: Record<string, string> = {
  AlreadySubscribed: "This position is already subscribed.",
  NotSubscribed: "This position is not subscribed.",
  NotApproved: "This wallet cannot manage this position.",
  NoCodeSubscriber: "The rewards subscriber contract is missing on this network.",
  GasLimitTooLow: "The gas limit was too low for the rewards subscriber.",
  MinimumAmountInsufficient: "The price moved more than the slippage allows. Try again, or allow more slippage.",
  MaximumAmountExceeded: "The price moved more than the slippage allows. Try again, or allow more slippage.",
  DeadlinePassed: "The transaction expired before it was confirmed. Try again.",
};

/** The PositionManager's liquidity calls with the subscription errors above, so a revert in either decodes to its name. */
const liquidityWriteAbi = [
  ...liquidityAbi,
  ...positionManagerAbi.filter(item => item.type === "error" && (item.name === "SubscriptionReverted" || item.name === "NoCodeSubscriber")),
];

/** How much of a position a removal takes, in percent (100 for a close), and the slippage it allows, in basis points. */
export type WithdrawOptions = { percent: number; slippageBps: number };

type LiquidityRequest = {
  address: `0x${string}`;
  abi: typeof liquidityWriteAbi;
  functionName: "modifyLiquidities" | "multicall";
  args: readonly unknown[];
};

export type ErrorLike = {
  name?: string;
  code?: number;
  shortMessage?: string;
  message?: string;
  reason?: string;
  data?: { errorName?: string; args?: readonly unknown[] };
  cause?: unknown;
};

/** The error and each of its causes, outermost first, as viem nests them. */
export function errorChain(err: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = err as ErrorLike | undefined;
  while (current && typeof current === "object" && chain.length < 10) {
    chain.push(current);
    current = current.cause as ErrorLike | undefined;
  }
  return chain;
}

/** True when the user declined the request in the wallet (EIP-1193 code 4001, or viem's wrapper for it). */
export function isUserRejection(err: unknown): boolean {
  return errorChain(err).some((e) => e.code === 4001 || e.name === "UserRejectedRequestError");
}

/**
 * Why the contract rejects a call, in words, when `err` is a decoded revert; null for any other failure
 * (a network error, a wallet refusal), which says nothing about the contract.
 */
export function revertReason(err: unknown): string | null {
  for (const e of errorChain(err)) {
    const errorName = e.data?.errorName;
    if (errorName === "SubscriptionReverted" || errorName === "WrappedError") {
      const reason = String(e.data?.args?.[errorName === "WrappedError" ? 2 : 1] ?? "").toLowerCase();
      return OUT_OF_RANGE_SELECTORS.some((selector) => reason.startsWith(selector))
        ? "Only in-range positions can be subscribed. This one is out of range."
        : "The rewards subscriber rejected this position.";
    }
    if (errorName) return REVERT_REASON[errorName] ?? `The contract rejected it (${errorName}).`;
    if (e.name === "ContractFunctionRevertedError") return e.reason ? `The contract rejected it: ${e.reason}.` : "The contract rejected it.";
  }
  return null;
}

export function errorMessage(err: unknown): string {
  const e = err as ErrorLike | undefined;
  return e?.shortMessage || e?.message || "Unknown error";
}

export type Replacement = { reason: "cancelled" | "replaced" | "repriced"; transaction: { hash: `0x${string}` } };

export type PositionActionsOptions = {
  /** The pool's chain as the registry names it ("polygon", "base", "ethereum"). */
  blockchain: string | undefined;
  /** The pool id, which picks the subscriber for Merkl pools. */
  poolId: string | undefined;
  /** Called once a transaction confirms, with its block, so the caller can reload positions read at or after it. */
  onConfirmed?: (blockNumber: number | undefined) => void;
};

/**
 * Subscribe and unsubscribe for the positions of one pool, one transaction at a time. `pending` names the row
 * in flight and its step, and each row's outcome is kept in `results` until `clearResults` runs.
 *
 * Each action runs the same steps: simulate the call on the pool's chain, so a certain revert is explained on
 * the row instead of reaching the wallet; switch the wallet to the pool's chain if needed; ask the wallet to
 * sign, pinned to that chain; then wait for the receipt on that chain, whatever network the wallet moves to
 * meanwhile, for at most RECEIPT_TIMEOUT_MS. A cancel or replacement in the wallet is reported as such, and
 * links point at the transaction that was mined. A confirmed action records the position's new subscription
 * state in its result, so the row shows it before the follow-up positions read returns.
 */
export function usePositionActions({ blockchain, poolId, onConfirmed }: PositionActionsOptions) {
  const { address, chain } = useAccount();
  const [pending, setPending] = useState<PendingPositionTx | null>(null);
  const [results, setResults] = useState<Record<string, PositionTxResult>>({});

  const chainAddresses = getUniswapChainAddresses(blockchain, poolId);
  const poolChainId: PositionChainId = POSITION_CHAIN_IDS[blockchain ?? ""] ?? POLYGON_CHAIN_ID;
  const chainName = chainDisplayName(Object.keys(POSITION_CHAIN_IDS).find((key) => POSITION_CHAIN_IDS[key] === poolChainId) ?? "polygon");
  const publicClient = usePublicClient({ chainId: poolChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Mirrors `pending` synchronously, so a second click in the same render cannot start another transaction.
  const pendingRef = useRef<PendingPositionTx | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const txUrlOf = (hash: string) => `${chainAddresses.explorerTxBase}${hash}`;
  const txLinkLabel = `View on ${chainAddresses.explorerName}`;

  const setRowResult = (tokenId: string, result: PositionTxResult) => {
    if (mounted.current) setResults((prev) => ({ ...prev, [tokenId]: result }));
  };
  const setStep = (next: PendingPositionTx) => {
    pendingRef.current = next;
    if (mounted.current) setPending(next);
  };
  const finishPending = () => {
    pendingRef.current = null;
    if (mounted.current) setPending(null);
  };

  /**
   * Runs one action for the row `tokenId`. For "collect", `tokenId` names the row showing progress (a position, or
   * "pool" for the pool-wide collect) and `targets` the positions it covers.
   */
  const run = async (tokenId: string, action: PositionAction, targets: readonly CollectTarget[] = [], withdraw?: WithdrawOptions) => {
    if (pendingRef.current) return;
    const name = ACTION_NAME[action];
    const target = { address: chainAddresses.positionManager as `0x${string}`, abi: positionManagerAbi } as const;
    const subscriber = chainAddresses.subscriber as `0x${string}`;

    setResults((prev) => {
      const rest = { ...prev };
      delete rest[tokenId];
      return rest;
    });
    setStep({ tokenId, action, step: "checking", chainName });

    // A collect, removal or close takes the page-wide claim queue for its whole run, so it never overlaps a claim.
    if (PAYOUT_ACTIONS.has(action)) {
      try {
        await runExclusive(() => send(tokenId, action, targets, target, subscriber, name, withdraw));
      } catch (err) {
        if (err instanceof ClaimInProgressError) setRowResult(tokenId, { kind: "notice", message: err.message });
        else throw err;
      } finally {
        finishPending();
      }
      return;
    }
    try {
      await send(tokenId, action, targets, target, subscriber, name);
    } finally {
      finishPending();
    }
  };

  const send = async (
    tokenId: string,
    action: PositionAction,
    targets: readonly CollectTarget[],
    target: { address: `0x${string}`; abi: typeof positionManagerAbi },
    subscriber: `0x${string}`,
    name: string,
    withdraw?: WithdrawOptions,
  ) => {
    // A collect sends what is owed now, read just before the wallet prompt; nothing owed means nothing is sent.
    let plan: CollectPlan | null = null;
    if (action === "collect") {
      if (!publicClient || !address) {
        setRowResult(tokenId, { kind: "error", message: "Connect your wallet to collect fees." });
        return;
      }
      try {
        plan = await readCollect(publicClient, { chainId: poolChainId, positionManager: target.address, owner: address, targets });
      } catch (err) {
        setRowResult(tokenId, { kind: "error", message: `The fees to collect couldn't be read, so nothing was sent: ${errorMessage(err)}` });
        return;
      }
      if (!plan) {
        setRowResult(tokenId, { kind: "notice", message: "There are no fees to collect right now." });
        return;
      }
    }
    const id = action === "collect" ? 0n : BigInt(tokenId);

    // A removal or close is planned against the position and price read just before the wallet prompt.
    let liquidityRequest: LiquidityRequest | null = null;
    if (action === "decrease" || action === "close") {
      if (!publicClient || !address || !poolId) {
        setRowResult(tokenId, {
          kind: "error",
          message: `Connect your wallet to ${action === "close" ? "close the position" : "remove liquidity"}.`,
        });
        return;
      }
      const options = withdraw ?? { percent: 100, slippageBps: 50 };
      let state: PositionState;
      try {
        state = await readPositionState(publicClient, {
          chainId: poolChainId,
          positionManager: target.address,
          poolId: poolId as `0x${string}`,
          tokenId: id,
        });
      } catch (err) {
        setRowResult(tokenId, { kind: "error", message: `The position couldn't be read, so nothing was sent: ${errorMessage(err)}` });
        return;
      }
      if (state.owner.toLowerCase() !== address.toLowerCase()) {
        setRowResult(tokenId, { kind: "error", message: `${name} was not sent. ${REVERT_REASON.NotApproved}` });
        return;
      }
      const plan = planWithdraw(state.range, state.sqrtPriceX96, state.liquidity, action === "close" ? 100 : options.percent, options.slippageBps);
      if (action === "decrease" && !plan) {
        setRowResult(tokenId, { kind: "notice", message: "This position has no liquidity to remove." });
        return;
      }
      const limits = {
        poolKey: state.poolKey,
        tokenId: id,
        amount0Min: plan?.amount0Min ?? 0n,
        amount1Min: plan?.amount1Min ?? 0n,
        owner: address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + COLLECT_DEADLINE_SECONDS),
      };
      liquidityRequest = {
        address: target.address,
        abi: liquidityWriteAbi,
        ...(action === "close"
          ? closePositionCall({ ...limits, subscribed: closeFlow(state.subscriber) === "unsubscribeAndBurn" })
          : { functionName: "modifyLiquidities" as const, args: decreaseLiquidityArgs({ ...limits, liquidity: plan!.liquidity }) }),
      };
    }

    // A revert found here is certain on chain; any other simulation failure (the RPC, a missing client) is
    // not a verdict on the call, so the wallet still gets to try.
    if (publicClient && address) {
      try {
        if (plan) {
          await publicClient.simulateContract({ ...plan.request, account: address });
        } else if (liquidityRequest) {
          await publicClient.simulateContract({ ...liquidityRequest, account: address } as Parameters<typeof publicClient.simulateContract>[0]);
        } else if (action === "subscribe") {
          await publicClient.simulateContract({ ...target, functionName: "subscribe", args: [id, subscriber, "0x"], account: address });
        } else {
          await publicClient.simulateContract({ ...target, functionName: "unsubscribe", args: [id], account: address });
        }
      } catch (err) {
        const reason = revertReason(err);
        if (reason) {
          setRowResult(tokenId, { kind: "error", message: `${name} was not sent. ${reason}` });
          return;
        }
        console.warn(`${name} simulation failed; sending anyway`, err);
      }
    }

    if (chain?.id !== poolChainId) {
      setStep({ tokenId, action, step: "switching", chainName });
      try {
        await switchChainAsync({ chainId: poolChainId });
      } catch (err) {
        setRowResult(
          tokenId,
          isUserRejection(err)
            ? { kind: "notice", message: `The switch to ${chainName} was declined, so nothing was sent.` }
            : { kind: "error", message: `Your wallet could not switch to ${chainName}, so nothing was sent: ${errorMessage(err)}` },
        );
        return;
      }
    }

    setStep({ tokenId, action, step: "signing", chainName });
    let hash: `0x${string}`;
    try {
      hash = plan
        ? await writeContractAsync({ ...plan.request, chainId: poolChainId })
        : liquidityRequest
          ? await writeContractAsync({ ...liquidityRequest, chainId: poolChainId } as Parameters<typeof writeContractAsync>[0])
          : action === "subscribe"
          ? await writeContractAsync({ ...target, functionName: "subscribe", args: [id, subscriber, "0x"], chainId: poolChainId })
          : await writeContractAsync({ ...target, functionName: "unsubscribe", args: [id], chainId: poolChainId });
    } catch (err) {
      const reason = revertReason(err);
      setRowResult(
        tokenId,
        isUserRejection(err)
          ? { kind: "notice", message: `${name} was cancelled in your wallet, so nothing was sent.` }
          : { kind: "error", message: `${name} was not sent. ${reason ?? errorMessage(err)}` },
      );
      return;
    }

    setStep({ tokenId, action, step: "mining", chainName, hash, txUrl: txUrlOf(hash), txLinkLabel });
    if (!publicClient) {
      setRowResult(tokenId, { kind: "notice", message: `${name} was sent. Check its status on the explorer.`, txUrl: txUrlOf(hash), txLinkLabel });
      return;
    }

    let replacement: Replacement | null = null;
    let receipt: { status: "success" | "reverted"; transactionHash: `0x${string}`; blockNumber: bigint };
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
        onReplaced: (r) => {
          replacement = r as Replacement;
        },
      });
    } catch (err) {
      const timedOut = errorChain(err).some((e) => e.name === "WaitForTransactionReceiptTimeoutError");
      setRowResult(tokenId, {
        kind: "error",
        message: timedOut ? `${name} is not confirmed after 5 minutes. Check it on the explorer.` : `Could not confirm ${name.toLowerCase()}. Check it on the explorer.`,
        txUrl: txUrlOf(hash),
        txLinkLabel,
      });
      return;
    }

    const mined = { txUrl: txUrlOf(receipt.transactionHash), txLinkLabel };
    const replaced = replacement as Replacement | null;
    if (replaced && replaced.reason !== "repriced") {
      setRowResult(tokenId, {
        kind: "notice",
        message:
          replaced.reason === "cancelled"
            ? `${name} was cancelled in your wallet. The position is unchanged.`
            : `${name} was replaced by another transaction from your wallet.`,
        ...mined,
      });
      onConfirmedRef.current?.(Number(receipt.blockNumber));
      return;
    }
    if (receipt.status !== "success") {
      toast.error(`${name} failed on ${chainName}.`);
      setRowResult(tokenId, { kind: "error", message: `${name} failed on chain.`, ...mined });
      return;
    }

    toast.success("Transaction confirmed successfully!");
    setRowResult(
      tokenId,
      plan
        ? { kind: "success", message: `Collected ${describeCollect(plan.amounts)}.`, ...mined }
        : action === "close"
          ? { kind: "success", message: ACTION_DONE.close, closed: true, ...mined }
          : action === "decrease"
            ? { kind: "success", message: ACTION_DONE.decrease, ...mined }
            : { kind: "success", message: ACTION_DONE[action], subscribed: action === "subscribe", ...mined },
    );
    onConfirmedRef.current?.(Number(receipt.blockNumber));
  };

  const subscribe = (tokenId: string) => run(tokenId, "subscribe");
  const unsubscribe = (tokenId: string) => run(tokenId, "unsubscribe");
  /** Collects the fees of `targets` in one transaction, showing progress on the row `rowKey` ("pool" for all). */
  const collect = (rowKey: string, targets: readonly CollectTarget[]) => run(rowKey, "collect", targets);
  /** Removes `options.percent` of the position's liquidity, collecting its uncollected fees with it. */
  const decrease = (tokenId: string, options: WithdrawOptions) => run(tokenId, "decrease", [], options);
  /** Closes the position: removes all liquidity, collects its fees and burns it, unsubscribing it first if subscribed. */
  const close = (tokenId: string, slippageBps: number) => run(tokenId, "close", [], { percent: 100, slippageBps });
  const clearResults = () => setResults({});

  return {
    pending,
    results,
    subscribe,
    unsubscribe,
    collect,
    decrease,
    close,
    clearResults,
    // The Merkl registry accepts only in-range positions, so the list offers Subscribe only on those.
    subscribeNeedsInRange: isMerklUniswapPool(poolId),
  };
}

/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { toast } from "react-toastify";
import { getUniswapChainAddresses } from "@/lib/contracts";
import type { PendingPositionTx, PositionAction, PositionTxResult } from "@/components/common/PositionsList";

// Minimal PositionManager ABI for subscribe and unsubscribe
const positionManagerAbi = [
  {
    type: "function",
    name: "subscribe",
    inputs: [
      { type: "uint256", name: "tokenId" },
      { type: "address", name: "newSubscriber" },
      { type: "bytes", name: "data" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unsubscribe",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// The chain each pool's PositionManager lives on. Transactions are pinned to it, so a wallet on another
// network is asked to switch first rather than sending to the same address on the wrong chain.
const POLYGON_CHAIN_ID = 137 as const;
type PositionChainId = 1 | 8453 | typeof POLYGON_CHAIN_ID;
const POSITION_CHAIN_IDS: Record<string, PositionChainId> = { ethereum: 1, base: 8453, polygon: POLYGON_CHAIN_ID };

const ACTION_DONE: Record<PositionAction, string> = { subscribe: "Subscribed.", unsubscribe: "Unsubscribed." };
const ACTION_NAME: Record<PositionAction, string> = { subscribe: "Subscribe", unsubscribe: "Unsubscribe" };

function errorMessage(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | undefined;
  return e?.shortMessage || e?.message || "Unknown error";
}

export type PositionActionsOptions = {
  /** The pool's chain as the registry names it ("polygon", "base", "ethereum"). */
  blockchain: string | undefined;
  /** The pool id, which picks the subscriber for Merkl pools. */
  poolId: string | undefined;
  /** Called once a transaction confirms, with its block, so the caller can reload positions read at or after it. */
  onConfirmed?: (blockNumber: number | undefined) => void;
};

/**
 * Subscribe and unsubscribe for the positions of one pool. Transactions run one at a time: `pending` names
 * the row in flight, and each row's outcome is kept in `results` until `clearResults` runs. Every action
 * switches the wallet to the pool's chain first and pins the write to it, so nothing is sent on the wrong
 * network; if the wallet refuses or cannot switch, nothing is sent and the row says why.
 */
export function usePositionActions({ blockchain, poolId, onConfirmed }: PositionActionsOptions) {
  const { chain } = useAccount();
  const [pending, setPending] = useState<PendingPositionTx | null>(null);
  const [results, setResults] = useState<Record<string, PositionTxResult>>({});

  const chainAddresses = getUniswapChainAddresses(blockchain, poolId);
  const poolChainId: PositionChainId = POSITION_CHAIN_IDS[blockchain ?? ""] ?? POLYGON_CHAIN_ID;
  const { switchChainAsync } = useSwitchChain();

  const { data: hash, writeContractAsync } = useWriteContract();
  const { data: txData, isSuccess: isTxConfirmed, isError: isTxError, error: txError } = useWaitForTransactionReceipt({ hash });

  // Mirrors `pending` synchronously, so a second click in the same render cannot start another transaction.
  const pendingRef = useRef<PendingPositionTx | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const setRowResult = (tokenId: string, result: PositionTxResult) => setResults(prev => ({ ...prev, [tokenId]: result }));

  const finishPending = () => {
    pendingRef.current = null;
    setPending(null);
  };

  useEffect(() => {
    const current = pending;
    if (!current?.hash || current.hash !== hash) return;
    const txUrl = `${chainAddresses.explorerTxBase}${hash}`;
    const txLinkLabel = `View on ${chainAddresses.explorerName}`;

    if (isTxConfirmed) {
      toast.success("Transaction confirmed successfully!");
      setRowResult(current.tokenId, { kind: "success", message: ACTION_DONE[current.action], txUrl, txLinkLabel });
      finishPending();
      onConfirmedRef.current?.(txData ? Number(txData.blockNumber) : undefined);
    } else if (isTxError) {
      console.error("Transaction error", txError);
      toast.error(`Transaction error ${txError}`);
      setRowResult(current.tokenId, { kind: "error", message: `${ACTION_NAME[current.action]} failed.`, txUrl, txLinkLabel });
      finishPending();
    }
  }, [isTxConfirmed, isTxError, txData, txError, hash, pending]);

  const send = async (tokenId: string, action: PositionAction, write: () => Promise<`0x${string}`>) => {
    if (pendingRef.current) return;
    const next: PendingPositionTx = { tokenId, action };
    pendingRef.current = next;
    setPending(next);
    setResults(prev => {
      const rest = { ...prev };
      delete rest[tokenId];
      return rest;
    });

    try {
      const sent = { ...next, hash: await write() };
      pendingRef.current = sent;
      setPending(sent);
    } catch (err) {
      console.error(`${ACTION_NAME[action]} failed`, err);
      setRowResult(tokenId, { kind: "error", message: `${ACTION_NAME[action]} was not sent: ${errorMessage(err)}` });
      finishPending();
    }
  };

  const switchToPoolChain = async () => {
    if (chain?.id === poolChainId) return;
    await switchChainAsync({ chainId: poolChainId });
  };

  const subscribe = (tokenId: string) =>
    send(tokenId, "subscribe", async () => {
      await switchToPoolChain();
      return writeContractAsync({
        chainId: poolChainId,
        address: chainAddresses.positionManager as `0x${string}`,
        abi: positionManagerAbi,
        functionName: "subscribe",
        args: [BigInt(tokenId), chainAddresses.subscriber as `0x${string}`, "0x"],
      });
    });

  const unsubscribe = (tokenId: string) =>
    send(tokenId, "unsubscribe", async () => {
      await switchToPoolChain();
      return writeContractAsync({
        chainId: poolChainId,
        address: chainAddresses.positionManager as `0x${string}`,
        abi: positionManagerAbi,
        functionName: "unsubscribe",
        args: [BigInt(tokenId)],
      });
    });

  const clearResults = () => setResults({});

  return { pending, results, subscribe, unsubscribe, clearResults };
}

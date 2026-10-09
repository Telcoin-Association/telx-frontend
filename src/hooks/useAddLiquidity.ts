import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { toast } from "react-toastify";
import type { Address, Hex } from "viem";
import { getUniswapChainAddresses } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import { rangeProblem } from "@/lib/v4/range";
import {
  encodePermitBatch,
  erc20Abi,
  isNative,
  MAX_UINT256,
  mintAndSubscribeCalls,
  needsErc20Approval,
  PERMIT2,
  permit2Abi,
  permitBatchTypedData,
  permitDetails,
  poolKeyId,
  positionManagerAbi,
  STATE_VIEW,
  stateViewAbi,
  type PermitDetails,
  type PoolKey,
  type TokenApproval,
} from "@/lib/v4/positionManager";
import {
  errorChain,
  errorMessage,
  isUserRejection,
  POSITION_CHAIN_IDS,
  RECEIPT_TIMEOUT_MS,
  revertReason,
  type PositionChainId,
  type Replacement,
} from "./usePositionActions";

/** How long a signed add-liquidity call stays valid before the PositionManager rejects it. */
export const ADD_LIQUIDITY_DEADLINE_SECONDS = 20 * 60;

export type PoolReadState = { poolKey: PoolKey; sqrtPriceX96: bigint; tick: number; poolLiquidity: bigint; decimals: [number, number] };
export type WalletReadState = { balances: [bigint, bigint]; approvals: [TokenApproval, TokenApproval] };

/**
 * One step of an add: a token's one-time approval of Permit2 (a transaction), the signed Permit2 allowance for this
 * add (a signature, no gas), or the mint and subscribe (a transaction carrying that allowance).
 */
export type AddLiquidityTask = { kind: "erc20"; currency: Address; symbol: string } | { kind: "permit" } | { kind: "add" };
export type AddLiquidityStep = "checking" | "switching" | "signing" | "mining";
export type AddLiquidityPending = { task: AddLiquidityTask; step: AddLiquidityStep; chainName: string; txUrl?: string; txLinkLabel?: string };
export type AddLiquidityResult = { kind: "success" | "notice" | "error"; message: string; txUrl?: string; txLinkLabel?: string };

export type AddLiquidityRequest = { tickLower: number; tickUpper: number; liquidity: bigint; amount0Max: bigint; amount1Max: bigint; symbols: [string, string] };

const NO_APPROVAL: TokenApproval = { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0, permit2Nonce: 0 };

export const taskName = (task: AddLiquidityTask): string =>
  task.kind === "add" ? "Adding liquidity" : task.kind === "erc20" ? `Approving ${task.symbol}` : "Signing the token allowance";

/**
 * Adding liquidity to a Uniswap v4 TELx pool and subscribing the new position to TELx rewards. Reads the pool (its
 * key from the PositionManager, its price and active liquidity from StateView) and the wallet's balances and
 * Permit2 approvals on the pool's chain.
 *
 * One call to `add` runs every step without further clicks: the wallet switches to the pool's chain once; a token
 * that has never approved Permit2 approves it (unlimited, once per token), each approval sent as soon as the one
 * before confirms; then one Permit2 signature allows the PositionManager exactly this add's maximum amounts for
 * PERMIT_SECONDS, and the add carries it in the same multicall as the mint and subscribe, so no standing Permit2
 * allowance is left. A token whose Permit2 allowance already covers the amount needs no signature.
 *
 * Each transaction is simulated on the pool's chain first, so a certain revert is explained instead of reaching
 * the wallet, then waits for its receipt for at most RECEIPT_TIMEOUT_MS. The add reads the pool's price and
 * `nextTokenId` again just before it is sent; if another mint takes that id before the simulation, it reads the id
 * once more and simulates again.
 */
export function useAddLiquidity({ blockchain, poolId, onConfirmed }: { blockchain: string | undefined; poolId: string | undefined; onConfirmed?: (blockNumber: number) => void }) {
  const { address, chain } = useAccount();
  const poolChainId: PositionChainId = POSITION_CHAIN_IDS[blockchain ?? ""] ?? 137;
  const chainName = chainDisplayName(blockchain ?? "polygon");
  const chainAddresses = getUniswapChainAddresses(blockchain, poolId);
  const positionManager = chainAddresses.positionManager as Address;
  const subscriber = chainAddresses.subscriber as Address;
  const publicClient = usePublicClient({ chainId: poolChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [pool, setPool] = useState<PoolReadState | null>(null);
  const [wallet, setWallet] = useState<WalletReadState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<AddLiquidityPending | null>(null);
  const [result, setResult] = useState<AddLiquidityResult | null>(null);
  const pendingRef = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readPool = useCallback(async (): Promise<PoolReadState | null> => {
    if (!publicClient || !poolId) return null;
    const id = poolId as Hex;
    const [key, slot0, poolLiquidity] = await Promise.all([
      publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "poolKeys", args: [poolKeyId(id)] }),
      publicClient.readContract({ address: STATE_VIEW[poolChainId], abi: stateViewAbi, functionName: "getSlot0", args: [id] }),
      publicClient.readContract({ address: STATE_VIEW[poolChainId], abi: stateViewAbi, functionName: "getLiquidity", args: [id] }),
    ]);
    const [currency0, currency1, fee, tickSpacing, hooks] = key;
    const decimalsOf = (currency: Address) =>
      isNative(currency) ? Promise.resolve(18) : publicClient.readContract({ address: currency, abi: erc20Abi, functionName: "decimals" });
    const decimals = await Promise.all([decimalsOf(currency0), decimalsOf(currency1)]);
    return { poolKey: { currency0, currency1, fee, tickSpacing, hooks }, sqrtPriceX96: slot0[0], tick: slot0[1], poolLiquidity, decimals: [decimals[0], decimals[1]] };
  }, [publicClient, poolId, positionManager, poolChainId]);

  const readWallet = useCallback(
    async (poolKey: PoolKey): Promise<WalletReadState | null> => {
      if (!publicClient || !address) return null;
      const read = async (currency: Address): Promise<[bigint, TokenApproval]> => {
        if (isNative(currency)) return [await publicClient.getBalance({ address }), NO_APPROVAL];
        const [balance, erc20ToPermit2, permit2] = await Promise.all([
          publicClient.readContract({ address: currency, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: currency, abi: erc20Abi, functionName: "allowance", args: [address, PERMIT2] }),
          publicClient.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [address, currency, positionManager] }),
        ]);
        return [balance, { erc20ToPermit2, permit2Amount: permit2[0], permit2Expiration: Number(permit2[1]), permit2Nonce: Number(permit2[2]) }];
      };
      const [[b0, a0], [b1, a1]] = await Promise.all([read(poolKey.currency0), read(poolKey.currency1)]);
      return { balances: [b0, b1], approvals: [a0, a1] };
    },
    [publicClient, address, positionManager],
  );

  const reload = useCallback(async () => {
    try {
      const nextPool = await readPool();
      if (!mounted.current) return;
      setPool(nextPool);
      setWallet(nextPool ? await readWallet(nextPool.poolKey) : null);
      setLoadError(false);
    } catch (err) {
      console.error("Add liquidity: reading the pool or wallet failed", err);
      if (mounted.current) setLoadError(true);
    }
  }, [readPool, readWallet]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const txUrlOf = (hash: string) => `${chainAddresses.explorerTxBase}${hash}`;
  const txLinkLabel = `View on ${chainAddresses.explorerName}`;
  const finish = (next: AddLiquidityResult | null) => {
    if (!mounted.current) return;
    if (next) setResult(next);
    setPending(null);
  };

  /** Asks the wallet to sign and send, then waits for the receipt. Returns it when the transaction succeeded; otherwise reports why and returns null. */
  const sendAndConfirm = async (task: AddLiquidityTask, send: () => Promise<Hex>) => {
    const name = taskName(task);
    setPending({ task, step: "signing", chainName });
    let hash: Hex;
    try {
      hash = await send();
    } catch (err) {
      finish(
        isUserRejection(err)
          ? { kind: "notice", message: `${name} was cancelled in your wallet, so nothing was sent.` }
          : { kind: "error", message: `${name} was not sent. ${revertReason(err) ?? errorMessage(err)}` },
      );
      return null;
    }

    setPending({ task, step: "mining", chainName, txUrl: txUrlOf(hash), txLinkLabel });
    if (!publicClient) {
      finish({ kind: "notice", message: `${name} was sent. Check its status on the explorer.`, txUrl: txUrlOf(hash), txLinkLabel });
      return null;
    }

    let replacement: Replacement | null = null;
    let receipt: { status: "success" | "reverted"; transactionHash: Hex; blockNumber: bigint };
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
      finish({
        kind: "error",
        message: timedOut ? `${name} is not confirmed after 5 minutes. Check it on the explorer.` : `Could not confirm the transaction. Check it on the explorer.`,
        txUrl: txUrlOf(hash),
        txLinkLabel,
      });
      return null;
    }

    const mined = { txUrl: txUrlOf(receipt.transactionHash), txLinkLabel };
    const replaced = replacement as Replacement | null;
    if (replaced && replaced.reason !== "repriced") {
      await reload();
      finish({
        kind: "notice",
        message: replaced.reason === "cancelled" ? `${name} was cancelled in your wallet.` : `${name} was replaced by another transaction from your wallet.`,
        ...mined,
      });
      return null;
    }
    if (receipt.status !== "success") {
      toast.error(`${name} failed on ${chainName}.`);
      finish({
        kind: "error",
        message:
          task.kind === "add"
            ? "Adding liquidity failed on chain, and nothing was added. If the price moved or another position was created at the same moment, try again."
            : `${name} failed on chain.`,
        ...mined,
      });
      return null;
    }
    return { ...receipt, mined };
  };

  /** Reports a simulation that reverted for a known reason; rethrows anything else. */
  const explainRevert = (task: AddLiquidityTask, err: unknown) => {
    const reason = revertReason(err) ?? (err instanceof RangeError ? err.message : null);
    if (!reason) throw err;
    finish({ kind: "error", message: `${taskName(task)} was not sent. ${reason}` });
  };

  const add = async (request: AddLiquidityRequest): Promise<void> => {
    if (pendingRef.current || !address || !publicClient) return;
    pendingRef.current = true;
    setResult(null);
    const addTask: AddLiquidityTask = { kind: "add" };
    setPending({ task: addTask, step: "checking", chainName });
    try {
      const fresh = await readPool();
      if (!fresh) throw new Error("The pool could not be read.");
      if (mounted.current) setPool(fresh);
      const problem = rangeProblem({ tickLower: request.tickLower, tickUpper: request.tickUpper }, fresh.tick, fresh.poolKey.tickSpacing);
      if (problem) return finish({ kind: "error", message: `Adding liquidity was not sent. The price moved: ${problem}` });
      const funds = await readWallet(fresh.poolKey);
      if (!funds) throw new Error("The wallet could not be read.");

      if (chain?.id !== poolChainId) {
        setPending({ task: addTask, step: "switching", chainName });
        try {
          await switchChainAsync({ chainId: poolChainId });
        } catch (err) {
          return finish(
            isUserRejection(err)
              ? { kind: "notice", message: `The switch to ${chainName} was declined, so nothing was sent.` }
              : { kind: "error", message: `Your wallet could not switch to ${chainName}, so nothing was sent: ${errorMessage(err)}` },
          );
        }
      }

      const currencies = [fresh.poolKey.currency0, fresh.poolKey.currency1] as const;
      const maxima = [request.amount0Max, request.amount1Max] as const;

      // A token's first add approves Permit2 once; the next step follows as soon as each approval confirms.
      for (const side of [0, 1] as const) {
        if (!needsErc20Approval(currencies[side], maxima[side], funds.approvals[side])) continue;
        const task: AddLiquidityTask = { kind: "erc20", currency: currencies[side], symbol: request.symbols[side] };
        setPending({ task, step: "checking", chainName });
        try {
          await publicClient.simulateContract({ address: currencies[side], abi: erc20Abi, functionName: "approve", args: [PERMIT2, MAX_UINT256], account: address });
        } catch (err) {
          return explainRevert(task, err);
        }
        const approved = await sendAndConfirm(task, () =>
          writeContractAsync({ address: currencies[side], abi: erc20Abi, functionName: "approve", args: [PERMIT2, MAX_UINT256], chainId: poolChainId }),
        );
        if (!approved) return;
      }

      // One signature allows the PositionManager exactly this add's amounts, for both tokens at once.
      const now = Math.floor(Date.now() / 1000);
      const deadline = BigInt(now + ADD_LIQUIDITY_DEADLINE_SECONDS);
      const details = ([0, 1] as const)
        .map((side) => permitDetails(currencies[side], maxima[side], funds.approvals[side], now))
        .filter((detail): detail is PermitDetails => detail !== null);
      let permitCall: Hex | null = null;
      if (details.length) {
        const task: AddLiquidityTask = { kind: "permit" };
        setPending({ task, step: "signing", chainName });
        try {
          const signature = await signTypedDataAsync(permitBatchTypedData(poolChainId, details, positionManager, deadline));
          permitCall = encodePermitBatch(address, details, positionManager, deadline, signature);
        } catch (err) {
          return finish(
            isUserRejection(err)
              ? { kind: "notice", message: "The token allowance was not signed, so nothing was added." }
              : { kind: "error", message: `The token allowance could not be signed: ${errorMessage(err)}` },
          );
        }
      }

      setPending({ task: addTask, step: "checking", chainName });
      const value = isNative(fresh.poolKey.currency0) ? request.amount0Max : 0n;
      const prepare = async () => {
        const tokenId = await publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "nextTokenId" });
        const mint = mintAndSubscribeCalls({ poolKey: fresh.poolKey, ...request, owner: address, deadline, tokenId, subscriber });
        const calls: Hex[] = permitCall ? [permitCall, ...mint] : [...mint];
        await publicClient.simulateContract({ address: positionManager, abi: positionManagerAbi, functionName: "multicall", args: [calls], value, account: address });
        return { tokenId, calls };
      };
      let prepared: { tokenId: bigint; calls: Hex[] };
      try {
        try {
          prepared = await prepare();
        } catch (err) {
          // Another mint took the id read above: the subscribe then names a position this wallet does not own.
          if (!errorChain(err).some((e) => e.data?.errorName === "NotApproved")) throw err;
          prepared = await prepare();
        }
      } catch (err) {
        return explainRevert(addTask, err);
      }

      const receipt = await sendAndConfirm(addTask, () =>
        writeContractAsync({ address: positionManager, abi: positionManagerAbi, functionName: "multicall", args: [prepared.calls], value, chainId: poolChainId }),
      );
      if (!receipt) return;
      toast.success("Transaction confirmed successfully!");
      await reload();
      onConfirmedRef.current?.(Number(receipt.blockNumber));
      finish({ kind: "success", message: `Position #${prepared.tokenId} added and subscribed to TELx rewards.`, ...receipt.mined });
    } catch (err) {
      console.error("Adding liquidity failed", err);
      finish({ kind: "error", message: `Adding liquidity failed: ${errorMessage(err)}` });
    } finally {
      pendingRef.current = false;
    }
  };

  return { pool, wallet, loadError, reload, pending, result, add, chainName, clearResult: () => setResult(null) };
}

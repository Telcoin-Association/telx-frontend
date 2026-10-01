import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { toast } from "react-toastify";
import type { Address, Hex } from "viem";
import { getUniswapChainAddresses } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import { rangeProblem } from "@/lib/v4/range";
import {
  erc20Abi,
  isNative,
  MAX_UINT160,
  MAX_UINT256,
  mintAndSubscribeCalls,
  PERMIT2,
  PERMIT2_APPROVAL_SECONDS,
  permit2Abi,
  poolKeyId,
  positionManagerAbi,
  STATE_VIEW,
  stateViewAbi,
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

/** One transaction the panel can send: an approval for one token, or the mint and subscribe. */
export type AddLiquidityTask = { kind: "erc20" | "permit2"; currency: Address; symbol: string } | { kind: "add" };
export type AddLiquidityStep = "checking" | "switching" | "signing" | "mining";
export type AddLiquidityPending = { task: AddLiquidityTask; step: AddLiquidityStep; chainName: string; txUrl?: string; txLinkLabel?: string };
export type AddLiquidityResult = { kind: "success" | "notice" | "error"; message: string; txUrl?: string; txLinkLabel?: string };

export type AddLiquidityRequest = { tickLower: number; tickUpper: number; liquidity: bigint; amount0Max: bigint; amount1Max: bigint };

const NO_APPROVAL: TokenApproval = { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 };

export const taskName = (task: AddLiquidityTask): string =>
  task.kind === "add" ? "Adding liquidity" : task.kind === "erc20" ? `Approving ${task.symbol}` : `Allowing ${task.symbol} through Permit2`;

/**
 * Adding liquidity to a Uniswap v4 TELx pool and subscribing the new position to TELx rewards, in one transaction,
 * plus the approvals it needs first. Reads the pool (its key from the PositionManager, its price and active
 * liquidity from StateView) and the wallet's balances and Permit2 approvals on the pool's chain.
 *
 * Every transaction runs the steps of the position actions (usePositionActions): simulate on the pool's chain so a
 * certain revert is explained instead of reaching the wallet, switch the wallet to the pool's chain if needed,
 * sign pinned to that chain, then wait for the receipt on that chain for at most RECEIPT_TIMEOUT_MS. The add reads
 * the pool's price and `nextTokenId` again just before it is sent; if another mint takes that id before the
 * simulation, it reads the id once more and simulates again.
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
        return [balance, { erc20ToPermit2, permit2Amount: permit2[0], permit2Expiration: Number(permit2[1]) }];
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

  /**
   * Runs one transaction: `simulate` resolves with what to send, or throws a revert; `send` asks the wallet to sign
   * it. Returns the confirmed block number, or null when nothing confirmed.
   */
  const run = async <T,>(
    task: AddLiquidityTask,
    simulate: () => Promise<T>,
    send: (prepared: T) => Promise<Hex>,
    successMessage: (prepared: T) => string,
  ): Promise<void> => {
    if (pendingRef.current || !address) return;
    pendingRef.current = true;
    setResult(null);
    const name = taskName(task);
    setPending({ task, step: "checking", chainName });
    try {
      let prepared: T;
      try {
        prepared = await simulate();
      } catch (err) {
        const reason = revertReason(err) ?? (err instanceof RangeError ? err.message : null);
        if (reason) return finish({ kind: "error", message: `${name} was not sent. ${reason}` });
        throw err;
      }

      if (chain?.id !== poolChainId) {
        setPending({ task, step: "switching", chainName });
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

      setPending({ task, step: "signing", chainName });
      let hash: Hex;
      try {
        hash = await send(prepared);
      } catch (err) {
        return finish(
          isUserRejection(err)
            ? { kind: "notice", message: `${name} was cancelled in your wallet, so nothing was sent.` }
            : { kind: "error", message: `${name} was not sent. ${revertReason(err) ?? errorMessage(err)}` },
        );
      }

      setPending({ task, step: "mining", chainName, txUrl: txUrlOf(hash), txLinkLabel });
      if (!publicClient) return finish({ kind: "notice", message: `${name} was sent. Check its status on the explorer.`, txUrl: txUrlOf(hash), txLinkLabel });

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
        return finish({
          kind: "error",
          message: timedOut ? `${name} is not confirmed after 5 minutes. Check it on the explorer.` : `Could not confirm the transaction. Check it on the explorer.`,
          txUrl: txUrlOf(hash),
          txLinkLabel,
        });
      }

      const mined = { txUrl: txUrlOf(receipt.transactionHash), txLinkLabel };
      const replaced = replacement as Replacement | null;
      if (replaced && replaced.reason !== "repriced") {
        await reload();
        return finish({
          kind: "notice",
          message: replaced.reason === "cancelled" ? `${name} was cancelled in your wallet.` : `${name} was replaced by another transaction from your wallet.`,
          ...mined,
        });
      }
      if (receipt.status !== "success") {
        toast.error(`${name} failed on ${chainName}.`);
        return finish({
          kind: "error",
          message:
            task.kind === "add"
              ? "Adding liquidity failed on chain, and nothing was added. If the price moved or another position was created at the same moment, try again."
              : `${name} failed on chain.`,
          ...mined,
        });
      }

      toast.success("Transaction confirmed successfully!");
      await reload();
      onConfirmedRef.current?.(Number(receipt.blockNumber));
      finish({ kind: "success", message: successMessage(prepared), ...mined });
    } catch (err) {
      console.error(`${name} failed`, err);
      finish({ kind: "error", message: `${name} failed: ${errorMessage(err)}` });
    } finally {
      pendingRef.current = false;
    }
  };

  const approve = (task: Extract<AddLiquidityTask, { kind: "erc20" | "permit2" }>) =>
    run(
      task,
      async () => {
        if (!publicClient) return null;
        if (task.kind === "erc20") {
          await publicClient.simulateContract({ address: task.currency, abi: erc20Abi, functionName: "approve", args: [PERMIT2, MAX_UINT256], account: address });
          return null;
        }
        const expiration = Math.floor(Date.now() / 1000) + PERMIT2_APPROVAL_SECONDS;
        await publicClient.simulateContract({
          address: PERMIT2,
          abi: permit2Abi,
          functionName: "approve",
          args: [task.currency, positionManager, MAX_UINT160, expiration],
          account: address,
        });
        return expiration;
      },
      (expiration) =>
        task.kind === "erc20"
          ? writeContractAsync({ address: task.currency, abi: erc20Abi, functionName: "approve", args: [PERMIT2, MAX_UINT256], chainId: poolChainId })
          : writeContractAsync({
              address: PERMIT2,
              abi: permit2Abi,
              functionName: "approve",
              args: [task.currency, positionManager, MAX_UINT160, expiration ?? Math.floor(Date.now() / 1000) + PERMIT2_APPROVAL_SECONDS],
              chainId: poolChainId,
            }),
      () => (task.kind === "erc20" ? `${task.symbol} approved for Permit2.` : `${task.symbol} allowed through Permit2.`),
    );

  const add = (request: AddLiquidityRequest) =>
    run(
      { kind: "add" },
      async () => {
        if (!publicClient || !address) throw new Error("No connection to the pool's chain.");
        const fresh = await readPool();
        if (!fresh) throw new Error("The pool could not be read.");
        if (mounted.current) setPool(fresh);
        const problem = rangeProblem({ tickLower: request.tickLower, tickUpper: request.tickUpper }, fresh.tick, fresh.poolKey.tickSpacing);
        if (problem) throw new RangeError(`The price moved: ${problem}`);
        const value = isNative(fresh.poolKey.currency0) ? request.amount0Max : 0n;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + ADD_LIQUIDITY_DEADLINE_SECONDS);
        const prepare = async () => {
          const tokenId = await publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "nextTokenId" });
          const calls = mintAndSubscribeCalls({ poolKey: fresh.poolKey, ...request, owner: address, deadline, tokenId, subscriber });
          await publicClient.simulateContract({ address: positionManager, abi: positionManagerAbi, functionName: "multicall", args: [calls], value, account: address });
          return { tokenId, calls, value };
        };
        try {
          return await prepare();
        } catch (err) {
          // Another mint took the id read above: the subscribe then names a position this wallet does not own.
          const raced = errorChain(err).some((e) => e.data?.errorName === "NotApproved");
          if (!raced) throw err;
          return prepare();
        }
      },
      ({ calls, value }) => writeContractAsync({ address: positionManager, abi: positionManagerAbi, functionName: "multicall", args: [calls], value, chainId: poolChainId }),
      ({ tokenId }) => `Position #${tokenId} added and subscribed to TELx rewards.`,
    );

  return { pool, wallet, loadError, reload, pending, result, approve, add, chainName, clearResult: () => setResult(null) };
}

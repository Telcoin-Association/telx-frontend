"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/lib/publicClients";
import { isUserRejection } from "@/lib/walletErrors";
import { fetchMerklRewards } from "@/merkl/merklService";
import type { MerklBlockchain } from "@/merkl/merklConstants";
import { positionRegistryAbi } from "@/app/api/backendHelpers/helpers";
import { fetchSwapPrices } from "@/web3/swap/usd";
import { NATIVE_TOKEN } from "@/web3/swap/tokens";
import { estimateClaimFeeWei, OLD_POOLS_REGISTRY, type OldPoolsChain } from "@/lib/claims/claimCore";
import { buildClaimPlan, claimAllLabel, claimRowInputs, type ClaimRow, type ClaimRowInput } from "@/lib/claims/claimPlan";
import { runExclusive, useClaimRunning } from "@/lib/claims/claimQueue";
import {
  freshClaim,
  runClaimPlan,
  type ClaimClients,
  type ClaimDecision,
  type ClaimPlanResult,
  type ClaimRowDeps,
  type ClaimRowStatus,
} from "@/lib/claims/claimRunner";

const PUBLIC_CLIENTS = {
  ethereum: publicClientEthereum,
  base: publicClientBase,
  polygon: publicClientPolygon,
} as const;

/** How long building the plan waits for one row's fee estimate before showing it as unknown. */
export const FEE_ESTIMATE_TIMEOUT_MS = 8_000;

export type ClaimAllPhase = "closed" | "preparing" | "review" | "running" | "paused" | "done";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export type UseClaimAllArgs = {
  address: string | undefined;
  /** Claimable Merkl TEL per chain, as the page shows it. */
  merklClaimable: Partial<Record<MerklBlockchain, number | null | undefined>>;
  /** Claimable legacy TEL from the old pools per chain. */
  oldPoolsClaimable: Partial<Record<OldPoolsChain, number | null | undefined>>;
  telUsd: number | null;
  /** Called after each successful claim, so the page refreshes that chain's figures. */
  onClaimed: (row: ClaimRow) => void;
};

/**
 * Claim all: builds a plan of every claim the wallet can make across chains, then runs the checked rows one at a
 * time through the page-wide claim queue, switching the wallet's network between them. A failed row pauses the run
 * until the visitor retries it, skips it or stops.
 */
export function useClaimAll({ address, merklClaimable, oldPoolsClaimable, telUsd, onClaimed }: UseClaimAllArgs) {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  // The wallet client signs on whichever chain the wallet is on; each claim passes its chain, which viem checks
  // against the wallet before sending.
  const { data: walletClient } = useWalletClient();
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;
  const claimRunning = useClaimRunning();

  const [phase, setPhase] = useState<ClaimAllPhase>("closed");
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ClaimRowStatus>>({});
  const [result, setResult] = useState<ClaimPlanResult | null>(null);

  const inputs = useMemo(() => claimRowInputs(merklClaimable, oldPoolsClaimable), [merklClaimable, oldPoolsClaimable]);

  // The wallet's chain, read inside long-running claims, and the waits for a hand-made network switch.
  const chainIdRef = useRef(chainId);
  chainIdRef.current = chainId;
  const chainWaiters = useRef(new Set<{ chainId: number; resolve: () => void }>());
  useEffect(() => {
    chainWaiters.current.forEach((waiter) => {
      if (waiter.chainId === chainId) {
        chainWaiters.current.delete(waiter);
        waiter.resolve();
      }
    });
  }, [chainId]);

  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  const abortRef = useRef<AbortController | null>(null);
  const decisionRef = useRef<((decision: ClaimDecision) => void) | null>(null);
  const preparingRef = useRef(0);

  const deps = useMemo((): ClaimRowDeps | null => {
    if (!address) return null;
    const account = address as Address;
    return {
      account,
      currentChainId: () => chainIdRef.current,
      switchChain: (target) => switchChainAsync({ chainId: target as Parameters<typeof switchChainAsync>[0]["chainId"] }),
      waitForChain: (target, signal) =>
        new Promise<void>((resolve, reject) => {
          if (chainIdRef.current === target) return resolve();
          const waiter = { chainId: target, resolve };
          chainWaiters.current.add(waiter);
          signal.addEventListener("abort", () => {
            chainWaiters.current.delete(waiter);
            reject(new Error("Stopped while waiting for the network switch."));
          });
        }),
      isUserRejection,
      fetchMerkl: (target) => fetchMerklRewards(account, target, { reloadChainId: target }),
      readOldPools: (chain) =>
        PUBLIC_CLIENTS[chain].readContract({
          address: OLD_POOLS_REGISTRY[chain],
          abi: positionRegistryAbi,
          functionName: "unclaimedRewards",
          args: [account],
        }) as Promise<bigint>,
      getClients: async (row): Promise<ClaimClients> => {
        const client = walletClientRef.current;
        if (!client) throw new Error("Connect your wallet first.");
        return { publicClient: PUBLIC_CLIENTS[row.chain], walletClient: client as unknown as ClaimClients["walletClient"] };
      },
    };
  }, [address, switchChainAsync]);

  /** The estimated network fee of each row in USD, or null where it couldn't be estimated. */
  const estimateFees = useCallback(
    async (planInputs: readonly ClaimRowInput[], rowDeps: ClaimRowDeps) => {
      const entries = await Promise.all(
        planInputs.map(async (input) => {
          const id = `${input.kind}:${input.chain}`;
          const estimate = async () => {
            const row = buildClaimPlan([input], { telUsd })[0];
            const claim = await freshClaim(row, rowDeps);
            if (!claim) return null;
            const [feeWei, prices] = await Promise.all([
              estimateClaimFeeWei(PUBLIC_CLIENTS[input.chain], rowDeps.account, claim.request),
              fetchSwapPrices(input.chain, [NATIVE_TOKEN]),
            ]);
            const nativeUsd = prices[NATIVE_TOKEN.toLowerCase()];
            return feeWei === null || nativeUsd === undefined ? null : Number(formatUnits(feeWei, 18)) * nativeUsd;
          };
          const fee = await withTimeout(estimate().catch(() => null), FEE_ESTIMATE_TIMEOUT_MS, null);
          return [id, fee] as const;
        })
      );
      return Object.fromEntries(entries);
    },
    [telUsd]
  );

  const open = useCallback(async () => {
    if (!deps || inputs.length === 0) return;
    const attempt = ++preparingRef.current;
    setResult(null);
    setStatuses({});
    setPhase("preparing");
    const feesUsd = await estimateFees(inputs, deps);
    if (attempt !== preparingRef.current) return;
    setRows(buildClaimPlan(inputs, { currentChainId: chainIdRef.current, telUsd, feesUsd }));
    setPhase("review");
  }, [deps, inputs, estimateFees, telUsd]);

  const toggle = useCallback((id: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, checked: !row.checked } : row)));
  }, []);

  const start = useCallback(async () => {
    if (!deps) return;
    const planned = rows.filter((row) => row.checked);
    if (planned.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    try {
      const outcome = await runExclusive(() =>
        runClaimPlan({
          rows: planned,
          deps,
          signal: controller.signal,
          onStatus: (rowId, status) => {
            setStatuses((current) => ({ ...current, [rowId]: status }));
            if (status.state !== "failed") setPhase((current) => (current === "paused" ? "running" : current));
          },
          awaitDecision: () =>
            new Promise<ClaimDecision>((resolve) => {
              setPhase("paused");
              decisionRef.current = (decision) => {
                decisionRef.current = null;
                setPhase("running");
                resolve(decision);
              };
            }),
          onClaimed: (row) => onClaimedRef.current(row),
        })
      );
      setResult(outcome);
      setPhase((current) => (current === "closed" ? "closed" : "done"));
    } catch (error) {
      setResult({ claimed: [], stopped: true });
      setStatuses((current) => {
        const next = { ...current };
        const reason = error instanceof Error ? error.message : "The claims could not start.";
        planned.forEach((row) => (next[row.id] = { state: "skipped", reason }));
        return next;
      });
      setPhase((current) => (current === "closed" ? "closed" : "done"));
    } finally {
      abortRef.current = null;
    }
  }, [deps, rows]);

  const decide = useCallback((decision: ClaimDecision) => {
    decisionRef.current?.(decision);
  }, []);

  /** Closes the panel. A run in progress stops after its current transaction. */
  const close = useCallback(() => {
    preparingRef.current += 1;
    abortRef.current?.abort();
    decisionRef.current?.("stop");
    setPhase("closed");
  }, []);

  const disabledReason = useMemo(() => {
    if (!address) return "Connect a wallet to claim.";
    if (claimRunning && phase === "closed") return "A claim is in progress.";
    if (inputs.length === 0) return "Nothing to claim yet.";
    return null;
  }, [address, claimRunning, phase, inputs.length]);

  return {
    label: claimAllLabel(inputs),
    disabledReason,
    phase,
    rows,
    statuses,
    result,
    open,
    toggle,
    start,
    decide,
    close,
  };
}

export type ClaimAll = ReturnType<typeof useClaimAll>;

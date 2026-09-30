import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SettleObservation,
  SettleStatus,
  VaultLifecycleStatus,
  VaultOperation,
} from "@/web3/eusdVault/types";

export type VaultSettlePollingInput = Readonly<{
  status: VaultLifecycleStatus;
  kind?: VaultOperation;
  /** The submitted amount. An approve settles when the allowance covers it. */
  amountIn?: bigint;
  /** The receipt's block. A swap settles when the page read reaches it. */
  confirmedBlock?: bigint;
  /** Re-reads the page state. A rejection counts as not settled yet. */
  refetch(): Promise<SettleObservation>;
  /** Called once per confirmed cycle, when the expected post-state is visible. */
  onSettled(): void;
  /**
   * The page's own read already shows the expected post-state. Settles at once, before or after the bounded
   * poll, so a lagging refetch can never hold the page in the confirmed state.
   */
  observed?: boolean;
  intervalMs?: number;
  maxMs?: number;
}>;

export type VaultSettlePolling = Readonly<{
  settle: SettleStatus;
  /** After a timeout, starts a new bounded poll. Does nothing otherwise. */
  refresh(): void;
}>;

const INTERVAL_MS = 2_000;
const MAX_MS = 30_000;

type Phase = Exclude<SettleStatus, "idle">;

type SettleTarget = Readonly<{ amountIn?: bigint; confirmedBlock?: bigint }>;

/**
 * Whether a page read shows what a confirmed transaction promised. An approve needs the allowance to cover the
 * submitted amount (not the current balance); a swap needs a read taken at or after the receipt's block. A
 * missing value never settles.
 */
export function settleSatisfied(kind: VaultOperation, o: SettleObservation, t: SettleTarget): boolean {
  if (kind === "approve") {
    return o.allowanceIn !== undefined && t.amountIn !== undefined && o.allowanceIn >= t.amountIn;
  }
  if (kind === "swap") {
    return o.blockNumber !== undefined && t.confirmedBlock !== undefined && o.blockNumber >= t.confirmedBlock;
  }
  return false;
}

// The refetch result is evaluated rather than the query cache, so a lagging RPC that still returns the old state
// keeps the poll going.
async function observedPostState(
  refetch: () => Promise<SettleObservation>,
  kind: VaultOperation,
  target: SettleTarget
): Promise<boolean> {
  try {
    return settleSatisfied(kind, await refetch(), target);
  } catch {
    return false;
  }
}

/**
 * After a confirmed transaction, re-reads the page state on a bounded schedule until the chain state the receipt
 * promised is visible, then hands control back through `onSettled`.
 */
export function useVaultSettlePolling(i: VaultSettlePollingInput): VaultSettlePolling {
  const { status, kind, amountIn, confirmedBlock, intervalMs = INTERVAL_MS, maxMs = MAX_MS } = i;
  const active = status === "confirmed" && kind !== undefined;
  const observed = i.observed === true;

  const [phase, setPhase] = useState<Phase>("polling");
  // Identifies one stay in `confirmed`, so `onSettled` fires at most once per stay.
  const [cycle, setCycle] = useState(0);
  // Each entry into `confirmed` starts a fresh cycle; adjusting state during render avoids a one-render flash of
  // the previous cycle's result.
  const [previousStatus, setPreviousStatus] = useState(status);
  if (status !== previousStatus) {
    setPreviousStatus(status);
    if (status === "confirmed") {
      setPhase("polling");
      setCycle((c) => c + 1);
    }
  }

  const callbacksRef = useRef({ refetch: i.refetch, onSettled: i.onSettled });
  useEffect(() => {
    callbacksRef.current = { refetch: i.refetch, onSettled: i.onSettled };
  });

  // Shared across poll runs: a refetch still in flight from an earlier run delays the next one instead of
  // overlapping it.
  const inFlightRef = useRef(false);
  const settledCycleRef = useRef<number | undefined>(undefined);

  const markSettled = useCallback(() => {
    if (settledCycleRef.current === cycle) return;
    settledCycleRef.current = cycle;
    setPhase("settled");
    callbacksRef.current.onSettled();
  }, [cycle]);

  useEffect(() => {
    if (active && observed) markSettled();
  }, [active, observed, markSettled]);

  // A settled or timed-out phase stops the poll; `refresh` puts the phase back to polling, which starts a new one.
  const polling = active && !observed && phase === "polling";
  useEffect(() => {
    if (!polling || kind === undefined) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const target: SettleTarget = { amountIn, confirmedBlock };

    const tick = async () => {
      if (inFlightRef.current) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      inFlightRef.current = true;
      const settled = await observedPostState(callbacksRef.current.refetch, kind, target);
      inFlightRef.current = false;
      if (cancelled) return;

      if (settled) {
        markSettled();
        return;
      }
      if (Date.now() - startedAt >= maxMs) {
        setPhase("timed-out");
        return;
      }
      timer = setTimeout(tick, intervalMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [polling, kind, amountIn, confirmedBlock, intervalMs, maxMs, markSettled]);

  const refresh = useCallback(() => {
    if (active && !observed && phase === "timed-out") setPhase("polling");
  }, [active, observed, phase]);

  return { settle: !active ? "idle" : observed ? "settled" : phase, refresh };
}

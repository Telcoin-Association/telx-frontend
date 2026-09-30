import { isAddressEqual, type Hash } from "viem";
import { isUserRejection } from "@/lib/walletErrors";
import { getVaultDeployment, routeFor } from "./deployments";
import {
  AppError,
  CANCELLED_MESSAGE,
  ProvidersDisagreeError,
  SWITCH_NETWORK_MESSAGE,
  VaultStateChangedError,
} from "./errors";
import { abortError, asError, backoffMs, isAbortError, sameHash } from "./internal";
import {
  clearPendingRecord,
  isPendingExpired,
  isSmartAccount,
  pendingDeadline,
  pendingStorageKey,
  pendingTtlMs,
  readPendingRecord,
  shouldClearPending,
  writePendingRecord,
} from "./pendingRecords";
import { PREFLIGHT_TIMEOUT_MS, runVaultPreflight, withTimeout } from "./preflight";
import { VAULT_WATCHER_TIMINGS, watchReceipt } from "./receiptWatcher";
import type {
  CompletedSwap,
  LifecycleFailure,
  PendingContext,
  PendingSummary,
  SettledApproval,
  SwapDirection,
  VaultDeployment,
  VaultLifecycleDeps,
  VaultLifecycleState,
  VaultLifecycleStatus,
  VaultLifecycleStore,
  VaultLiveState,
  VaultOperation,
  VaultPendingRecord,
  VaultRequest,
  WalletInput,
  WalletSession,
  WatchOutcome,
  WatchProgress,
} from "./types";

type Internal = Readonly<{
  status: VaultLifecycleStatus;
  kind?: VaultOperation;
  direction?: SwapDirection;
  hash?: Hash;
  amountIn?: bigint;
  confirmedBlock?: bigint;
  /** The record this store tracks: its own submission, or one adopted from storage. */
  record?: VaultPendingRecord;
  expired: boolean;
  attempt: number;
  /** The in-flight attempt's account type, kept after its record is cleared. */
  smartAccount: boolean;
  failure?: LifecycleFailure;
  completed?: CompletedSwap;
  settledExternally?: SettledApproval;
  /** A submission is between the click and its persisted record. */
  locked: boolean;
}>;

const IDLE_INTERNAL: Internal = Object.freeze({ status: "idle", expired: false, attempt: 0, smartAccount: false, locked: false });

const SERVER_STATE: VaultLifecycleState = Object.freeze({ status: "idle", smartAccount: false, canSubmit: false });

const CONTEXT_CHANGED_MESSAGE = "Your wallet's account or network changed. Review the form and try again.";

const CONFLICT_MESSAGE =
  "Your transaction was sent, but this page is already tracking a different transaction for this wallet. Check the explorer for the new transaction before sending another.";

const RESUME_MISMATCH_MESSAGE = "The wallet session opened for a pending transaction is on another account or network.";

type Prepared = Readonly<{ session: WalletSession; deployment: VaultDeployment; smartAccount: boolean }>;

type Watcher = Readonly<{ controller: AbortController; hash: Hash }>;

function contextKey(context: PendingContext | undefined): string | undefined {
  return context ? pendingStorageKey(context) : undefined;
}

/**
 * The tracked record is let go without an outcome this tab verified: another tab settled or dismissed it, live state
 * showed it settled, or the user dismissed it. A failure this tab is showing stays; anything else returns to idle.
 */
function released(current: Internal): Internal {
  const base: Internal = { ...current, record: undefined, expired: false, attempt: 0 };
  if (current.status === "failed") return base;
  return {
    ...base,
    status: "idle",
    kind: undefined,
    direction: undefined,
    hash: undefined,
    amountIn: undefined,
    confirmedBlock: undefined,
  };
}

function withExpired(current: Internal): Internal {
  const waiting = current.status === "confirming" || current.status === "verifying";
  return { ...current, status: waiting ? "idle" : current.status, expired: true, attempt: 0 };
}

/** Anything thrown before the watch. `preparing` is true for errors from the session, identity and preflight step. */
function classifySubmitError(error: unknown, preparing: boolean): LifecycleFailure {
  if (isUserRejection(error)) {
    return { reason: "rejected", error: new AppError(CANCELLED_MESSAGE, { tone: "info", cause: error }) };
  }
  if (error instanceof ProvidersDisagreeError) return { reason: "providers-disagree", error };
  if (error instanceof VaultStateChangedError) return { reason: "state-changed", error };
  return { reason: preparing ? "preflight" : "unknown", error: asError(error) };
}

function summarize(record: VaultPendingRecord, i: Internal): PendingSummary {
  return {
    kind: record.kind,
    direction: record.direction,
    hash: record.hash,
    amountIn: record.amountIn,
    expired: i.expired,
    smartAccount: record.smartAccount,
    attempt: i.attempt,
  };
}

function toPublicState(i: Internal, connected: boolean): VaultLifecycleState {
  const { record } = i;
  return {
    status: i.status,
    kind: i.kind,
    direction: i.direction,
    hash: i.hash,
    amountIn: i.amountIn,
    confirmedBlock: i.confirmedBlock,
    smartAccount: i.locked || !record ? i.smartAccount : record.smartAccount,
    pending: record ? summarize(record, i) : undefined,
    failure: i.failure,
    completed: i.completed,
    settledExternally: i.settledExternally,
    canSubmit:
      connected && !i.locked && (!record || i.expired) && (i.status === "idle" || i.status === "failed"),
  };
}

function buildRecord(
  request: VaultRequest,
  prepared: Prepared,
  hash: Hash,
  submittedAt: number
): VaultPendingRecord {
  const { session, deployment, smartAccount } = prepared;
  const route = routeFor(deployment, request.direction);
  const base = {
    version: 1 as const,
    hash,
    direction: request.direction,
    amountIn: request.amountIn,
    chainId: deployment.chainId,
    address: session.address,
    connectorId: session.connectorId,
    smartAccount,
    submittedAt,
    expiresAt: submittedAt + pendingTtlMs(smartAccount),
    vault: deployment.vault,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
  };
  return request.kind === "approve"
    ? { ...base, kind: "approve" }
    : { ...base, kind: "swap", quotedOut: request.quote.amountOut, quotedFee: request.quote.fee };
}

/**
 * The one vault transaction the page can have in flight, from the click to a verified receipt: preflight on both
 * providers, the wallet prompt, a pending record persisted before the watch, and the watch's outcome. Framework-free;
 * the hook feeds it the wallet and live state and subscribes to its snapshots.
 *
 * Storage is the source of truth for which transaction is pending. A record stored before a reload, or written by
 * another tab, is adopted and watched through a resumed session; a record that disappears from storage was settled
 * or dismissed elsewhere and is let go.
 *
 * Every async continuation carries the generation it started under. A wallet change or `dispose` bumps the
 * generation and aborts what is in flight, so a late answer from an abandoned attempt changes nothing, with one
 * exception: a hash the wallet returns late is still persisted under the context it was sent from, because that
 * transaction exists.
 */
export function createVaultLifecycleStore(deps: VaultLifecycleDeps): VaultLifecycleStore {
  const listeners = new Set<() => void>();
  let internal: Internal = IDLE_INTERNAL;
  let snapshot: VaultLifecycleState = SERVER_STATE;
  let generation = 0;
  let wallet: WalletInput | undefined;
  let submission: AbortController | undefined;
  /** The tracked record's watch, including the session being reopened for a resumed record. */
  let watcher: Watcher | undefined;
  /** The TTL timer of a live record tracked without a watch. */
  let expiry: AbortController | undefined;
  /** Cuts short the wait before the next attempt to reopen a resumed record's session. */
  let resumeWake: AbortController | undefined;
  /** This tab's own record when storage did not keep it. */
  let unpersistedHash: Hash | undefined;
  let unsubscribeStorage: (() => void) | undefined;

  const sleep = (ms: number, signal?: AbortSignal) => deps.sleep(ms, signal);
  const now = () => deps.now();

  function log(level: "warn" | "error", message: string, error: unknown): void {
    try {
      deps.logger?.[level](message, error);
    } catch {
      // A broken logger must not break the transaction flow.
    }
  }

  function publish(): void {
    snapshot = toPublicState(internal, wallet?.context !== undefined);
    [...listeners].forEach((listener) => listener());
  }

  function commit(gen: number, update: (current: Internal) => Internal): void {
    if (gen !== generation) return;
    const next = update(internal);
    if (next === internal) return;
    internal = next;
    publish();
  }

  function abortWatcher(): void {
    watcher?.controller.abort();
    watcher = undefined;
  }

  function cancelExpiry(): void {
    expiry?.abort();
    expiry = undefined;
  }

  /** Stops whatever follows the tracked record: its watch or its TTL timer. */
  function stopTracking(): void {
    abortWatcher();
    cancelExpiry();
  }

  /** Invalidates every attempt, watch and timer started under the current generation. Does not publish. */
  function abandonAll(): void {
    generation += 1;
    submission?.abort();
    submission = undefined;
    stopTracking();
  }

  function handleOutcome(gen: number, record: VaultPendingRecord, outcome: WatchOutcome): void {
    switch (outcome.type) {
      case "confirmed": {
        clearPendingRecord(deps.storage, record, record.hash);
        const { receipt, swap } = outcome;
        if (record.kind === "swap" && swap === undefined) {
          log("error", "Confirmed vault swap carried no Swap amounts", receipt.transactionHash);
        }
        commit(gen, (current) => ({
          ...current,
          status: "confirmed",
          kind: record.kind,
          direction: record.direction,
          hash: record.hash,
          amountIn: record.amountIn,
          confirmedBlock: receipt.blockNumber,
          record: undefined,
          expired: false,
          attempt: 0,
          failure: undefined,
          completed:
            record.kind === "swap" && swap !== undefined
              ? {
                  direction: record.direction,
                  amountOut: swap.amountOut,
                  fee: swap.fee,
                  quotedOut: record.quotedOut,
                  transactionHash: receipt.transactionHash,
                  chainId: record.chainId,
                }
              : current.completed,
        }));
        return;
      }
      case "failed":
        // A cancelled transaction will never land and a reverted one already did, so nothing is left to track.
        clearPendingRecord(deps.storage, record, record.hash);
        if (outcome.reason === "verification") log("error", "Vault transaction verification failed", outcome.error);
        commit(gen, (current) => ({
          ...current,
          status: "failed",
          record: undefined,
          expired: false,
          attempt: 0,
          failure: { reason: outcome.reason, error: outcome.error },
        }));
        return;
      case "expired":
        commit(gen, (current) => ({ ...current, status: "idle", expired: true, attempt: 0 }));
        return;
      case "aborted":
        return;
    }
  }

  /** Watches `record` through the session it was sent or resumed with. Only one watch runs at a time. */
  function startWatch(gen: number, record: VaultPendingRecord, session: WalletSession): void {
    abortWatcher();
    const active: Watcher = { controller: new AbortController(), hash: record.hash };
    watcher = active;

    const onProgress = ({ attempt, phase, lastError }: WatchProgress) => {
      if (lastError !== undefined) log("warn", "Vault receipt wait retried", lastError);
      if (watcher !== active) return;
      commit(gen, (current) =>
        sameHash(current.record?.hash, record.hash) &&
        (current.status === "confirming" || current.status === "verifying")
          ? { ...current, attempt, status: phase === "verifying" ? "verifying" : "confirming" }
          : current
      );
    };

    Promise.resolve()
      .then(() => watchReceipt(record, { ...session.watcherDeps(record), now, sleep, onProgress }, active.controller.signal))
      .catch((error: unknown): WatchOutcome => {
        log("error", "Vault receipt watcher failed", error);
        return { type: "aborted" };
      })
      .then((outcome) => {
        if (gen !== generation || watcher !== active) return;
        watcher = undefined;
        handleOutcome(gen, record, outcome);
        // A watch that broke without an outcome leaves its record tracked, and the TTL must still surface.
        if (outcome.type === "aborted" && sameHash(internal.record?.hash, record.hash) && !internal.expired) {
          scheduleExpiry(gen, record);
        }
      });
  }

  /** Opens a session for a record this tab did not send in this page load, refusing one on another account or chain. */
  async function openResumedSession(record: VaultPendingRecord): Promise<WalletSession> {
    const session = await deps.resumeSession(record, wallet?.connector);
    if (session.chainId !== record.chainId || !isAddressEqual(session.address, record.address)) {
      throw new AppError(RESUME_MISMATCH_MESSAGE);
    }
    return session;
  }

  async function waitToRetryResume(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const wake = new AbortController();
    const relay = () => wake.abort();
    signal.addEventListener("abort", relay, { once: true });
    resumeWake = wake;
    try {
      await sleep(ms, wake.signal);
    } finally {
      signal.removeEventListener("abort", relay);
      if (resumeWake === wake) resumeWake = undefined;
    }
  }

  /**
   * Reopens the wallet session for an adopted record, then watches it as the submit path does. After a reload the
   * connector may not be ready yet, or may not serve the record's chain and account right now. The transaction is out
   * there either way, so the record stays stored, the form stays locked on the pending notice (nothing can be sent
   * again) and the session is retried with backoff until it opens or the TTL passes. `setWallet` retries at once
   * with the connector it brings.
   */
  function resumeWatch(gen: number, record: VaultPendingRecord): void {
    const active: Watcher = { controller: new AbortController(), hash: record.hash };
    watcher = active;
    const stale = () => gen !== generation || watcher !== active;

    const run = async (): Promise<void> => {
      for (let failures = 1; ; failures += 1) {
        if (isPendingExpired(record, now())) {
          watcher = undefined;
          handleOutcome(gen, record, { type: "expired" });
          return;
        }
        let session: WalletSession;
        try {
          session = await openResumedSession(record);
        } catch (error) {
          if (stale()) return;
          // Only logged: `attempt` counts receipt waits that timed out, which a session that has not reopened is not.
          log("warn", "Vault wallet session for a pending transaction unavailable, retrying", error);
          await waitToRetryResume(backoffMs(failures, VAULT_WATCHER_TIMINGS), active.controller.signal);
          if (stale()) return;
          continue;
        }
        if (stale()) return;
        startWatch(gen, record, session);
        return;
      }
    };
    run().catch((error: unknown) => {
      log("error", "Resuming a vault transaction failed", error);
    });
  }

  /** Marks the tracked record expired unless a watch is running; a watch applies the TTL until it sees a receipt. */
  function surfaceExpiry(gen: number, record: VaultPendingRecord): void {
    if (watcher) return;
    commit(gen, (current) =>
      !current.expired && sameHash(current.record?.hash, record.hash) ? withExpired(current) : current
    );
  }

  /** Surfaces the TTL of a live record tracked without a watch, without waiting for a reload. */
  function scheduleExpiry(gen: number, record: VaultPendingRecord): void {
    cancelExpiry();
    const timer = new AbortController();
    expiry = timer;
    const run = async (): Promise<void> => {
      while (!isPendingExpired(record, now())) {
        // The stored expiry is capped: a raw one can lie past the deadline, or beyond `setTimeout`'s 2^31-1 ms limit,
        // where the timer fires at once and this loop spins. A live record's deadline is at most two TTLs away.
        await sleep(pendingDeadline(record) - now(), timer.signal);
        if (timer.signal.aborted || gen !== generation) return;
      }
      if (expiry === timer) expiry = undefined;
      surfaceExpiry(gen, record);
    };
    run().catch((error: unknown) => {
      log("error", "Vault pending transaction timer failed", error);
    });
  }

  /**
   * Tracks a record this tab did not send in this page load: one stored before a reload, or written by another tab.
   * A live one is watched here too, so both tabs report its outcome; an expired one is shown and not watched.
   *
   * With `watch` false the record is tracked without a watch. The submit path asks for that when it lost the write to
   * another tab: that tab is watching the record it just wrote, and this tab keeps its own conflict failure on screen
   * (a watch here would replace it with the other transaction's outcome). Its TTL timer bounds the lock.
   */
  function adoptRecord(gen: number, record: VaultPendingRecord, watch: boolean): void {
    stopTracking();
    const expired = isPendingExpired(record, now());
    commit(gen, (current) =>
      watch
        ? {
            ...IDLE_INTERNAL,
            completed: current.completed,
            settledExternally: current.settledExternally,
            status: expired ? "idle" : "confirming",
            kind: record.kind,
            direction: record.direction,
            hash: record.hash,
            amountIn: record.amountIn,
            record,
            expired,
            smartAccount: record.smartAccount,
          }
        : { ...current, record, expired, attempt: 0 }
    );
    if (gen !== generation || expired) return;
    if (watch) resumeWatch(gen, record);
    else scheduleExpiry(gen, record);
  }

  /**
   * Aligns memory with storage, which is the source of truth for which transaction is pending. Safe to call at any
   * time; skipped mid-submission, where the slot is about to be rewritten by the compare-and-set that follows the
   * signature.
   */
  function reconcile(gen: number, watch = true): void {
    const context = wallet?.context;
    if (gen !== generation || !context || internal.locked) return;
    const stored = readPendingRecord(deps.storage, context);
    const tracked = internal.record;

    if (!stored) {
      if (!tracked || sameHash(tracked.hash, unpersistedHash)) return;
      // Another tab settled or dismissed it. This tab verified nothing, so it reports nothing.
      stopTracking();
      commit(gen, released);
      return;
    }

    if (tracked && sameHash(tracked.hash, stored.hash)) {
      if (!internal.expired && isPendingExpired(tracked, now())) surfaceExpiry(gen, tracked);
      return;
    }

    adoptRecord(gen, stored, watch);
  }

  /** Opens the session, checks it against the context the user clicked under, and runs the preflight. */
  async function prepare(request: VaultRequest, context: PendingContext, signal: AbortSignal): Promise<Prepared> {
    const halted = () => {
      if (signal.aborted) throw abortError();
    };
    const session = await deps.openSession();
    halted();
    if (
      session.chainId !== context.chainId ||
      !isAddressEqual(session.address, context.address) ||
      session.connectorId !== context.connectorId
    ) {
      throw new AppError(CONTEXT_CHANGED_MESSAGE, { tone: "warning" });
    }
    const deployment = getVaultDeployment(session.chainId);
    if (!deployment) throw new AppError(SWITCH_NETWORK_MESSAGE);

    const smartAccount = isSmartAccount(session.connectorId, await session.source.getCode(session.address));
    halted();

    const appSource = deps.appSource(deployment.chainId);
    if (!appSource) {
      throw new AppError("The configured RPC for this network is unavailable. Reload the page and try again.");
    }
    await runVaultPreflight(request, deployment, session.address, { rpc: appSource, wallet: session.source }, {
      sleep,
      signal,
    });
    halted();
    return { session, deployment, smartAccount };
  }

  /** Bounds `prepare` by the preflight timeout; once the race is decided the work left behind is halted. */
  async function prepareWithin(request: VaultRequest, context: PendingContext, signal: AbortSignal): Promise<Prepared> {
    const halt = new AbortController();
    const relay = () => halt.abort();
    signal.addEventListener("abort", relay, { once: true });
    try {
      return await withTimeout(prepare(request, context, halt.signal), PREFLIGHT_TIMEOUT_MS, { sleep, signal });
    } finally {
      halt.abort();
      signal.removeEventListener("abort", relay);
    }
  }

  async function runSubmit(request: VaultRequest): Promise<void> {
    const context = wallet?.context;
    if (!snapshot.canSubmit || !context) {
      log("warn", `Refused to submit a vault ${request.kind}: no wallet, or a transaction is in progress`, undefined);
      return;
    }

    // Locked before the first await, so a second click cannot start another attempt.
    const gen = generation;
    const controller = new AbortController();
    submission = controller;
    commit(gen, (current) => ({
      ...current,
      status: "preflight",
      kind: request.kind,
      direction: request.direction,
      amountIn: request.amountIn,
      hash: undefined,
      confirmedBlock: undefined,
      smartAccount: false,
      failure: undefined,
      settledExternally: undefined,
      locked: true,
    }));

    const abandoned = () => gen !== generation || controller.signal.aborted;
    let preparing = true;
    let sentHash: Hash | undefined;
    try {
      const prepared = await prepareWithin(request, context, controller.signal);
      if (abandoned()) return;
      preparing = false;

      const { session, deployment, smartAccount } = prepared;
      commit(gen, (current) => ({ ...current, status: "signing", smartAccount }));
      const route = routeFor(deployment, request.direction);
      const hash =
        request.kind === "approve"
          ? await session.sendApprove(route.tokenIn, deployment.vault, request.amountIn)
          : await session.sendSwap(deployment.vault, route.swapFunction, session.address, request.amountIn);
      sentHash = hash;

      // The transaction exists even if this attempt was abandoned while the wallet was open, so it is persisted
      // under the context it was sent from and a later visit with that wallet can resume it.
      const record = buildRecord(request, prepared, hash, now());
      const written = writePendingRecord(deps.storage, record, undefined, record.submittedAt);
      if (abandoned()) return;

      if (!written) {
        // Another tab stored a live transaction for this wallet while this one was signing. This tab's transaction
        // is real but untracked; say so, keep its hash for the explorer link, and track the stored one instead.
        log("warn", "Vault pending record lost to another tab", hash);
        commit(gen, (current) => ({
          ...current,
          status: "failed",
          hash,
          failure: { reason: "unknown", error: new AppError(CONFLICT_MESSAGE, { tone: "warning" }) },
          locked: false,
        }));
        reconcile(gen, false);
        return;
      }

      // Blocked or full storage keeps nothing, and the record then lives only in memory: its missing entry is not
      // another tab settling it.
      unpersistedHash = sameHash(readPendingRecord(deps.storage, record)?.hash, hash) ? undefined : hash;
      commit(gen, (current) => ({
        ...current,
        status: "confirming",
        hash,
        record,
        expired: false,
        attempt: 0,
        smartAccount,
        locked: false,
      }));
      startWatch(gen, record, session);
    } catch (error) {
      if (abandoned()) return;
      if (isAbortError(error)) {
        commit(gen, (current) => ({ ...current, status: "idle", locked: false }));
        return;
      }
      const failure = classifySubmitError(error, preparing);
      if (failure.reason === "preflight" || failure.reason === "unknown") {
        log("warn", `Vault ${request.kind} failed`, error);
      }
      commit(gen, (current) => ({
        ...current,
        status: "failed",
        failure,
        hash: sentHash ?? current.hash,
        locked: false,
      }));
    } finally {
      if (submission === controller) submission = undefined;
      // Storage events are skipped while locked, so a record another tab wrote meanwhile is picked up now; otherwise
      // this tab would offer a submit that could only lose the write after the user signed.
      reconcile(gen);
    }
  }

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    getServerSnapshot: () => SERVER_STATE,

    setWallet(input: WalletInput) {
      const previous = wallet;
      wallet = input;
      const key = contextKey(input.context);
      if (input.walletKey !== previous?.walletKey || key !== contextKey(previous?.context)) {
        // A new account, chain or connector, or no wallet at all: whatever the old one had in flight is abandoned
        // silently. A watch never outlives its wallet, whose client can follow an injected wallet to another network;
        // the record stays stored and is resumed when that wallet and chain return.
        abandonAll();
        unsubscribeStorage?.();
        unsubscribeStorage = undefined;
        internal = IDLE_INTERNAL;
        publish();
      }
      if (key === undefined) return;
      if (!unsubscribeStorage) {
        const gen = generation;
        unsubscribeStorage = deps.storage.subscribe(key, () => reconcile(gen));
      }
      reconcile(generation);
      // A resumed record whose session did not open tries again now, with the connector this call brought.
      resumeWake?.abort();
    },

    setLive(live: VaultLiveState) {
      const { record } = internal;
      // Mid-submission the slot is about to be rewritten by the compare-and-set that follows the signature. Only an
      // approve can be settled by live state (`shouldClearPending`).
      if (!record || internal.locked || !shouldClearPending(record, live)) return;
      stopTracking();
      clearPendingRecord(deps.storage, record, record.hash);
      commit(generation, (current) => ({
        ...released(current),
        settledExternally: { hash: record.hash },
      }));
    },

    submit(request: VaultRequest): Promise<void> {
      return runSubmit(request).catch((error: unknown) => {
        log("error", "Vault submission failed unexpectedly", error);
      });
    },

    acknowledge() {
      commit(generation, (current) => {
        const finished = current.status === "confirmed" || current.status === "failed";
        if (!finished && current.settledExternally === undefined) return current;
        return {
          ...current,
          status: finished ? "idle" : current.status,
          failure: current.status === "failed" ? undefined : current.failure,
          settledExternally: undefined,
        };
      });
    },

    dismissPending() {
      const { record } = internal;
      if (!record || internal.locked) return;
      // A smart account may never report a receipt, so its record can be dismissed at any time (spec "Smart-contract
      // wallets"); an EOA's only once it expired.
      if (!internal.expired && !record.smartAccount) return;
      stopTracking();
      clearPendingRecord(deps.storage, record, record.hash);
      commit(generation, released);
    },

    done() {
      if (internal.completed === undefined) return;
      commit(generation, (current) => ({ ...current, completed: undefined }));
    },

    dispose() {
      abandonAll();
      unsubscribeStorage?.();
      unsubscribeStorage = undefined;
      // Forget the wallet so a remount (StrictMode replays effects) starts again from setWallet and storage instead
      // of assuming the aborted work is still running.
      wallet = undefined;
    },
  });
}

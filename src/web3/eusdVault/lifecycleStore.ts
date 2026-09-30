import { isAddressEqual, type Hash } from "viem";
import { isUserRejection } from "@/lib/walletErrors";
import { getVaultDeployment, routeFor } from "./deployments";
import { AppError, ProvidersDisagreeError, VaultStateChangedError } from "./errors";
import {
  clearPendingRecord,
  isPendingExpired,
  isSmartAccount,
  pendingTtlMs,
  readPendingRecord,
  writePendingRecord,
} from "./pendingRecords";
import { PREFLIGHT_TIMEOUT_MS, runVaultPreflight, withTimeout } from "./preflight";
import { watchReceipt } from "./receiptWatcher";
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

const CANCELLED_MESSAGE = "Wallet request cancelled. No transaction was sent.";

const CONTEXT_CHANGED_MESSAGE = "Your wallet's account or network changed. Review the form and try again.";

const CONFLICT_MESSAGE =
  "Your transaction was sent, but this page is already tracking a different transaction for this wallet. Check the explorer for the new transaction before sending another.";

type Prepared = Readonly<{ session: WalletSession; deployment: VaultDeployment; smartAccount: boolean }>;

type Watcher = Readonly<{ controller: AbortController; hash: Hash }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sameHash(a: Hash | undefined, b: Hash | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
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
    ...(record.kind === "swap" ? { quotedOut: record.quotedOut, quotedFee: record.quotedFee } : {}),
    chainId: record.chainId,
    submittedAt: record.submittedAt,
    expiresAt: record.expiresAt,
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
  let live: VaultLiveState = { allowances: {} };
  let submission: AbortController | undefined;
  let watcher: Watcher | undefined;
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

  /** Invalidates every attempt and watch started under the current generation. Does not publish. */
  function abandonAll(): void {
    generation += 1;
    submission?.abort();
    submission = undefined;
    abortWatcher();
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
                  amountIn: swap.amountIn,
                  amountOut: swap.amountOut,
                  fee: swap.fee,
                  quotedOut: record.quotedOut,
                  hash: record.hash,
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
      });
  }

  function adoptRecord(gen: number, record: VaultPendingRecord): void {
    const expired = isPendingExpired(record, now());
    commit(gen, (current) => ({ ...current, record, expired, attempt: 0 }));
    // U8d: resume a live record here: status "confirming" with kind, direction, hash and amountIn taken from the
    // record, then startWatch(gen, record, await deps.resumeSession(record, wallet?.connector)), dropped if the
    // generation moved on while the session opened. An expired record stays idle with `expired` set.
  }

  /**
   * Aligns memory with storage, which is the source of truth for which transaction is pending. Skipped mid-submission:
   * the slot is about to be rewritten by the compare-and-set that follows the signature.
   */
  function reconcile(gen: number): void {
    const context = wallet?.context;
    if (gen !== generation || !context || internal.locked) return;
    const stored = readPendingRecord(deps.storage, context);
    // U8d: no stored record while one is tracked (another tab cleared it) drops it; the same hash re-checks the
    // TTL and surfaces expiry.
    if (!stored || sameHash(internal.record?.hash, stored.hash)) return;
    adoptRecord(gen, stored);
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
    if (!deployment) throw new AppError("Switch to a supported network before swapping.");

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
        reconcile(gen);
        return;
      }

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
      if (input.walletKey !== previous?.walletKey) {
        // A new account, chain or connector: whatever the old one had in flight is abandoned silently.
        // U8d: an in-flight watch is aborted here; its record stays stored and is resumed when that wallet returns.
        abandonAll();
        internal = IDLE_INTERNAL;
        publish();
      } else if ((previous?.context === undefined) !== (input.context === undefined)) {
        publish();
      }
      // U8d: subscribe to pendingStorageKey(input.context) (unsubscribing on a change or when it is undefined) with
      // reconcile(generation) as the listener, then reconcile(generation) to resume a stored record.
    },

    setLive(next: VaultLiveState) {
      live = next;
      // U8d: clear an approve record that shouldClearPending(record, live) settles (never while locked), setting
      // settledExternally.
    },

    submit(request: VaultRequest): Promise<void> {
      return runSubmit(request).catch((error: unknown) => {
        log("error", "Vault submission failed unexpectedly", error);
      });
    },

    acknowledge() {
      if (internal.status === "confirmed") {
        commit(generation, (current) => ({ ...current, status: "idle" }));
      } else if (internal.status === "failed") {
        commit(generation, (current) => ({ ...current, status: "idle", failure: undefined }));
      }
    },

    dismissPending() {
      const { record } = internal;
      if (!record) return;
      // U8d: a smart-account record can be dismissed at any time (spec "Smart-contract wallets"); this keeps the
      // portal's rule that only an expired record is dismissed.
      if (!internal.expired) return;
      clearPendingRecord(deps.storage, record, record.hash);
      commit(generation, (current) => ({
        ...current,
        kind: undefined,
        direction: undefined,
        hash: undefined,
        amountIn: undefined,
        record: undefined,
        expired: false,
        attempt: 0,
      }));
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

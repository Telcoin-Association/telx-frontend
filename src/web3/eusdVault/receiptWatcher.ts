import type { TransactionReceipt } from "viem";
import { ReceiptVerificationError, TransactionReplacedError } from "./errors";
import { isPendingExpired } from "./pendingRecords";
import {
  approvalPostStateSatisfied,
  assertNotReplaced,
  classifyWaitError,
  confirmationsForChain,
  verifyVaultReceipt,
} from "./receiptVerification";
import type {
  ReceiptVerificationResult,
  ReceiptWatcherDeps,
  ReplacementReason,
  SmartAccountCallsStatus,
  SwapResult,
  VaultPendingRecord,
  WatchOutcome,
} from "./types";

/**
 * Receipt polling cadence and the bounds of each wait. A smart account's hash is a queue entry that can sit waiting
 * for co-signers, so it is polled less often and each wait runs longer. Between waits the watcher backs off
 * exponentially from `minBackoffMs` up to `maxBackoffMs`.
 */
export const VAULT_WATCHER_TIMINGS: Readonly<{
  pollingIntervalMs: number;
  smartAccountPollingIntervalMs: number;
  waitTimeoutMs: number;
  smartAccountWaitTimeoutMs: number;
  minBackoffMs: number;
  maxBackoffMs: number;
}> = Object.freeze({
  pollingIntervalMs: 4_000,
  smartAccountPollingIntervalMs: 10_000,
  waitTimeoutMs: 90_000,
  smartAccountWaitTimeoutMs: 120_000,
  minBackoffMs: 1_000,
  maxBackoffMs: 15_000,
});

/** Public RPCs can lag the block that mined the receipt by a second or two. */
export const VAULT_POST_STATE_RETRY_DELAY_MS = 1_500;

type FailureReason = Extract<WatchOutcome, { type: "failed" }>["reason"];

type Replacement = Readonly<{ reason: ReplacementReason }>;

type AllowanceRead = Readonly<{ ok: true; allowance: bigint }> | Readonly<{ ok: false; error: unknown }>;

const ABORTED: WatchOutcome = { type: "aborted" };
const EXPIRED: WatchOutcome = { type: "expired" };

function failed(reason: FailureReason, error: Error): WatchOutcome {
  return { type: "failed", reason, error };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function backoffMs(attempt: number): number {
  return Math.min(
    VAULT_WATCHER_TIMINGS.maxBackoffMs,
    VAULT_WATCHER_TIMINGS.minBackoffMs * 2 ** Math.max(0, attempt - 1)
  );
}

function confirmed(
  receipt: TransactionReceipt,
  swap: SwapResult | undefined,
  replacement: Replacement | undefined
): WatchOutcome {
  return {
    type: "confirmed",
    receipt,
    ...(swap === undefined ? {} : { swap }),
    ...(replacement?.reason === "repriced" ? { replacementReason: "repriced" as const } : {}),
  };
}

/** Maps a verification exception to the failure it should be reported as. */
function verificationFailure(error: unknown): WatchOutcome {
  if (error instanceof TransactionReplacedError) return failed(error.reason, error);
  if (error instanceof ReceiptVerificationError) {
    return failed(error.reason === "reverted" ? "reverted" : "verification", error);
  }
  // Anything else is a bug or a malformed receipt; verifying the same receipt again would fail the same way.
  return failed("verification", asError(error));
}

async function checkCallsStatus(
  r: VaultPendingRecord,
  deps: ReceiptWatcherDeps,
  signal: AbortSignal
): Promise<WatchOutcome | undefined> {
  if (!deps.getCallsStatus) return undefined;

  let status: SmartAccountCallsStatus | undefined;
  try {
    status = await deps.getCallsStatus(r.hash);
  } catch {
    // The queue status is advisory. The receipt wait is authoritative for anything that executes, so a failed status
    // call is not an error.
    status = undefined;
  }
  if (signal.aborted) return ABORTED;

  if (status?.statusCode === 400) return failed("cancelled", new TransactionReplacedError(r.kind, "cancelled"));
  if (status?.statusCode === 500) return failed("reverted", new ReceiptVerificationError(r.kind, "reverted"));
  return undefined;
}

async function readAllowance(deps: ReceiptWatcherDeps, blockNumber: bigint): Promise<AllowanceRead> {
  try {
    return { ok: true, allowance: await deps.readAllowanceAt(blockNumber) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Reads the allowance at the receipt's block and, when the read fails or falls short, reads once more after a pause
 * in case the node answering had not caught up with that block. The second read decides.
 */
async function verifyApprovalPostState(
  amountIn: bigint,
  receipt: TransactionReceipt,
  deps: ReceiptWatcherDeps,
  signal: AbortSignal,
  replacement: Replacement | undefined
): Promise<WatchOutcome> {
  const first = await readAllowance(deps, receipt.blockNumber);
  if (signal.aborted) return ABORTED;
  if (first.ok && approvalPostStateSatisfied(first.allowance, amountIn)) {
    return confirmed(receipt, undefined, replacement);
  }

  await deps.sleep(VAULT_POST_STATE_RETRY_DELAY_MS, signal);
  if (signal.aborted) return ABORTED;

  const second = await readAllowance(deps, receipt.blockNumber);
  if (signal.aborted) return ABORTED;
  if (!second.ok) {
    return failed("verification", new ReceiptVerificationError("approve", "unverifiable", { cause: second.error }));
  }
  if (!approvalPostStateSatisfied(second.allowance, amountIn)) {
    return failed("verification", new ReceiptVerificationError("approve", "post-state"));
  }
  return confirmed(receipt, undefined, replacement);
}

type Progress = { receiptSeen: boolean };

async function attemptOnce(
  r: VaultPendingRecord,
  deps: ReceiptWatcherDeps,
  signal: AbortSignal,
  attempt: number,
  progress: Progress
): Promise<WatchOutcome> {
  const { smartAccount } = r;

  if (smartAccount) {
    const statusOutcome = await checkCallsStatus(r, deps, signal);
    if (statusOutcome) return statusOutcome;
  }

  let replacement: Replacement | undefined;
  const receipt = await deps.waitForReceipt({
    hash: r.hash,
    confirmations: confirmationsForChain(r.chainId),
    pollingInterval: smartAccount
      ? VAULT_WATCHER_TIMINGS.smartAccountPollingIntervalMs
      : VAULT_WATCHER_TIMINGS.pollingIntervalMs,
    timeout: smartAccount ? VAULT_WATCHER_TIMINGS.smartAccountWaitTimeoutMs : VAULT_WATCHER_TIMINGS.waitTimeoutMs,
    // The same-sender-and-nonce heuristic has no meaning for a smart account, whose hash is not a transaction the
    // wallet signed with its own nonce.
    checkReplacement: !smartAccount,
    onReplaced: (replaced) => {
      replacement = { reason: replaced.reason };
    },
  });
  progress.receiptSeen = true;
  if (signal.aborted) return ABORTED;

  deps.onProgress?.({ attempt, phase: "verifying" });

  let verified: ReceiptVerificationResult;
  try {
    assertNotReplaced(r.kind, replacement);
    verified = verifyVaultReceipt({ record: r, receipt });
  } catch (error) {
    return verificationFailure(error);
  }

  // The swap's amounts come from its Swap event and may differ from the quote; that is still a confirmed swap.
  if (verified.kind === "swap") return confirmed(receipt, verified.swap, replacement);
  return verifyApprovalPostState(r.amountIn, receipt, deps, signal, replacement);
}

/**
 * Waits for a persisted vault transaction until it is verified, fails, expires or the caller aborts. Timeouts and
 * transient errors never end the watch: the transaction may still be pending, so the loop backs off and waits again.
 * The function never throws; every outcome is a value.
 */
export async function watchReceipt(
  r: VaultPendingRecord,
  deps: ReceiptWatcherDeps,
  signal: AbortSignal
): Promise<WatchOutcome> {
  let attempt = 0;
  const progress: Progress = { receiptSeen: false };

  for (;;) {
    if (signal.aborted) return ABORTED;
    // The TTL bounds the wait for a receipt. A mined transaction cannot expire, so once a receipt was seen only the
    // verification can still end the watch.
    if (!progress.receiptSeen && isPendingExpired(r, deps.now())) return EXPIRED;

    let lastError: unknown;
    try {
      return await attemptOnce(r, deps, signal, attempt, progress);
    } catch (error) {
      if (signal.aborted) return ABORTED;
      if (classifyWaitError(error) === "terminal") return failed("verification", asError(error));
      lastError = error;
    }

    attempt += 1;
    deps.onProgress?.({ attempt, phase: "waiting", lastError });
    await deps.sleep(backoffMs(attempt), signal);
  }
}

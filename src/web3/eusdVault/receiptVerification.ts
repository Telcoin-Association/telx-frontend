import {
  isAddressEqual,
  parseEventLogs,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, vaultAbi } from "./abis";
import { getVaultDeployment } from "./deployments";
import { ReceiptVerificationError, TransactionReplacedError } from "./errors";
import type {
  PendingApproveRecord,
  PendingSwapRecord,
  ReceiptVerificationResult,
  ReplacementReason,
  VaultOperation,
  VaultPendingRecord,
} from "./types";

/** Receipt confirmations to wait for on a chain. Unknown chains wait for one. */
export function confirmationsForChain(chainId: number): number {
  return getVaultDeployment(chainId)?.confirmations ?? 1;
}

/**
 * Rejects the receipt of a cancelled or replaced transaction. A repriced transaction carries the same call, so its
 * receipt is still the right one.
 */
export function assertNotReplaced(kind: VaultOperation, r: Readonly<{ reason: ReplacementReason }> | undefined): void {
  if (!r || r.reason === "repriced") return;
  throw new TransactionReplacedError(kind, r.reason);
}

/** The allowance read at the receipt's block covers what the approval was for. */
export function approvalPostStateSatisfied(allowance: bigint, amountIn: bigint): boolean {
  return allowance >= amountIn;
}

// Strict decoding drops logs whose topics or data do not fit the ABI, such as an ERC-721 Transfer with the same
// selector, instead of throwing.

function verifyApprove(record: PendingApproveRecord, receipt: TransactionReceipt): ReceiptVerificationResult {
  const approvals = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: "Approval", strict: true }).filter(
    (log) =>
      isAddressEqual(log.address, record.tokenIn) &&
      isAddressEqual(log.args.owner, record.address) &&
      isAddressEqual(log.args.spender, record.vault)
  );
  // Each Approval sets the allowance, so in a batch that approves more than once the last one is what stands.
  const last = approvals.at(-1);
  if (!last) throw new ReceiptVerificationError("approve", "missing-event");
  // A wallet may let the user raise the amount in its prompt, so more than requested is still a good approval.
  if (last.args.value < record.amountIn) throw new ReceiptVerificationError("approve", "post-state");
  return { kind: "approve" };
}

function verifySwap(record: PendingSwapRecord, receipt: TransactionReceipt): ReceiptVerificationResult {
  const swaps = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "Swap", strict: true });
  const transfers = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: "Transfer", strict: true });
  const hasTransfer = (token: Address, from: Address, to: Address, value: bigint) =>
    transfers.some(
      (log) =>
        isAddressEqual(log.address, token) &&
        isAddressEqual(log.args.from, from) &&
        isAddressEqual(log.args.to, to) &&
        log.args.value === value
    );

  for (const log of swaps) {
    const { sender, recipient, tokenIn, tokenOut, amountIn, amountOut, fee } = log.args;
    const matchesRecord =
      isAddressEqual(log.address, record.vault) &&
      isAddressEqual(sender, record.address) &&
      isAddressEqual(recipient, record.address) &&
      isAddressEqual(tokenIn, record.tokenIn) &&
      isAddressEqual(tokenOut, record.tokenOut) &&
      amountIn === record.amountIn &&
      amountOut > 0n;
    if (
      matchesRecord &&
      hasTransfer(record.tokenIn, record.address, record.vault, amountIn) &&
      hasTransfer(record.tokenOut, record.vault, record.address, amountOut)
    ) {
      // The amounts are what the vault did, which may differ from the quote; the vault page warns when they do.
      return { kind: "swap", swap: { amountIn, amountOut, fee } };
    }
  }
  throw new ReceiptVerificationError("swap", "missing-event");
}

/**
 * Checks that a mined receipt is the recorded operation: it succeeded and carries the events that prove it, emitted
 * by the contracts that matter. An approval needs the token's `Approval` for the vault; a swap needs the vault's
 * `Swap` for this wallet plus the token `Transfer`s in and out.
 *
 * Where the outer transaction was addressed is deliberately not checked: a smart account executes through its own
 * contract, so `receipt.to` is the account rather than the token or the vault even when the call is exactly the one
 * requested. The allowance read at the receipt's block is the watcher's job.
 */
export function verifyVaultReceipt(
  i: Readonly<{ record: VaultPendingRecord; receipt: TransactionReceipt }>
): ReceiptVerificationResult {
  const { record, receipt } = i;
  if (receipt.status !== "success") {
    throw new ReceiptVerificationError(record.kind, "reverted");
  }
  return record.kind === "approve" ? verifyApprove(record, receipt) : verifySwap(record, receipt);
}

function isErrorNamed(error: unknown, constructor: abstract new (...args: never[]) => Error, name: string): boolean {
  // Wallet SDKs bundle their own viem copies, so an error can be a viem error without passing instanceof for ours.
  return error instanceof constructor || (error instanceof Error && error.name === name);
}

/**
 * Sorts an error from the receipt wait into what the watcher should do. A timeout or a transient error means the
 * transaction may still be pending, so the watcher keeps waiting. Only errors produced by our own verification end
 * the wait. The wait only reads, so a wallet rejection raised during it says nothing about the transaction already
 * sent and is waited through like any other transient error.
 */
export function classifyWaitError(e: unknown): "transient" | "timeout" | "terminal" {
  if (isErrorNamed(e, WaitForTransactionReceiptTimeoutError, "WaitForTransactionReceiptTimeoutError")) {
    return "timeout";
  }
  if (e instanceof TransactionReplacedError || e instanceof ReceiptVerificationError) return "terminal";
  // HTTP, RPC, not-found, block-not-found, fetch and unknown errors all land here. An unknown error must never
  // re-enable submission while a transaction may still be in the mempool.
  return "transient";
}

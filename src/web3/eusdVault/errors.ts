import { isUserRejection } from "@/lib/walletErrors";
import type {
  ErrorDescription,
  ErrorTone,
  ReceiptVerificationReason,
  ReplacementReason,
  StateChange,
  VaultOperation,
} from "./types";

/**
 * Base class for errors whose message is written for the user, shown even when another error wraps it. Anything that
 * carries no AppError and is not a plain Error with a short single-line message or a viem BaseError is rendered as a
 * generic message instead of its raw text.
 */
export class AppError extends Error {
  readonly tone: ErrorTone;

  /** `tone` defaults to "error". `cause` is kept for logging and never rendered. */
  constructor(message: string, options?: Readonly<{ cause?: unknown; tone?: ErrorTone }>) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.tone = options?.tone ?? "error";
  }
}

const CANCELLED: ErrorDescription = Object.freeze({
  tone: "info",
  message: "Wallet request cancelled. No transaction was sent.",
});

const GENERIC_MESSAGE = "Security verification failed";

const MAX_SHORT_MESSAGE_LENGTH = 200;
const MAX_PLAIN_MESSAGE_LENGTH = 160;

/** viem and wallet SDK cause chains are short. The bound also ends a cyclic chain. */
const MAX_CAUSE_DEPTH = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstLine(text: string): string {
  const [head = ""] = text.split(/\r?\n/, 1);
  return head.trim();
}

/**
 * The outermost error written for the user down `error`'s cause chain. viem wraps whatever a client's `request`
 * throws in its own call errors, whose short message says far less than the copy inside them.
 */
function findAppError(error: unknown): AppError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && isRecord(current); depth += 1) {
    if (current instanceof AppError) return current;
    current = current.cause;
  }
  return undefined;
}

/**
 * Turns any thrown value into copy that is safe to show. A rejection anywhere down the cause chain wins, then an
 * error written for the user anywhere down it. Raw viem messages carry request URLs and arguments, so otherwise only
 * the short message survives. `fallback` is the copy for an error with nothing safe to show; the default suits a
 * failed read, a failed transaction passes its own.
 */
export function describeError(error: unknown, fallback: string = GENERIC_MESSAGE): ErrorDescription {
  const generic: ErrorDescription = { tone: "error", message: fallback };
  if (isUserRejection(error)) return CANCELLED;

  const appError = findAppError(error);
  if (appError) return { tone: appError.tone, message: appError.message };

  // viem's BaseError, and every copy of it inside wallet SDKs, carries `shortMessage`, so the shape is a safer
  // test than `instanceof`.
  if (isRecord(error) && typeof error.shortMessage === "string") {
    const message = firstLine(error.shortMessage).slice(0, MAX_SHORT_MESSAGE_LENGTH);
    return message ? { tone: "error", message } : generic;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && !/[\r\n]/.test(message) && message.length <= MAX_PLAIN_MESSAGE_LENGTH) {
      return { tone: "error", message };
    }
  }

  return generic;
}

/**
 * The configured RPC and the wallet's provider returned different values at the same block. Usually one endpoint
 * is lagging; the caller retries once before showing it, so the message asks the user to try again.
 */
export class ProvidersDisagreeError extends AppError {
  constructor() {
    super("The configured RPC and your wallet returned different values. Wait a moment and try again.", {
      tone: "warning",
    });
    this.name = "ProvidersDisagreeError";
  }
}

const STATE_CHANGE_MESSAGES: Readonly<Record<StateChange, string>> = Object.freeze({
  balance: "Your balance changed. Review the amount and try again.",
  allowance: "Your approval no longer covers this amount. Start again from Step 1.",
  quote: "The vault's quote changed. Review the new amount and confirm again.",
  "zero-output": "This amount is too small to swap. Enter a larger amount.",
  "per-transaction": "This amount is above the vault's per-transaction limit. Enter a smaller amount.",
  "per-block": "The vault's per-block limit has been reached. Try again in a moment.",
  reserves: "The vault does not hold enough to complete this swap. Enter a smaller amount.",
  paused: "Swaps are currently paused. Please check back later.",
});

/**
 * Both providers agree, but the vault or the wallet is no longer in the state the user saw when they clicked.
 * `retryable` tells the preflight whether one fresh read may clear it; it defaults to true for every change except
 * `paused`.
 */
export class VaultStateChangedError extends AppError {
  readonly change: StateChange;
  readonly retryable: boolean;

  /** `message` replaces the default copy for `change`, for example to name the new quote. */
  constructor(change: StateChange, options?: Readonly<{ message?: string; retryable?: boolean; cause?: unknown }>) {
    super(options?.message ?? STATE_CHANGE_MESSAGES[change], { tone: "warning", cause: options?.cause });
    this.name = "VaultStateChangedError";
    this.change = change;
    this.retryable = options?.retryable ?? change !== "paused";
  }
}

const IDENTITY_MESSAGES = Object.freeze({
  chain: "Security verification failed: the network does not match the vault's network",
  contracts: "Security verification failed: vault contract identity mismatch",
});

/** A provider reported another chain, or the vault's `STABLE()`/`GEM()` differ from the pinned addresses. */
export class VaultIdentityError extends AppError {
  constructor(mismatch: "chain" | "contracts", options?: Readonly<{ cause?: unknown }>) {
    super(IDENTITY_MESSAGES[mismatch], { cause: options?.cause });
    this.name = "VaultIdentityError";
  }
}

/** The vault's preview call failed, so there is no quote to check the swap against. */
export class QuoteUnavailableError extends AppError {
  constructor(options?: Readonly<{ cause?: unknown }>) {
    super("The vault did not return a quote. Try again shortly.", { tone: "warning", cause: options?.cause });
    this.name = "QuoteUnavailableError";
  }
}

function operationNoun(kind: VaultOperation): string {
  return kind === "approve" ? "approval" : "swap";
}

function nothingHappened(kind: VaultOperation): string {
  return kind === "approve" ? "Nothing was approved." : "It did not move any funds.";
}

function replacedMessage(kind: VaultOperation, reason: Exclude<ReplacementReason, "repriced">): string {
  if (reason === "cancelled") {
    return `The ${operationNoun(kind)} transaction was cancelled in your wallet. ${nothingHappened(kind)}`;
  }
  // A replacement with different data is some other transaction from the same wallet. Nothing is known about what
  // it did, so send the user to the explorer rather than claiming nothing happened.
  return `The ${operationNoun(kind)} transaction was replaced by another transaction from your wallet. Check the block explorer before trying again.`;
}

function verificationMessage(kind: VaultOperation, reason: ReceiptVerificationReason): string {
  switch (reason) {
    case "reverted":
      return kind === "approve"
        ? "The approval transaction reverted on chain. Nothing was approved."
        : "This swap transaction reverted. It did not move any funds. Check your balances before trying again.";
    case "missing-event":
      return kind === "approve"
        ? "The transaction confirmed, but it did not approve the expected amount for the vault. Check it on the block explorer before trying again."
        : "The transaction confirmed, but the vault did not record the expected swap for your wallet. Check it on the block explorer before trying again.";
    case "post-state":
      return kind === "approve"
        ? "The transaction was mined, but the resulting allowance did not match. Check it on the block explorer before trying again."
        : "The transaction was mined, but the resulting balances did not match. Check it on the block explorer before trying again.";
    case "unverifiable":
      return "The transaction was mined, but its result could not be verified because the network did not answer. Check it on the block explorer before trying again.";
  }
}

/**
 * The wallet replaced the submitted transaction with a cancel or an unrelated transaction. viem resolves with the
 * replacement's receipt in that case, so this error is what turns a "successful" cancel receipt into a failure.
 */
export class TransactionReplacedError extends AppError {
  readonly kind: VaultOperation;
  readonly reason: Exclude<ReplacementReason, "repriced">;

  constructor(kind: VaultOperation, reason: Exclude<ReplacementReason, "repriced">) {
    // A cancel is the user's own action, so it is reported calmly.
    super(replacedMessage(kind, reason), { tone: reason === "cancelled" ? "info" : "warning" });
    this.name = "TransactionReplacedError";
    this.kind = kind;
    this.reason = reason;
  }
}

/** The mined receipt, or the state it produced, is not what was requested. */
export class ReceiptVerificationError extends AppError {
  readonly kind: VaultOperation;
  readonly reason: ReceiptVerificationReason;

  constructor(kind: VaultOperation, reason: ReceiptVerificationReason, options?: Readonly<{ cause?: unknown }>) {
    super(verificationMessage(kind, reason), { cause: options?.cause });
    this.name = "ReceiptVerificationError";
    this.kind = kind;
    this.reason = reason;
  }
}

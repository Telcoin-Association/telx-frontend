import type { Hash } from "viem";
import { toWad } from "./amount";
import { VAULT_DECIMALS, directionRoute } from "./deployments";
import {
  PAUSED_MESSAGE,
  QUOTE_UNAVAILABLE_MESSAGE,
  TRANSACTION_FAILED_MESSAGE,
  describeError,
} from "./errors";
import { formatAmount } from "./format";
import { PENDING_TTL_MS } from "./pendingRecords";
import type {
  CompletedSwap,
  PendingSummary,
  PrimaryKind,
  VaultLifecycleState,
  VaultOperation,
  VaultView,
  VaultViewInput,
} from "./types";

type Decision = Omit<VaultView, "lockForm" | "formOverride">;
type Notice = NonNullable<VaultView["notice"]>;
type Secondary = VaultView["secondary"][number];
type Carried = Readonly<{ notice?: Notice; secondary: Secondary[] }>;

export const EXPLORER_LABEL = "View on explorer";
/** Tells this tab's own transaction apart from the tracked record that "View on explorer" opens. */
const SENT_LABEL = "View the transaction you sent.";
const WAD_PER_UNIT = toWad(1n, VAULT_DECIMALS);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PAUSED_NOTICE: Notice = { tone: "warning", message: PAUSED_MESSAGE };

// Nothing is stored until the wallet returns a hash, so a reload forgets the request while the wallet can still send
// it. There is no cancel button: unlocking the form while the wallet can still sign would allow a second send.
const SIGNING_NOTICE: Notice = {
  tone: "info",
  message:
    "Confirm or reject the request in your wallet. If no request is showing, reopen your wallet. Reloading this page does not cancel the request, and a transaction your wallet sends afterwards will not be tracked here.",
};

const READ_UNAVAILABLE_NOTICE: Notice = {
  tone: "warning",
  message: "Vault data is unavailable right now. Try again shortly.",
};

const QUOTE_UNAVAILABLE_NOTICE: Notice = { tone: "warning", message: QUOTE_UNAVAILABLE_MESSAGE };

export function explorerTxUrl(
  explorerUrl: string | undefined,
  hash: Hash | undefined,
  smartAccount: boolean
): string | undefined {
  // A smart account's hash identifies a queue entry, so the explorer has nothing to show.
  if (!explorerUrl || !hash || smartAccount) return undefined;
  return `${explorerUrl.replace(/\/+$/, "")}/tx/${hash}`;
}

function amountLabel(value: bigint): string {
  return formatAmount(value, VAULT_DECIMALS);
}

/** A cap is WAD on the input amount; shown in token units, rounded down like the MAX button. */
function capLabel(cap: bigint): string {
  return amountLabel(cap / WAD_PER_UNIT);
}

function overCap(amountIn: bigint, cap: bigint): boolean {
  return cap !== 0n && toWad(amountIn, VAULT_DECIMALS) > cap;
}

/** Links and copy treat a hash as a queue entry when either the session or the record is a smart account. */
function isSmartAccountHash(lifecycle: VaultLifecycleState): boolean {
  return lifecycle.smartAccount || lifecycle.pending?.smartAccount === true;
}

function explorerSecondary(href: string | undefined): Secondary[] {
  return href ? [{ kind: "explorer", label: EXPLORER_LABEL, href }] : [];
}

/** A smart account may never report a receipt, so its record can be dismissed at any time. */
function dismissSecondary(pending: PendingSummary | undefined): Secondary[] {
  return pending?.smartAccount ? [{ kind: "dismiss", label: "Dismiss" }] : [];
}

/** A transaction's explorer link is a secondary; a notice links only a transaction that no secondary opens. */
function withLink(notice: Notice, href: string | undefined, hrefLabel: string): Notice {
  return href ? { ...notice, href, hrefLabel } : notice;
}

/**
 * This tab's attempt sent a transaction, but another tab stored a live transaction for the same wallet first, so no
 * record holds this one and nothing reports its receipt. Its failure and its hash are the only trace of it.
 */
export function isUntrackedSend(lifecycle: VaultLifecycleState): boolean {
  const { status, hash, pending } = lifecycle;
  return (
    status === "failed" &&
    hash !== undefined &&
    pending !== undefined &&
    !pending.expired &&
    hash.toLowerCase() !== pending.hash.toLowerCase()
  );
}

function actionable(kind: "connect" | "switch-network", label: string, notice?: Notice): Decision {
  return { primary: { kind, label, disabled: false, action: kind }, showStepOneComplete: false, secondary: [], notice };
}

function busy(label: string, secondary: Secondary[], notice?: Notice): Decision {
  return { primary: { kind: "busy", label, disabled: true }, showStepOneComplete: false, secondary, notice };
}

function blocked(
  kind: Extract<PrimaryKind, "verifying" | "paused" | "unavailable">,
  label: string,
  notice?: Notice
): Decision {
  return { primary: { kind, label, disabled: true }, showStepOneComplete: false, secondary: [], notice };
}

function smartAccountWaiting(kind: VaultOperation | undefined): string {
  const parts = ["Awaiting your smart account's signatures and execution."];
  if (kind !== "approve") {
    parts.push("The swap executes when the owners confirm it, at the vault's fee at that time, which can differ from the quote.");
  }
  // A smart account's receipt wait times out and retries while the owners sign, so a retry says nothing about the
  // network.
  parts.push("Keep this page open until it executes, and check the account's queue before sending another.");
  return parts.join(" ");
}

function waitingNotice(kind: VaultOperation | undefined, pending: PendingSummary | undefined, smartAccount: boolean): Notice {
  let message: string;
  if (smartAccount) message = smartAccountWaiting(kind);
  else if ((pending?.attempt ?? 0) > 0) message = "Still waiting; the network is slow to respond.";
  else message = "Waiting for confirmation.";
  return { tone: "info", message };
}

/** In whole minutes below an hour, hours below a day, days otherwise; rounded down, so it never overstates a wait. */
function durationLabel(ms: number): string {
  const [size, unit]: [number, string] =
    ms < HOUR_MS ? [MINUTE_MS, "minute"] : ms < DAY_MS ? [HOUR_MS, "hour"] : [DAY_MS, "day"];
  const count = Math.floor(ms / size);
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function expiredNotice(pending: PendingSummary): Notice {
  const waited = durationLabel(pending.smartAccount ? PENDING_TTL_MS.smartAccount : PENDING_TTL_MS.eoa);
  const message = pending.smartAccount
    ? `The transaction has not executed after ${waited}. It may still be waiting in your smart account's queue; check it there before sending another.`
    : `The transaction has not confirmed after ${waited}. It may still be pending in your wallet; check the explorer before sending another.`;
  return { tone: "warning", message };
}

/** A transaction this tab is checking, signing, confirming or settling. */
function lifecycleRow(i: VaultViewInput): Decision | undefined {
  const { lifecycle } = i;
  const { status, pending } = lifecycle;
  if (status === "preflight" || status === "signing") {
    // A record still tracked while an attempt is checked and signed is an expired one that the attempt replaces, so
    // only the attempt's own hash is linked.
    const explorer = explorerSecondary(explorerTxUrl(i.explorerUrl, lifecycle.hash, lifecycle.smartAccount));
    if (status === "preflight") return busy("Checking vault state...", explorer);
    return busy("Confirm in your wallet...", explorer, SIGNING_NOTICE);
  }

  const kind = lifecycle.kind ?? pending?.kind;
  const smartAccount = isSmartAccountHash(lifecycle);
  const href = explorerTxUrl(i.explorerUrl, lifecycle.hash ?? pending?.hash, smartAccount);
  const explorer = explorerSecondary(href);

  switch (status) {
    case "confirming":
    case "verifying":
      return busy(
        kind === "approve" ? "Approving..." : "Swapping...",
        [...dismissSecondary(pending), ...explorer],
        waitingNotice(kind, pending, smartAccount)
      );
    case "confirmed": {
      const label = kind === "approve" ? "Verifying approval..." : "Refreshing balances...";
      if (i.settle !== "timed-out") return busy(label, explorer);
      const message =
        kind === "approve"
          ? "Confirmed on chain, but the allowance has not refreshed yet."
          : "Confirmed on chain, but the balances have not refreshed yet.";
      return busy(label, [{ kind: "refresh", label: "Refresh" }, ...explorer], { tone: "warning", message });
    }
    default:
      return undefined;
  }
}

/** A completed swap, kept until Done even if the vault pauses or reads fail afterwards. */
function successRow(i: VaultViewInput, completed: CompletedSwap): Decision {
  const { symbolOut } = directionRoute(completed.direction);
  // The mined hash from the receipt, so the link is valid for a smart account too.
  const href = explorerTxUrl(i.explorerUrl, completed.transactionHash, false);
  const amountOutLabel = amountLabel(completed.amountOut);
  const quoteDiffers = completed.amountOut !== completed.quotedOut;
  return {
    primary: { kind: "success", label: "Swap complete", disabled: true },
    showStepOneComplete: false,
    success: {
      amountOutLabel,
      symbolOut,
      ...(completed.fee > 0n ? { feeLabel: amountLabel(completed.fee) } : {}),
      chainName: i.chainName ?? "the selected network",
      ...(href ? { href } : {}),
    },
    // The card links the transaction itself.
    secondary: [{ kind: "done", label: "Done" }],
    // The warning states the quote and why it differs, so the card does not repeat it.
    notice: quoteDiffers
      ? {
          tone: "warning",
          message: `The vault quoted ${amountLabel(completed.quotedOut)} ${symbolOut} but paid ${amountOutLabel} ${symbolOut}. Its fee changed between the quote and the swap.`,
        }
      : undefined,
  };
}

/**
 * The vault reads. Paused sits before unavailable so a paused vault reads as paused even when another read fails, but
 * only once its identity is verified: a contract that is not the pinned vault must never be described as paused.
 */
function readsRow(i: VaultViewInput): Decision | undefined {
  if (i.isVerifying) return blocked("verifying", "Verifying vault contracts...", i.error);
  // The paused notice replaces any read error: waiting is the one thing the user can do.
  if (i.isContractVerified && i.paused) return blocked("paused", "Swaps paused", PAUSED_NOTICE);
  if (i.isSecurityCheckUnavailable || !i.isContractVerified) {
    return blocked("unavailable", "Security verification unavailable", i.error);
  }
  return undefined;
}

/**
 * A live record this tab is not watching: another tab's, one resumed after a reload before its watch attached, or one
 * that took the record slot from this tab's own transaction.
 */
function pendingRow(i: VaultViewInput): Decision | undefined {
  const { lifecycle } = i;
  const { pending } = lifecycle;
  if (!pending || pending.expired) return undefined;
  const smartAccount = isSmartAccountHash(lifecycle);
  const href = explorerTxUrl(i.explorerUrl, pending.hash, smartAccount);
  // The record keeps the button busy, but a transaction this tab sent and nobody tracks is what the user must see.
  const notice = isUntrackedSend(lifecycle)
    ? withLink(
        describeError(lifecycle.failure?.error, TRANSACTION_FAILED_MESSAGE),
        explorerTxUrl(i.explorerUrl, lifecycle.hash, smartAccount),
        SENT_LABEL
      )
    : waitingNotice(pending.kind, pending, smartAccount);
  return busy(
    pending.kind === "approve" ? "Approval pending..." : "Swap pending...",
    [...dismissSecondary(pending), ...explorerSecondary(href)],
    notice
  );
}

/**
 * The notice and secondaries the form rows carry, from the first of these that applies:
 *  1. this network's expired record: a warning, Dismiss, and its explorer link;
 *  2. this tab's failed attempt: its failure, and its explorer link when it sent a transaction;
 *  3. an approval the live allowance showed confirmed: a success notice and its explorer link;
 *  4. a live transaction for this wallet on another network: an info notice that disables nothing;
 *  5. a network switch the wallet refused.
 * A transaction in flight or a live record on this network never reaches here. A form row with its own notice
 * replaces the carried one and keeps the secondaries.
 */
function carriedRow(i: VaultViewInput): Carried {
  const { lifecycle } = i;
  const { pending } = lifecycle;
  const smartAccount = isSmartAccountHash(lifecycle);

  if (pending?.expired) {
    const href = explorerTxUrl(i.explorerUrl, pending.hash, smartAccount);
    return {
      notice: expiredNotice(pending),
      secondary: [{ kind: "dismiss", label: "Dismiss" }, ...explorerSecondary(href)],
    };
  }

  // Keyed on the status: the notice lasts while the attempt is failed, and acknowledging returns to idle and clears
  // `failure`.
  if (lifecycle.status === "failed") {
    const href = explorerTxUrl(i.explorerUrl, lifecycle.hash, smartAccount);
    return {
      notice: describeError(lifecycle.failure?.error, TRANSACTION_FAILED_MESSAGE),
      secondary: explorerSecondary(href),
    };
  }

  if (lifecycle.settledExternally) {
    const href = explorerTxUrl(i.explorerUrl, lifecycle.settledExternally.hash, smartAccount);
    return { notice: { tone: "success", message: "Your approval was confirmed." }, secondary: explorerSecondary(href) };
  }

  if (i.pendingElsewhere) {
    const { chainName } = i.pendingElsewhere;
    return {
      notice: {
        tone: "info",
        message: `You have a transaction pending on ${chainName}. Switch to ${chainName} to follow it.`,
      },
      secondary: [],
    };
  }

  // A refused network switch leaves the wallet where it was; say so under the form unless something above applies.
  return { notice: i.switchError, secondary: [] };
}

/** The form's own checks, then the step buttons. A row without its own notice keeps the carried one. */
function formRow(i: VaultViewInput, carried: Carried): Decision {
  const { symbolIn, symbolOut } = directionRoute(i.direction);
  const stop = (kind: PrimaryKind, label: string, notice?: Notice): Decision => ({
    primary: { kind, label, disabled: true },
    showStepOneComplete: false,
    secondary: carried.secondary,
    notice: notice ?? carried.notice,
  });
  const step = (kind: "approve" | "swap", label: string): Decision => ({
    primary: { kind, label, disabled: !i.lifecycle.canSubmit, action: kind },
    showStepOneComplete: kind === "swap",
    secondary: carried.secondary,
    notice: carried.notice,
  });

  const { amount, quote } = i;
  if (i.balanceIn === 0n) return stop("no-balance", `No ${symbolIn} balance`);
  if (amount.status === "empty" || (amount.status === "valid" && amount.value === 0n)) {
    return stop("enter-amount", "Enter an amount");
  }
  if (amount.status === "invalid") return stop("invalid-amount", `Enter a valid ${symbolIn} amount`);
  const amountIn = amount.value;
  if (amountIn > i.balanceIn) return stop("insufficient-balance", `Insufficient ${symbolIn} balance`);
  if (overCap(amountIn, i.maxPerTransaction)) {
    return stop("over-limit", "Above the per-transaction limit", {
      tone: "warning",
      message: `The vault accepts at most ${capLabel(i.maxPerTransaction)} ${symbolIn} per swap.`,
    });
  }
  if (overCap(amountIn, i.maxPerBlock)) {
    return stop("over-limit", "Above the per-block limit", {
      tone: "warning",
      message: `The vault accepts at most ${capLabel(i.maxPerBlock)} ${symbolIn} per block.`,
    });
  }
  // A failed quote is unavailable. Any other quote not ready for exactly this direction and amount is still loading;
  // a stale one must never enable a button.
  if (quote.status === "error") return stop("quote-unavailable", "Quote unavailable", QUOTE_UNAVAILABLE_NOTICE);
  if (quote.status !== "ready" || quote.direction !== i.direction || quote.amountIn !== amountIn) {
    return stop("quote-loading", "Fetching quote...");
  }
  const { amountOut, fee } = quote.quote;
  if (amountOut === 0n) return stop("amount-too-small", "Amount too small");
  if (i.outputReserve < amountOut + fee) {
    return stop("insufficient-reserves", `Not enough ${symbolOut} in the vault`, {
      tone: "warning",
      message: `The vault currently holds ${amountLabel(i.outputReserve)} ${symbolOut}. Enter a smaller amount.`,
    });
  }
  if (i.allowanceIn < amountIn) return step("approve", `Step 1: Approve ${symbolIn}`);
  return step("swap", `Step 2: Swap ${symbolIn} for ${symbolOut}`);
}

function formLock(i: VaultViewInput): Pick<VaultView, "lockForm" | "formOverride"> {
  const { lifecycle } = i;
  const { status, pending } = lifecycle;
  // Without a wallet nothing can be submitted or pending, and a visitor may still pick a network and see a quote.
  const blocked = i.address !== undefined && !lifecycle.canSubmit;
  const lockForm = blocked || (status !== "idle" && status !== "failed");
  if (!lockForm) return { lockForm };
  const attempt =
    lifecycle.direction !== undefined && lifecycle.amountIn !== undefined
      ? { direction: lifecycle.direction, amountIn: lifecycle.amountIn }
      : undefined;
  // A new attempt starts over a tracked record only once that record has expired, and the record stays tracked until
  // the attempt's own replaces it. The form shows the attempt while it is checked and signed, and an expired record
  // never takes the form over: the page adopts the override, so its values would be what the next click sends.
  const record = pending && !pending.expired ? { direction: pending.direction, amountIn: pending.amountIn } : undefined;
  const formOverride = status === "preflight" || status === "signing" ? attempt : record ?? attempt;
  return formOverride ? { lockForm, formOverride } : { lockForm };
}

/**
 * The single decision table for what the vault page renders. The first match wins:
 *
 *  1. no wallet -> connect, with a notice when the vault read failed
 *  2. wrong network -> switch network
 *  3. a transaction this tab is checking, signing, confirming or settling -> busy
 *  4. a completed swap -> success card, until Done
 *  5. reads loading, a verified and paused vault, reads unavailable or unverified -> blocked
 *  6. a live pending record -> busy (another tab, a reload, or one that took this tab's slot)
 *  7. balance, amount, cap, quote and reserve checks -> disabled
 *  8. Step 1 approve, then Step 2 swap
 *
 * The last two show the notice and secondaries from `carriedRow` unless a check has a notice of its own.
 */
export function deriveVaultView(i: VaultViewInput): VaultView {
  return { ...decide(i), ...formLock(i) };
}

/** A visitor is shown the vault's numbers and a quote, so a read that failed must be said even before connecting. */
function visitorNotice(i: VaultViewInput): Notice | undefined {
  if (i.isVerifying || !i.isSecurityCheckUnavailable) return undefined;
  return i.error ?? READ_UNAVAILABLE_NOTICE;
}

function decide(i: VaultViewInput): Decision {
  if (!i.address) return actionable("connect", "Connect Wallet", visitorNotice(i));
  if (i.isWrongNetwork) return actionable("switch-network", "Switch to supported network", i.switchError);
  const { completed } = i.lifecycle;
  return (
    lifecycleRow(i) ??
    (completed ? successRow(i, completed) : undefined) ??
    readsRow(i) ??
    pendingRow(i) ??
    formRow(i, carriedRow(i))
  );
}

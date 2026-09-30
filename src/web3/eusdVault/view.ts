import type { Hash } from "viem";
import { toWad } from "./amount";
import { VAULT_DECIMALS, VAULT_DEPLOYMENTS, routeFor } from "./deployments";
import { describeError } from "./errors";
import { formatAmount } from "./format";
import type {
  CompletedSwap,
  PendingSummary,
  PrimaryKind,
  SwapDirection,
  VaultLifecycleState,
  VaultOperation,
  VaultView,
  VaultViewInput,
} from "./types";

type Decision = Omit<VaultView, "lockForm" | "formOverride">;
type Notice = NonNullable<VaultView["notice"]>;
type Secondary = VaultView["secondary"][number];
type Carried = Readonly<{ notice?: Notice; secondary: Secondary[] }>;

const EXPLORER_LABEL = "View on explorer";
const TRANSACTION_FAILED = "The transaction could not be completed.";
const WAD_PER_UNIT = toWad(1n, VAULT_DECIMALS);

const PAUSED_NOTICE: Notice = {
  tone: "warning",
  message: "Swaps are currently paused. Please check back later.",
};

const QUOTE_UNAVAILABLE_NOTICE: Notice = {
  tone: "warning",
  message: "The vault did not return a quote. Try again shortly.",
};

export function explorerTxUrl(
  explorerUrl: string | undefined,
  hash: Hash | undefined,
  smartAccount: boolean
): string | undefined {
  // A smart account's hash identifies a queue entry, so the explorer has nothing to show.
  if (!explorerUrl || !hash || smartAccount) return undefined;
  return `${explorerUrl.replace(/\/+$/, "")}/tx/${hash}`;
}

function symbolsFor(direction: SwapDirection) {
  // The symbols do not depend on the chain, so any pinned deployment will do.
  const { symbolIn, symbolOut } = routeFor(VAULT_DEPLOYMENTS[1], direction);
  return { symbolIn, symbolOut };
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
function isSmartAccount(lifecycle: VaultLifecycleState): boolean {
  return lifecycle.smartAccount || lifecycle.pending?.smartAccount === true;
}

function explorerSecondary(href: string | undefined): Secondary[] {
  return href ? [{ kind: "explorer", label: EXPLORER_LABEL, href }] : [];
}

/** A smart account may never report a receipt, so its record can be dismissed at any time. */
function dismissSecondary(pending: PendingSummary | undefined): Secondary[] {
  return pending?.smartAccount ? [{ kind: "dismiss", label: "Dismiss" }] : [];
}

function withLink(notice: Notice, href: string | undefined): Notice {
  return href ? { ...notice, href, hrefLabel: EXPLORER_LABEL } : notice;
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

function smartAccountWaiting(kind: VaultOperation | undefined, slow: boolean): string {
  const parts = ["Awaiting your smart account's signatures and execution."];
  if (kind !== "approve") {
    parts.push("The swap executes when the owners confirm it, at the vault's fee at that time, which can differ from the quote.");
  }
  parts.push(
    slow
      ? "Still waiting; the network is slow to respond."
      : "Keep this page open until it executes, and check the account's queue before sending another."
  );
  return parts.join(" ");
}

function waitingNotice(
  kind: VaultOperation | undefined,
  pending: PendingSummary | undefined,
  smartAccount: boolean,
  href: string | undefined
): Notice {
  const slow = (pending?.attempt ?? 0) > 0;
  let message: string;
  if (smartAccount) message = smartAccountWaiting(kind, slow);
  else if (slow) message = "Still waiting; the network is slow to respond.";
  else message = "Waiting for confirmation.";
  return withLink({ tone: "info", message }, href);
}

function expiredNotice(pending: PendingSummary, href: string | undefined): Notice {
  const message = pending.smartAccount
    ? "The transaction has not executed after 7 days. It may still be waiting in your smart account's queue; check it there before sending another."
    : "The transaction has not confirmed after 30 minutes. It may still be pending in your wallet; check the explorer before sending another.";
  return withLink({ tone: "warning", message }, href);
}

/** Rows 3-5: a transaction this tab is running. */
function lifecycleRow(i: VaultViewInput): Decision | undefined {
  const { lifecycle } = i;
  const { pending } = lifecycle;
  const kind = lifecycle.kind ?? pending?.kind;
  const smartAccount = isSmartAccount(lifecycle);
  const href = explorerTxUrl(i.explorerUrl, lifecycle.hash ?? pending?.hash, smartAccount);
  const explorer = explorerSecondary(href);

  switch (lifecycle.status) {
    case "preflight":
      return busy("Checking vault state...", explorer);
    case "signing":
      return busy("Confirm in your wallet...", explorer);
    case "confirming":
    case "verifying":
      return busy(
        kind === "approve" ? "Approving..." : "Swapping...",
        [...dismissSecondary(pending), ...explorer],
        waitingNotice(kind, pending, smartAccount, href)
      );
    case "confirmed": {
      const label = kind === "approve" ? "Verifying approval..." : "Refreshing balances...";
      if (i.settle !== "timed-out") return busy(label, explorer);
      const message =
        kind === "approve"
          ? "Confirmed on chain, but the allowance has not refreshed yet."
          : "Confirmed on chain, but the balances have not refreshed yet.";
      return busy(label, [{ kind: "refresh", label: "Refresh" }, ...explorer], withLink({ tone: "warning", message }, href));
    }
    default:
      return undefined;
  }
}

/** Row 6: kept until Done, even if the vault pauses or reads fail afterwards. */
function successRow(i: VaultViewInput, completed: CompletedSwap): Decision {
  const { symbolOut } = symbolsFor(completed.direction);
  // The mined hash from the receipt, so the link is valid for a smart account too.
  const href = explorerTxUrl(i.explorerUrl, completed.transactionHash, false);
  const amountOutLabel = amountLabel(completed.amountOut);
  const quoteDiffers = completed.amountOut !== completed.quotedOut;
  const quotedOutLabel = amountLabel(completed.quotedOut);
  return {
    primary: { kind: "success", label: "Swap complete", disabled: true },
    showStepOneComplete: false,
    success: {
      amountOutLabel,
      symbolOut,
      ...(completed.fee > 0n ? { feeLabel: amountLabel(completed.fee) } : {}),
      ...(quoteDiffers ? { quotedOutLabel } : {}),
      chainName: i.chainName ?? "the selected network",
      ...(href ? { href } : {}),
    },
    secondary: [{ kind: "done", label: "Done" }, ...explorerSecondary(href)],
    notice: quoteDiffers
      ? {
          tone: "warning",
          message: `The vault quoted ${quotedOutLabel} ${symbolOut} but paid ${amountOutLabel} ${symbolOut}. Its fee changed between the quote and the swap.`,
        }
      : undefined,
  };
}

/**
 * Rows 7-9. Paused sits before unavailable so a paused vault reads as paused even when another read fails, but
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

/** Row 10: a live record while idle, from another tab or a reload before the watcher attached. */
function pendingRow(i: VaultViewInput): Decision | undefined {
  const { pending } = i.lifecycle;
  if (!pending || pending.expired) return undefined;
  const smartAccount = isSmartAccount(i.lifecycle);
  const href = explorerTxUrl(i.explorerUrl, pending.hash, smartAccount);
  return busy(
    pending.kind === "approve" ? "Approval pending..." : "Swap pending...",
    [...dismissSecondary(pending), ...explorerSecondary(href)],
    waitingNotice(pending.kind, pending, smartAccount, href)
  );
}

/** Rows 11, 12 and 12a add a notice and secondaries, then fall through to the form rows. */
function carriedRow(i: VaultViewInput): Carried {
  const { lifecycle } = i;
  const { pending } = lifecycle;
  const smartAccount = isSmartAccount(lifecycle);

  if (pending?.expired) {
    const href = explorerTxUrl(i.explorerUrl, pending.hash, smartAccount);
    return {
      notice: expiredNotice(pending, href),
      secondary: [{ kind: "dismiss", label: "Dismiss" }, ...explorerSecondary(href)],
    };
  }

  // Keyed on the status, not on `failure`: acknowledging a failure returns to idle and keeps `failure` set.
  if (lifecycle.status === "failed") {
    const href = explorerTxUrl(i.explorerUrl, lifecycle.hash, smartAccount);
    return { notice: describeError(lifecycle.failure?.error, TRANSACTION_FAILED), secondary: explorerSecondary(href) };
  }

  if (lifecycle.settledExternally) {
    const href = explorerTxUrl(i.explorerUrl, lifecycle.settledExternally.hash, smartAccount);
    const message = "Your approval was confirmed.";
    return {
      notice: href ? { tone: "success", message, href, hrefLabel: "View the transaction." } : { tone: "success", message },
      secondary: explorerSecondary(href),
    };
  }

  // A refused network switch leaves the wallet where it was; say so under the form unless something above applies.
  return { notice: i.switchError, secondary: [] };
}

/** Rows 13-24. A row without its own notice keeps the carried one. */
function formRow(i: VaultViewInput, carried: Carried): Decision {
  const { symbolIn, symbolOut } = symbolsFor(i.direction);
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
  // Rows 19 and 20 are disjoint. A quote for another direction or amount is stale and must never enable a button.
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
  // Without a wallet nothing can be submitted or pending, and a visitor may still pick a network and see a quote.
  const blocked = i.address !== undefined && !lifecycle.canSubmit;
  const lockForm = blocked || (lifecycle.status !== "idle" && lifecycle.status !== "failed");
  if (!lockForm) return { lockForm };
  if (lifecycle.pending) {
    return { lockForm, formOverride: { direction: lifecycle.pending.direction, amountIn: lifecycle.pending.amountIn } };
  }
  if (lifecycle.direction !== undefined && lifecycle.amountIn !== undefined) {
    return { lockForm, formOverride: { direction: lifecycle.direction, amountIn: lifecycle.amountIn } };
  }
  return { lockForm };
}

/**
 * The single decision table for what the vault page renders (spec Appendix D). First match wins:
 *
 *  1. no wallet                                   -> connect
 *  2. wrong network or no deployment              -> switch network
 *  3-5. preflight, signing, confirming, verifying, confirmed -> busy
 *  6. swap completed                              -> success card, until Done
 *  7-9. reads loading, verified and paused, unavailable or unverified -> blocked
 *  10. live pending record                        -> busy (another tab or a reload)
 *  11-12a. expired record, failed, settled by live state -> notice, then 13-24
 *  13-22. balance, amount, caps, quote and reserve checks -> disabled
 *  23-24. Step 1 approve, Step 2 swap
 */
export function deriveVaultView(i: VaultViewInput): VaultView {
  return { ...decide(i), ...formLock(i) };
}

function decide(i: VaultViewInput): Decision {
  if (!i.address) return actionable("connect", "Connect Wallet");
  if (i.isWrongNetwork || !i.hasDeployment) {
    return actionable("switch-network", "Switch to supported network", i.switchError);
  }
  const { completed } = i.lifecycle;
  return (
    lifecycleRow(i) ??
    (completed ? successRow(i, completed) : undefined) ??
    readsRow(i) ??
    pendingRow(i) ??
    formRow(i, carriedRow(i))
  );
}

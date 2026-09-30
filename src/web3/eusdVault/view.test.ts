/** @jest-environment node */
import { UserRejectedRequestError, type Address, type Hash } from "viem";
import { toWad } from "./amount";
import { AppError } from "./errors";
import type {
  AmountInput,
  CompletedSwap,
  PendingSummary,
  QuoteState,
  SwapDirection,
  VaultLifecycleState,
  VaultViewInput,
} from "./types";
import { deriveVaultView, explorerTxUrl, isUntrackedSend } from "./view";

const address: Address = "0x5555555555555555555555555555555555555555";
const hash = `0x${"ab".repeat(32)}` as Hash;
const minedHash = `0x${"cd".repeat(32)}` as Hash;
const explorerUrl = "https://polygonscan.com";
const txHref = `${explorerUrl}/tx/${hash}`;
const minedHref = `${explorerUrl}/tx/${minedHash}`;
const explorerLink = { kind: "explorer", label: "View on explorer", href: txHref } as const;
const dismiss = { kind: "dismiss", label: "Dismiss" } as const;

const WAITING = "Waiting for confirmation.";
const SLOW = "Still waiting; the network is slow to respond.";
const SMART_ACCOUNT_FEE =
  "The swap executes when the owners confirm it, at the vault's fee at that time, which can differ from the quote.";
const CANCELLED = "Wallet request cancelled. No transaction was sent.";

/** Whole tokens in 6-decimal units. */
function units(tokens: bigint): bigint {
  return tokens * 1_000_000n;
}

function valid(value: bigint): AmountInput {
  return { status: "valid", value };
}

/** A fresh quote for the form, with a 1% fee taken from the output. */
function quoteFor(direction: SwapDirection, amountIn: bigint): QuoteState {
  const fee = amountIn / 100n;
  return { status: "ready", direction, amountIn, quote: { amountOut: amountIn - fee, fee } };
}

function lifecycle(overrides: Partial<VaultLifecycleState> = {}): VaultLifecycleState {
  return { status: "idle", smartAccount: false, canSubmit: true, ...overrides };
}

const pending: PendingSummary = {
  kind: "approve",
  direction: "usdcToEusd",
  hash,
  amountIn: units(100n),
  chainId: 137,
  submittedAt: 1,
  expiresAt: 2,
  expired: false,
  smartAccount: false,
  attempt: 0,
};

const smartPending: PendingSummary = { ...pending, kind: "swap", smartAccount: true, quotedOut: units(99n), quotedFee: units(1n) };

/** An expired 200 eUSD to USDC swap, still tracked until a new submission replaces it. */
const expiredSwap: PendingSummary = { ...pending, kind: "swap", direction: "eusdToUsdc", amountIn: units(200n), expired: true };

const completed: CompletedSwap = {
  direction: "usdcToEusd",
  amountIn: units(100n),
  amountOut: 99_500_000n,
  fee: 500_000n,
  quotedOut: 99_500_000n,
  hash,
  transactionHash: minedHash,
  chainId: 137,
};

/**
 * A connected, verified, unpaused vault with 100 USDC typed, 1,000 USDC held and no approval. Unless the override
 * sets `quote`, the quote is a fresh one for the effective direction and amount.
 */
function input(overrides: Partial<VaultViewInput> = {}): VaultViewInput {
  const direction = overrides.direction ?? "usdcToEusd";
  const amount = overrides.amount ?? valid(units(100n));
  return {
    address,
    isWrongNetwork: false,
    hasDeployment: true,
    isVerifying: false,
    isSecurityCheckUnavailable: false,
    isContractVerified: true,
    paused: false,
    direction,
    amount,
    balanceIn: units(1_000n),
    allowanceIn: 0n,
    outputReserve: units(10_000n),
    maxPerTransaction: 0n,
    maxPerBlock: 0n,
    quote: quoteFor(direction, amount.status === "valid" ? amount.value : 0n),
    lifecycle: lifecycle(),
    settle: "idle",
    chainName: "Polygon",
    explorerUrl,
    ...overrides,
  };
}

function view(overrides: Partial<VaultViewInput> = {}) {
  return deriveVaultView(input(overrides));
}

describe("explorerTxUrl", () => {
  it("builds a transaction link and trims a trailing slash", () => {
    expect(explorerTxUrl(explorerUrl, hash, false)).toBe(txHref);
    expect(explorerTxUrl(`${explorerUrl}/`, hash, false)).toBe(txHref);
  });

  it("returns undefined for a smart account's hash and for missing inputs", () => {
    expect(explorerTxUrl(explorerUrl, hash, true)).toBeUndefined();
    expect(explorerTxUrl(undefined, hash, false)).toBeUndefined();
    expect(explorerTxUrl("", hash, false)).toBeUndefined();
    expect(explorerTxUrl(explorerUrl, undefined, false)).toBeUndefined();
  });
});

describe("deriveVaultView rows 1-2", () => {
  it("row 1: asks to connect when there is no wallet, before anything else", () => {
    const result = view({
      address: undefined,
      isWrongNetwork: true,
      lifecycle: lifecycle({ status: "confirming", kind: "approve", hash }),
    });
    expect(result.primary).toEqual({ kind: "connect", label: "Connect Wallet", disabled: false, action: "connect" });
    expect(result.secondary).toEqual([]);
    expect(result.notice).toBeUndefined();
  });

  it("row 2: wrong network beats every state except connect", () => {
    for (const overrides of [
      { lifecycle: lifecycle({ status: "confirming", kind: "swap", hash }) },
      { lifecycle: lifecycle({ status: "failed", failure: { reason: "unknown", error: new Error("x") } }) },
      { lifecycle: lifecycle({ completed }) },
      { paused: true },
      { balanceIn: 0n },
      { isVerifying: true },
    ] satisfies Partial<VaultViewInput>[]) {
      const result = view({ ...overrides, isWrongNetwork: true });
      expect(result.primary).toEqual({
        kind: "switch-network",
        label: "Switch to supported network",
        disabled: false,
        action: "switch-network",
      });
      expect(result.success).toBeUndefined();
    }
  });

  it("row 2: asks to switch when the chain has no deployment", () => {
    expect(view({ hasDeployment: false }).primary.kind).toBe("switch-network");
  });
});

describe("deriveVaultView rows 3-5: a transaction in flight", () => {
  it.each([
    ["preflight", "Checking vault state..."],
    ["signing", "Confirm in your wallet..."],
  ] as const)("row 3: is busy during %s", (status, label) => {
    const result = view({ lifecycle: lifecycle({ status, kind: "swap", canSubmit: false }) });
    expect(result.primary).toEqual({ kind: "busy", label, disabled: true });
    expect(result.secondary).toEqual([]);
  });

  it("row 3: says nothing under the button while the vault is checked", () => {
    expect(view({ lifecycle: lifecycle({ status: "preflight", kind: "swap", canSubmit: false }) }).notice).toBeUndefined();
  });

  it("row 3: tells the user how to find or leave a wallet request while signing", () => {
    const result = view({ lifecycle: lifecycle({ status: "signing", kind: "swap", canSubmit: false }) });
    expect(result.notice).toEqual({
      tone: "info",
      message:
        "Confirm or reject the request in your wallet. If no request is showing, reopen your wallet. Reloading this page does not cancel the request, and a transaction your wallet sends afterwards will not be tracked here.",
    });
  });

  it("row 3: links the explorer when the transaction already has a hash", () => {
    const result = view({ lifecycle: lifecycle({ status: "signing", kind: "approve", hash }) });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it.each(["preflight", "signing"] as const)(
    "row 3: never links an expired record that a new request replaces during %s",
    (status) => {
      const result = view({
        lifecycle: lifecycle({
          status,
          kind: "approve",
          direction: "usdcToEusd",
          amountIn: units(50n),
          pending: expiredSwap,
          canSubmit: false,
        }),
      });
      expect(result.secondary).toEqual([]);
      expect(result.notice?.href).toBeUndefined();
    }
  );

  it("row 4: is busy with a waiting notice and explorer link while an approval confirms", () => {
    const result = view({
      lifecycle: lifecycle({ status: "confirming", kind: "approve", hash, pending, canSubmit: false }),
    });
    expect(result.primary).toEqual({ kind: "busy", label: "Approving...", disabled: true });
    expect(result.notice).toEqual({ tone: "info", message: WAITING, href: txHref, hrefLabel: "View on explorer" });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it("row 4: labels a swap as swapping while verifying", () => {
    const result = view({ lifecycle: lifecycle({ status: "verifying", kind: "swap", hash }) });
    expect(result.primary.label).toBe("Swapping...");
  });

  it("row 4: mentions a slow network after a retried wait", () => {
    const result = view({
      lifecycle: lifecycle({ status: "confirming", kind: "approve", hash, pending: { ...pending, attempt: 2 } }),
    });
    expect(result.notice?.tone).toBe("info");
    expect(result.notice?.message).toBe(SLOW);
  });

  it("row 4: warns a smart account about execution-time fees, with Dismiss and no explorer link", () => {
    const result = view({
      lifecycle: lifecycle({ status: "confirming", kind: "swap", hash, smartAccount: true, pending: smartPending, canSubmit: false }),
    });
    expect(result.primary.label).toBe("Swapping...");
    expect(result.notice).toEqual({
      tone: "info",
      message: `Awaiting your smart account's signatures and execution. ${SMART_ACCOUNT_FEE} Keep this page open until it executes, and check the account's queue before sending another.`,
    });
    expect(result.secondary).toEqual([dismiss]);
  });

  it("row 4: leaves the fee warning out of a smart account's approval", () => {
    const result = view({
      lifecycle: lifecycle({
        status: "verifying",
        kind: "approve",
        hash,
        smartAccount: true,
        pending: { ...smartPending, kind: "approve" },
      }),
    });
    expect(result.notice?.message).toBe(
      "Awaiting your smart account's signatures and execution. Keep this page open until it executes, and check the account's queue before sending another.",
    );
    expect(result.secondary).toEqual([dismiss]);
  });

  it("row 4: keeps the fee warning in a smart account's slow notice", () => {
    const result = view({
      lifecycle: lifecycle({ status: "confirming", kind: "swap", hash, smartAccount: true, pending: { ...smartPending, attempt: 1 } }),
    });
    expect(result.notice?.message).toBe(`Awaiting your smart account's signatures and execution. ${SMART_ACCOUNT_FEE} ${SLOW}`);
  });

  it("row 4: does not offer Dismiss for an EOA record", () => {
    const result = view({ lifecycle: lifecycle({ status: "confirming", kind: "approve", hash, pending }) });
    expect(result.secondary.map(s => s.kind)).not.toContain("dismiss");
  });

  it.each([
    ["approve", "Verifying approval...", "idle"],
    ["approve", "Verifying approval...", "polling"],
    ["swap", "Refreshing balances...", "polling"],
    ["swap", "Refreshing balances...", "settled"],
  ] as const)("row 5: is busy after a confirmed %s while settling (%s, %s)", (kind, label, settle) => {
    const result = view({ settle, lifecycle: lifecycle({ status: "confirmed", kind, hash }) });
    expect(result.primary).toEqual({ kind: "busy", label, disabled: true });
    expect(result.notice).toBeUndefined();
    expect(result.secondary).toEqual([explorerLink]);
  });

  it.each([
    ["approve", "Verifying approval...", "Confirmed on chain, but the allowance has not refreshed yet."],
    ["swap", "Refreshing balances...", "Confirmed on chain, but the balances have not refreshed yet."],
  ] as const)("row 5: offers Refresh when settling a %s timed out", (kind, label, message) => {
    const result = view({ settle: "timed-out", lifecycle: lifecycle({ status: "confirmed", kind, hash }) });
    expect(result.primary.label).toBe(label);
    expect(result.notice).toEqual({ tone: "warning", message, href: txHref, hrefLabel: "View on explorer" });
    expect(result.secondary).toEqual([{ kind: "refresh", label: "Refresh" }, explorerLink]);
  });
});

describe("deriveVaultView row 6: success card", () => {
  it("shows the received amount, symbol, fee and chain, with Done and the explorer", () => {
    const result = view({ lifecycle: lifecycle({ completed }) });
    expect(result.primary).toEqual({ kind: "success", label: "Swap complete", disabled: true });
    expect(result.success).toEqual({
      amountOutLabel: "99.5",
      symbolOut: "eUSD",
      feeLabel: "0.5",
      chainName: "Polygon",
      href: minedHref,
    });
    expect(result.secondary).toEqual([
      { kind: "done", label: "Done" },
      { kind: "explorer", label: "View on explorer", href: minedHref },
    ]);
    expect(result.notice).toBeUndefined();
  });

  it("leaves the fee line out when the fee is zero", () => {
    const result = view({ lifecycle: lifecycle({ completed: { ...completed, fee: 0n, amountOut: units(100n), quotedOut: units(100n) } }) });
    expect(result.success?.amountOutLabel).toBe("100");
    expect(result.success).not.toHaveProperty("feeLabel");
  });

  it("warns and shows the quote when the received amount differs from it", () => {
    const result = view({ lifecycle: lifecycle({ completed: { ...completed, amountOut: 99_000_000n, fee: units(1n) } }) });
    expect(result.success?.amountOutLabel).toBe("99");
    expect(result.success?.quotedOutLabel).toBe("99.5");
    expect(result.notice).toEqual({
      tone: "warning",
      message: "The vault quoted 99.5 eUSD but paid 99 eUSD. Its fee changed between the quote and the swap.",
    });
  });

  it("does not show the quote when the received amount matches it", () => {
    expect(view({ lifecycle: lifecycle({ completed }) }).success).not.toHaveProperty("quotedOutLabel");
  });

  it("links the mined transaction hash even for a smart account", () => {
    const result = view({ lifecycle: lifecycle({ smartAccount: true, completed }) });
    expect(result.success?.href).toBe(minedHref);
    expect(result.secondary).toContainEqual({ kind: "explorer", label: "View on explorer", href: minedHref });
  });

  it("names the output symbol from the completed swap's direction, not the form's", () => {
    const result = view({ direction: "usdcToEusd", lifecycle: lifecycle({ completed: { ...completed, direction: "eusdToUsdc" } }) });
    expect(result.success?.symbolOut).toBe("USDC");
  });

  it("falls back to a generic chain name", () => {
    expect(view({ chainName: undefined, lifecycle: lifecycle({ completed }) }).success?.chainName).toBe("the selected network");
  });

  it.each([
    ["paused", { paused: true }],
    ["unavailable", { isSecurityCheckUnavailable: true, error: { tone: "error", message: "Balance unavailable" } }],
    ["unverified", { isContractVerified: false }],
    ["verifying", { isVerifying: true }],
    ["no balance", { balanceIn: 0n }],
  ] satisfies [string, Partial<VaultViewInput>][])("wins over %s", (_, overrides) => {
    const result = view({ ...overrides, lifecycle: lifecycle({ completed }) });
    expect(result.primary.kind).toBe("success");
    expect(result.success?.amountOutLabel).toBe("99.5");
  });

  it("gives way to a new transaction in flight", () => {
    const result = view({ lifecycle: lifecycle({ status: "preflight", kind: "swap", completed }) });
    expect(result.primary.kind).toBe("busy");
    expect(result.success).toBeUndefined();
  });
});

describe("deriveVaultView rows 7-9: vault reads", () => {
  it("row 7: shows verifying while contract reads load, with the read error", () => {
    const error = { tone: "warning", message: "The configured RPC and your wallet returned different values." } as const;
    const result = view({ isVerifying: true, isContractVerified: false, error });
    expect(result.primary).toEqual({ kind: "verifying", label: "Verifying vault contracts...", disabled: true });
    expect(result.notice).toEqual(error);
    expect(result.secondary).toEqual([]);
  });

  it("row 8: shows paused with the amber notice when the identity is verified", () => {
    const result = view({ paused: true });
    expect(result.primary).toEqual({ kind: "paused", label: "Swaps paused", disabled: true });
    expect(result.notice).toEqual({ tone: "warning", message: "Swaps are currently paused. Please check back later." });
    expect(result.secondary).toEqual([]);
  });

  it("row 8: shows paused when the identity is verified even if another read failed", () => {
    const result = view({ paused: true, isSecurityCheckUnavailable: true, error: { tone: "error", message: "Balance unavailable" } });
    expect(result.primary.kind).toBe("paused");
    expect(result.notice?.message).toBe("Swaps are currently paused. Please check back later.");
  });

  it("row 8: keeps the paused notice after a failed lifecycle", () => {
    const result = view({
      paused: true,
      lifecycle: lifecycle({
        status: "failed",
        kind: "swap",
        failure: { reason: "state-changed", error: new AppError("Swaps are paused", { tone: "warning" }) },
      }),
    });
    expect(result.primary.kind).toBe("paused");
    expect(result.notice?.message).toBe("Swaps are currently paused. Please check back later.");
  });

  it("row 9: shows unavailable for an unverified identity even when paused", () => {
    const result = view({ paused: true, isContractVerified: false });
    expect(result.primary).toEqual({ kind: "unavailable", label: "Security verification unavailable", disabled: true });
  });

  it("row 9: shows the read error when the security check is unavailable", () => {
    const error = { tone: "error", message: "Security verification failed" } as const;
    const result = view({ isSecurityCheckUnavailable: true, error });
    expect(result.primary.kind).toBe("unavailable");
    expect(result.notice).toEqual(error);
  });
});

describe("deriveVaultView row 10: live pending record", () => {
  it("is busy for a live swap record while idle, linking the record's hash", () => {
    const result = view({ lifecycle: lifecycle({ pending: { ...pending, kind: "swap" }, canSubmit: false }) });
    expect(result.primary).toEqual({ kind: "busy", label: "Swap pending...", disabled: true });
    expect(result.notice).toEqual({ tone: "info", message: WAITING, href: txHref, hrefLabel: "View on explorer" });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it("labels a live approval record", () => {
    expect(view({ lifecycle: lifecycle({ pending, canSubmit: false }) }).primary.label).toBe("Approval pending...");
  });

  it("offers Dismiss and no explorer link for a smart-account record while idle", () => {
    const result = view({ lifecycle: lifecycle({ smartAccount: true, pending: smartPending, canSubmit: false }) });
    expect(result.primary.label).toBe("Swap pending...");
    expect(result.notice?.message).toContain(SMART_ACCOUNT_FEE);
    expect(result.notice?.href).toBeUndefined();
    expect(result.secondary).toEqual([dismiss]);
  });

  it("does not offer Dismiss for an EOA record before it expires", () => {
    const result = view({ lifecycle: lifecycle({ pending, canSubmit: false }) });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it("hides the explorer link for a smart-account record even when the session is not one", () => {
    const result = view({ lifecycle: lifecycle({ pending: smartPending, canSubmit: false }) });
    expect(result.notice?.href).toBeUndefined();
    expect(result.secondary).toEqual([dismiss]);
  });

  describe("when this tab's sent transaction lost the record slot to another tab's", () => {
    const sentHash = `0x${"ef".repeat(32)}` as Hash;
    const conflict =
      "Your transaction was sent, but this page is already tracking a different transaction for this wallet. Check the explorer for the new transaction before sending another.";
    const lost = (overrides: Partial<VaultLifecycleState> = {}) =>
      lifecycle({
        status: "failed",
        kind: "approve",
        direction: "usdcToEusd",
        amountIn: units(50n),
        hash: sentHash,
        failure: { reason: "unknown", error: new AppError(conflict, { tone: "warning" }) },
        pending: { ...pending, kind: "swap" },
        canSubmit: false,
        ...overrides,
      });

    it("keeps the record's busy label and link but shows this tab's failure with a link to its own transaction", () => {
      const result = view({ lifecycle: lost() });
      expect(result.primary).toEqual({ kind: "busy", label: "Swap pending...", disabled: true });
      expect(result.notice).toEqual({
        tone: "warning",
        message: conflict,
        href: `${explorerUrl}/tx/${sentHash}`,
        hrefLabel: "View the transaction you sent.",
      });
      expect(result.secondary).toEqual([explorerLink]);
      expect(isUntrackedSend(lost())).toBe(true);
    });

    it("links nothing for a smart account's queue hash", () => {
      const result = view({ lifecycle: lost({ smartAccount: true, pending: smartPending }) });
      expect(result.notice).toEqual({ tone: "warning", message: conflict });
      expect(result.secondary).toEqual([dismiss]);
    });

    it("is not an untracked send when the hashes match, differ only in case, or the record expired", () => {
      expect(isUntrackedSend(lost({ hash }))).toBe(false);
      expect(isUntrackedSend(lost({ hash: hash.toUpperCase().replace("0X", "0x") as Hash }))).toBe(false);
      expect(isUntrackedSend(lost({ pending: { ...pending, expired: true } }))).toBe(false);
      expect(isUntrackedSend(lost({ hash: undefined }))).toBe(false);
      expect(isUntrackedSend(lost({ status: "idle" }))).toBe(false);
      expect(view({ lifecycle: lost({ hash }) }).notice?.message).toBe(WAITING);
    });
  });

  it("shows a live record over an earlier failure", () => {
    const result = view({
      lifecycle: lifecycle({
        status: "failed",
        failure: { reason: "rejected", error: new UserRejectedRequestError(new Error("rejected")) },
        pending: smartPending,
        canSubmit: false,
      }),
    });
    expect(result.primary.label).toBe("Swap pending...");
    expect(result.secondary).toEqual([dismiss]);
  });
});

describe("deriveVaultView rows 11-12a: notices carried to the form", () => {
  it("row 11: re-enables the step with a warning, Dismiss and the explorer for an expired record", () => {
    const result = view({ lifecycle: lifecycle({ pending: { ...pending, expired: true } }) });
    expect(result.primary).toEqual({ kind: "approve", label: "Step 1: Approve USDC", disabled: false, action: "approve" });
    expect(result.notice).toEqual({
      tone: "warning",
      message:
        "The transaction has not confirmed after 30 minutes. It may still be pending in your wallet; check the explorer before sending another.",
      href: txHref,
      hrefLabel: "View on explorer",
    });
    expect(result.secondary).toEqual([dismiss, explorerLink]);
  });

  it("row 11: names the smart-account TTL and links nothing for an expired smart-account record", () => {
    const result = view({ lifecycle: lifecycle({ smartAccount: true, pending: { ...smartPending, expired: true } }) });
    expect(result.notice).toEqual({
      tone: "warning",
      message:
        "The transaction has not executed after 7 days. It may still be waiting in your smart account's queue; check it there before sending another.",
    });
    expect(result.secondary).toEqual([dismiss]);
  });

  it("row 12: shows the info-tone copy and an enabled button after a wallet rejection", () => {
    const result = view({
      lifecycle: lifecycle({
        status: "failed",
        kind: "approve",
        failure: { reason: "rejected", error: new UserRejectedRequestError(new Error("User rejected the request.")) },
      }),
    });
    expect(result.primary).toEqual({ kind: "approve", label: "Step 1: Approve USDC", disabled: false, action: "approve" });
    expect(result.notice).toEqual({ tone: "info", message: CANCELLED });
    expect(result.secondary).toEqual([]);
  });

  it("row 12: shows the error's own copy and links the explorer after a failure with a hash", () => {
    const message = "This swap transaction reverted. It did not move any funds. Check your balances before trying again.";
    const result = view({
      allowanceIn: units(1_000n),
      lifecycle: lifecycle({ status: "failed", kind: "swap", hash, failure: { reason: "reverted", error: new AppError(message) } }),
    });
    expect(result.primary.kind).toBe("swap");
    expect(result.notice).toEqual({ tone: "error", message });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it("row 12: never shows raw error text, falling back to generic copy", () => {
    const raw = new Error("execution reverted\nURL: https://rpc.example/v2/secret-key\nRequest body: {...}");
    const result = view({ lifecycle: lifecycle({ status: "failed", failure: { reason: "unknown", error: raw } }) });
    expect(result.notice).toEqual({ tone: "error", message: "The transaction could not be completed." });
  });

  it("row 12: falls back to generic copy when the failure is missing", () => {
    const result = view({ lifecycle: lifecycle({ status: "failed" }) });
    expect(result.notice).toEqual({ tone: "error", message: "The transaction could not be completed." });
  });

  it("row 12: drops the notice once the failure is acknowledged", () => {
    const result = view({ lifecycle: lifecycle({ status: "idle", failure: { reason: "reverted", error: new AppError("x") } }) });
    expect(result.notice).toBeUndefined();
  });

  it("row 12a: shows a success notice when live state settled an approval", () => {
    const result = view({
      allowanceIn: units(1_000n),
      lifecycle: lifecycle({ settledExternally: { kind: "approve", direction: "usdcToEusd", hash } }),
    });
    expect(result.primary.kind).toBe("swap");
    expect(result.notice).toEqual({
      tone: "success",
      message: "Your approval was confirmed.",
      href: txHref,
      hrefLabel: "View the transaction.",
    });
    expect(result.secondary).toEqual([explorerLink]);
  });

  it("row 12a: omits the link for a smart account's settled approval", () => {
    const result = view({
      lifecycle: lifecycle({ smartAccount: true, settledExternally: { kind: "approve", direction: "usdcToEusd", hash } }),
    });
    expect(result.notice).toEqual({ tone: "success", message: "Your approval was confirmed." });
    expect(result.secondary).toEqual([]);
  });

  it("carries the notice and secondaries into a disabled form row", () => {
    const result = view({ balanceIn: 0n, lifecycle: lifecycle({ pending: { ...pending, expired: true } }) });
    expect(result.primary.kind).toBe("no-balance");
    expect(result.notice?.message).toContain("has not confirmed after 30 minutes");
    expect(result.secondary).toEqual([dismiss, explorerLink]);
  });

  it("lets a form row's own notice replace the carried one but keeps Dismiss", () => {
    const result = view({
      maxPerTransaction: toWad(units(50n), 6),
      lifecycle: lifecycle({ pending: { ...pending, expired: true } }),
    });
    expect(result.primary.kind).toBe("over-limit");
    expect(result.notice?.message).toBe("The vault accepts at most 50 USDC per swap.");
    expect(result.secondary).toEqual([dismiss, explorerLink]);
  });
});

describe("deriveVaultView rows 13-24: the form", () => {
  it("row 13: shows no balance when there is nothing to swap", () => {
    expect(view({ balanceIn: 0n }).primary).toEqual({ kind: "no-balance", label: "No USDC balance", disabled: true });
  });

  it.each([
    ["empty", { status: "empty" }],
    ["zero", valid(0n)],
  ] satisfies [string, AmountInput][])("row 14: asks for an amount when it is %s", (_, amount) => {
    expect(view({ amount }).primary).toEqual({ kind: "enter-amount", label: "Enter an amount", disabled: true });
  });

  it("row 15: asks for a valid amount", () => {
    expect(view({ amount: { status: "invalid" } }).primary).toEqual({
      kind: "invalid-amount",
      label: "Enter a valid USDC amount",
      disabled: true,
    });
  });

  it("row 16: blocks an amount above the balance, and allows the whole balance", () => {
    expect(view({ amount: valid(units(1_000n) + 1n) }).primary).toEqual({
      kind: "insufficient-balance",
      label: "Insufficient USDC balance",
      disabled: true,
    });
    expect(view({ amount: valid(units(1_000n)) }).primary.kind).toBe("approve");
  });

  it("row 17: allows an amount equal to the per-transaction cap and blocks one unit more", () => {
    const maxPerTransaction = toWad(units(100n), 6);
    expect(view({ maxPerTransaction, amount: valid(units(100n)) }).primary.kind).toBe("approve");
    const result = view({ maxPerTransaction, amount: valid(units(100n) + 1n) });
    expect(result.primary).toEqual({ kind: "over-limit", label: "Above the per-transaction limit", disabled: true });
    expect(result.notice).toEqual({ tone: "warning", message: "The vault accepts at most 100 USDC per swap." });
  });

  it("row 18: allows an amount equal to the per-block cap and blocks one unit more", () => {
    const maxPerBlock = toWad(units(100n), 6);
    expect(view({ maxPerBlock, amount: valid(units(100n)) }).primary.kind).toBe("approve");
    const result = view({ maxPerBlock, amount: valid(units(100n) + 1n) });
    expect(result.primary).toEqual({ kind: "over-limit", label: "Above the per-block limit", disabled: true });
    expect(result.notice).toEqual({ tone: "warning", message: "The vault accepts at most 100 USDC per block." });
  });

  it("rows 17-18: treat a zero cap as off", () => {
    expect(view({ maxPerTransaction: 0n, maxPerBlock: 0n, amount: valid(units(1_000n)) }).primary.kind).toBe("approve");
  });

  it("rows 17-18: show a fractional cap rounded down to token units", () => {
    const maxPerTransaction = toWad(1_500_000n, 6) + 500_000_000_000n; // 1.5000005 tokens
    const result = view({ maxPerTransaction, amount: valid(1_500_001n) });
    expect(result.notice?.message).toBe("The vault accepts at most 1.5 USDC per swap.");
    expect(view({ maxPerTransaction, amount: valid(1_500_000n) }).primary.kind).toBe("approve");
  });

  it("row 17 comes before row 18", () => {
    const cap = toWad(units(50n), 6);
    expect(view({ maxPerTransaction: cap, maxPerBlock: cap }).primary.label).toBe("Above the per-transaction limit");
  });

  it.each([
    ["loading", { status: "loading" }],
    ["idle", { status: "idle" }],
    ["for the other direction", quoteFor("eusdToUsdc", units(100n))],
    ["for another amount", quoteFor("usdcToEusd", units(99n))],
  ] satisfies [string, QuoteState][])("row 19: shows loading when the quote is %s", (_, quote) => {
    const result = view({ quote, allowanceIn: units(1_000n) });
    expect(result.primary).toEqual({ kind: "quote-loading", label: "Fetching quote...", disabled: true });
    expect(result.primary.action).toBeUndefined();
  });

  it("row 20: shows the quote as unavailable after a quote error", () => {
    const result = view({ quote: { status: "error", error: { tone: "error", message: "HTTP request failed." } } });
    expect(result.primary).toEqual({ kind: "quote-unavailable", label: "Quote unavailable", disabled: true });
    expect(result.notice).toEqual({ tone: "warning", message: "The vault did not return a quote. Try again shortly." });
  });

  it("row 21: blocks an amount that quotes to zero", () => {
    const quote: QuoteState = { status: "ready", direction: "usdcToEusd", amountIn: 1n, quote: { amountOut: 0n, fee: 1n } };
    expect(view({ amount: valid(1n), quote }).primary).toEqual({ kind: "amount-too-small", label: "Amount too small", disabled: true });
  });

  it("row 22: allows a reserve equal to output plus fee and blocks one unit less", () => {
    // The default quote pays 99 eUSD with a 1 eUSD fee.
    expect(view({ outputReserve: units(100n) }).primary.kind).toBe("approve");
    const result = view({ outputReserve: units(100n) - 1n });
    expect(result.primary).toEqual({ kind: "insufficient-reserves", label: "Not enough eUSD in the vault", disabled: true });
    expect(result.notice).toEqual({
      tone: "warning",
      message: "The vault currently holds 99.999999 eUSD. Enter a smaller amount.",
    });
  });

  it("row 23: asks for Step 1 when the allowance is short", () => {
    const result = view({ allowanceIn: units(100n) - 1n });
    expect(result.primary).toEqual({ kind: "approve", label: "Step 1: Approve USDC", disabled: false, action: "approve" });
    expect(result.showStepOneComplete).toBe(false);
    expect(result.notice).toBeUndefined();
    expect(result.secondary).toEqual([]);
  });

  it("row 24: skips Step 1 when the allowance covers the amount", () => {
    const result = view({ allowanceIn: units(100n) });
    expect(result.primary).toEqual({ kind: "swap", label: "Step 2: Swap USDC for eUSD", disabled: false, action: "swap" });
    expect(result.showStepOneComplete).toBe(true);
  });

  it("rows 23-24: disable the step buttons while the lifecycle cannot submit", () => {
    expect(view({ lifecycle: lifecycle({ canSubmit: false }) }).primary).toMatchObject({ kind: "approve", disabled: true });
    expect(view({ allowanceIn: units(100n), lifecycle: lifecycle({ canSubmit: false }) }).primary).toMatchObject({
      kind: "swap",
      disabled: true,
    });
  });

  it.each([
    ["usdcToEusd", "USDC", "eUSD"],
    ["eusdToUsdc", "eUSD", "USDC"],
  ] as const)("symbols follow the %s direction in every label", (direction, symbolIn, symbolOut) => {
    const cap = toWad(units(50n), 6);
    expect(view({ direction, balanceIn: 0n }).primary.label).toBe(`No ${symbolIn} balance`);
    expect(view({ direction, amount: { status: "invalid" } }).primary.label).toBe(`Enter a valid ${symbolIn} amount`);
    expect(view({ direction, amount: valid(units(2_000n)) }).primary.label).toBe(`Insufficient ${symbolIn} balance`);
    expect(view({ direction, maxPerTransaction: cap }).notice?.message).toBe(`The vault accepts at most 50 ${symbolIn} per swap.`);
    expect(view({ direction, maxPerBlock: cap }).notice?.message).toBe(`The vault accepts at most 50 ${symbolIn} per block.`);
    const reserve = view({ direction, outputReserve: units(10n) });
    expect(reserve.primary.label).toBe(`Not enough ${symbolOut} in the vault`);
    expect(reserve.notice?.message).toBe(`The vault currently holds 10 ${symbolOut}. Enter a smaller amount.`);
    expect(view({ direction }).primary.label).toBe(`Step 1: Approve ${symbolIn}`);
    expect(view({ direction, allowanceIn: units(100n) }).primary.label).toBe(`Step 2: Swap ${symbolIn} for ${symbolOut}`);
    const success = view({ direction, lifecycle: lifecycle({ completed: { ...completed, direction } }) });
    expect(success.success?.symbolOut).toBe(symbolOut);
  });
});

describe("deriveVaultView form lock", () => {
  it("leaves the form open while idle and able to submit", () => {
    const result = view();
    expect(result.lockForm).toBe(false);
    expect(result.formOverride).toBeUndefined();
  });

  it("leaves the form open after a failure", () => {
    const result = view({
      lifecycle: lifecycle({ status: "failed", direction: "eusdToUsdc", amountIn: units(5n), failure: { reason: "unknown", error: new Error("x") } }),
    });
    expect(result.lockForm).toBe(false);
    expect(result.formOverride).toBeUndefined();
  });

  it("locks the form and shows the pending record's direction and amount while confirming", () => {
    const result = view({
      direction: "usdcToEusd",
      amount: valid(units(100n)),
      lifecycle: lifecycle({
        status: "confirming",
        kind: "swap",
        hash,
        direction: "eusdToUsdc",
        amountIn: units(5n),
        pending: { ...pending, kind: "swap", direction: "eusdToUsdc", amountIn: units(5n) },
        canSubmit: false,
      }),
    });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toEqual({ direction: "eusdToUsdc", amountIn: units(5n) });
  });

  it("uses the in-flight request's direction and amount before a record exists", () => {
    const result = view({
      lifecycle: lifecycle({ status: "signing", kind: "swap", direction: "eusdToUsdc", amountIn: units(7n), canSubmit: false }),
    });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toEqual({ direction: "eusdToUsdc", amountIn: units(7n) });
  });

  it.each(["preflight", "signing"] as const)(
    "shows the new request's direction and amount, not an expired record's, during %s",
    (status) => {
      const result = view({
        lifecycle: lifecycle({
          status,
          kind: "approve",
          direction: "usdcToEusd",
          amountIn: units(50n),
          pending: expiredSwap,
          canSubmit: false,
        }),
      });
      expect(result.lockForm).toBe(true);
      expect(result.formOverride).toEqual({ direction: "usdcToEusd", amountIn: units(50n) });
    }
  );

  it("leaves no override after a request over an expired record is rejected", () => {
    const result = view({
      lifecycle: lifecycle({
        status: "failed",
        kind: "approve",
        direction: "usdcToEusd",
        amountIn: units(50n),
        failure: { reason: "rejected", error: new UserRejectedRequestError(new Error("rejected")) },
        pending: expiredSwap,
      }),
    });
    expect(result.lockForm).toBe(false);
    expect(result.formOverride).toBeUndefined();
  });

  it("never takes the override from an expired record while the form is locked", () => {
    const result = view({ lifecycle: lifecycle({ pending: expiredSwap, canSubmit: false }) });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toBeUndefined();
  });

  it("lets a live record win over a failed attempt's values", () => {
    const result = view({
      lifecycle: lifecycle({
        status: "failed",
        kind: "approve",
        direction: "usdcToEusd",
        amountIn: units(50n),
        failure: { reason: "unknown", error: new AppError("x", { tone: "warning" }) },
        pending: { ...pending, direction: "eusdToUsdc", amountIn: units(3n) },
        canSubmit: false,
      }),
    });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toEqual({ direction: "eusdToUsdc", amountIn: units(3n) });
  });

  it("locks the form for a live record from another tab", () => {
    const result = view({
      lifecycle: lifecycle({ pending: { ...pending, direction: "eusdToUsdc", amountIn: units(3n) }, canSubmit: false }),
    });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toEqual({ direction: "eusdToUsdc", amountIn: units(3n) });
  });

  it("locks the form without an override when nothing is in flight", () => {
    const result = view({ lifecycle: lifecycle({ canSubmit: false }) });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toBeUndefined();
  });

  it("leaves the form open for a visitor without a wallet, who cannot submit", () => {
    const result = view({ address: undefined, lifecycle: lifecycle({ canSubmit: false }) });
    expect(result.primary.kind).toBe("connect");
    expect(result.lockForm).toBe(false);
    expect(result.formOverride).toBeUndefined();
  });

  it("locks the form while settling even when the lifecycle could submit", () => {
    const result = view({
      lifecycle: lifecycle({ status: "confirmed", kind: "approve", hash, direction: "usdcToEusd", amountIn: units(100n), canSubmit: true }),
    });
    expect(result.lockForm).toBe(true);
    expect(result.formOverride).toEqual({ direction: "usdcToEusd", amountIn: units(100n) });
  });
});

describe("deriveVaultView network switch error", () => {
  const switchError = { tone: "error", message: "Your wallet did not switch networks. Try again, or switch networks in your wallet." } as const;

  it("shows a refused switch under the switch-network button", () => {
    const result = view({ isWrongNetwork: true, switchError });
    expect(result.primary).toMatchObject({ kind: "switch-network", disabled: false });
    expect(result.notice).toEqual(switchError);
  });

  it("carries a refused switch to the form when nothing else is shown", () => {
    const result = view({ switchError });
    expect(result.primary.kind).toBe("approve");
    expect(result.notice).toEqual(switchError);
  });

  it("gives way to a failure notice and to a row's own notice", () => {
    const failed = view({
      switchError,
      lifecycle: lifecycle({ status: "failed", failure: { reason: "unknown", error: new AppError("Try a smaller amount.") } }),
    });
    expect(failed.notice?.message).toBe("Try a smaller amount.");

    const overCap = view({ switchError, maxPerTransaction: toWad(units(50n), 6) });
    expect(overCap.notice?.message).toBe("The vault accepts at most 50 USDC per swap.");
  });

  it("is not shown without a wallet", () => {
    expect(view({ address: undefined, switchError }).notice).toBeUndefined();
  });
});

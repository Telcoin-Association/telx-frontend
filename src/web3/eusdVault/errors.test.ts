/** @jest-environment node */
import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  HttpRequestError,
  UnknownRpcError,
  UserRejectedRequestError,
} from "viem";
import { erc20Abi } from "./abis";
import {
  AppError,
  ProvidersDisagreeError,
  QuoteUnavailableError,
  ReceiptVerificationError,
  TransactionReplacedError,
  VaultIdentityError,
  VaultStateChangedError,
  describeError,
} from "./errors";
import type { ReceiptVerificationReason, StateChange } from "./types";

const CANCELLED = {
  tone: "info",
  message: "Wallet request cancelled. No transaction was sent.",
};
const GENERIC = { tone: "error", message: "Security verification failed" };

describe("describeError", () => {
  it("maps a viem user rejection to a calm notice", () => {
    const error = new UserRejectedRequestError(new Error("User rejected the request."));

    expect(describeError(error)).toEqual(CANCELLED);
  });

  it("finds a rejection wrapped by another viem error", () => {
    const rejection = new UserRejectedRequestError(new Error("denied"));
    const wrapped = new BaseError("Transaction failed.", { cause: rejection });

    expect(describeError(wrapped)).toEqual(CANCELLED);
  });

  it("finds a duck-typed 4001 code three levels deep", () => {
    const error = new Error("outer", {
      cause: new Error("middle", {
        cause: { code: 4001, message: "User denied transaction signature." },
      }),
    });

    expect(describeError(error)).toEqual(CANCELLED);
  });

  it("finds a duck-typed rejection by name", () => {
    expect(describeError({ name: "UserRejectedRequestError" })).toEqual(CANCELLED);
  });

  it("maps ethers' ACTION_REJECTED to the same notice", () => {
    expect(describeError(Object.assign(new Error("user rejected transaction"), { code: "ACTION_REJECTED" }))).toEqual(
      CANCELLED
    );
  });

  it("puts a rejection ahead of AppError copy", () => {
    const error = new AppError("Approval failed", { cause: { code: 4001 } });

    expect(describeError(error)).toEqual(CANCELLED);
  });

  it("stops walking causes after ten levels", () => {
    let error: unknown = { code: 4001 };
    for (let level = 0; level < 12; level += 1) {
      error = new Error(`level ${level}`, { cause: error });
    }

    expect(describeError(error)).toEqual({ tone: "error", message: "level 11" });
  });

  it("renders AppError copy with its tone", () => {
    const error = new AppError("Allowance is below the amount", { tone: "warning" });

    expect(describeError(error)).toEqual({ tone: "warning", message: "Allowance is below the amount" });
  });

  it("defaults AppError to the error tone", () => {
    expect(describeError(new AppError("Plain copy"))).toEqual({ tone: "error", message: "Plain copy" });
  });

  describe("with an AppError down the cause chain", () => {
    const MOVED = "Your wallet switched to another network. Switch it back to continue.";
    const moved = () => new AppError(MOVED, { tone: "warning" });
    // How viem reports a contract read whose client `request` threw.
    const contractCall = (cause: BaseError) =>
      new ContractFunctionExecutionError(cause, {
        abi: erc20Abi,
        functionName: "approve",
        args: ["0xc72178D412256a6Dc5f04D749859b4cd95076d61", 1n],
        contractAddress: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949",
      });

    it.each<[string, () => unknown]>([
      ["one level deep in a plain Error", () => new Error("Request failed", { cause: moved() })],
      [
        "three levels deep in plain Errors",
        () => new Error("one", { cause: new Error("two", { cause: new Error("three", { cause: moved() }) }) }),
      ],
      ["one level deep in a viem error", () => new UnknownRpcError(moved())],
      ["three levels deep in viem's call errors", () => contractCall(new CallExecutionError(new UnknownRpcError(moved()), {}))],
    ])("shows its copy and tone when it sits %s", (_label, build) => {
      expect(describeError(build())).toEqual({ tone: "warning", message: MOVED });
    });

    it("shows the outermost one", () => {
      const error = new Error("wrapper", { cause: new AppError("Outer copy", { cause: new AppError("Inner copy") }) });

      expect(describeError(error)).toEqual({ tone: "error", message: "Outer copy" });
    });

    it.each<[string, () => unknown]>([
      ["below it", () => new UnknownRpcError(new AppError(MOVED, { cause: { code: 4001 } }))],
      ["above it", () => new BaseError("Transaction failed.", { cause: new UserRejectedRequestError(moved()) })],
    ])("still puts a rejection %s first", (_label, build) => {
      expect(describeError(build())).toEqual(CANCELLED);
    });

    it("stops looking after ten levels", () => {
      let error: unknown = moved();
      for (let level = 0; level < 12; level += 1) {
        error = new Error(`level ${level}`, { cause: error });
      }

      expect(describeError(error)).toEqual({ tone: "error", message: "level 11" });
    });

    it("ends a cyclic cause chain", () => {
      const first = new Error("first");
      const second = new Error("second", { cause: first });
      Object.assign(first, { cause: second });

      expect(describeError(second)).toEqual({ tone: "error", message: "second" });
    });
  });

  it("uses only the first line of a viem short message", () => {
    const error = new BaseError("Execution reverted.\nSecond line", {
      details: "revert",
      metaMessages: ["Request Arguments:", "  to: 0x1234"],
    });

    expect(describeError(error)).toEqual({ tone: "error", message: "Execution reverted." });
  });

  it("uses the short message of a viem subclass", () => {
    const error = new ContractFunctionExecutionError(new BaseError("Execution reverted for an unknown reason."), {
      abi: erc20Abi,
      functionName: "approve",
      args: ["0xc72178D412256a6Dc5f04D749859b4cd95076d61", 1n],
      contractAddress: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949",
    });

    // The raw message carries call details that must never reach the user.
    expect(error.message).toContain("Contract Call:");
    expect(describeError(error)).toEqual({ tone: "error", message: "Execution reverted for an unknown reason." });
  });

  it("never shows an RPC URL or request body", () => {
    const error = new HttpRequestError({
      url: "https://polygon-mainnet.example.com/v2/secret-key",
      body: { method: "eth_call", params: ["0xdeadbeef"] },
      status: 500,
    });
    const description = describeError(error);

    expect(error.message).toContain("secret-key");
    expect(description.message).not.toContain("secret-key");
    expect(description.message).not.toContain("eth_call");
    expect(description).toEqual({ tone: "error", message: "HTTP request failed." });
  });

  it("caps a viem short message at 200 characters", () => {
    const description = describeError(new BaseError("x".repeat(300)));

    expect(description.tone).toBe("error");
    expect(description.message).toHaveLength(200);
  });

  it("duck-types a nested viem copy by its short message", () => {
    expect(describeError({ shortMessage: "Nested copy\nDetails: ignored" })).toEqual({
      tone: "error",
      message: "Nested copy",
    });
  });

  it("falls back to the generic message for an empty short message", () => {
    expect(describeError({ shortMessage: "  \n" })).toEqual(GENERIC);
  });

  it("renders a short single-line plain Error message", () => {
    const message = "Vault contract identity does not match the pinned addresses";

    expect(describeError(new Error(message))).toEqual({ tone: "error", message });
  });

  it("hides a multi-line plain Error message", () => {
    expect(describeError(new Error("line one\nline two"))).toEqual(GENERIC);
  });

  it("hides a plain Error message longer than 160 characters", () => {
    expect(describeError(new Error("x".repeat(160)))).toEqual({ tone: "error", message: "x".repeat(160) });
    expect(describeError(new Error("x".repeat(161)))).toEqual(GENERIC);
  });

  it("hides an empty plain Error message", () => {
    expect(describeError(new Error(""))).toEqual(GENERIC);
    expect(describeError(new Error("   "))).toEqual(GENERIC);
  });

  it.each([undefined, null, "boom", 42, { message: "not an Error" }])("renders the generic message for %p", (value) => {
    expect(describeError(value)).toEqual(GENERIC);
  });
});

describe("describeError fallback", () => {
  const FALLBACK = "The transaction could not be completed.";

  it("uses the caller's fallback when nothing safe can be shown", () => {
    expect(describeError({ unexpected: true }, FALLBACK)).toEqual({ tone: "error", message: FALLBACK });
    expect(describeError(new Error("line one\nline two"), FALLBACK)).toEqual({ tone: "error", message: FALLBACK });
    expect(describeError({ shortMessage: "  " }, FALLBACK)).toEqual({ tone: "error", message: FALLBACK });
  });

  it("does not replace a message written for the user, or a rejection", () => {
    expect(describeError(new AppError("Try a smaller amount."), FALLBACK).message).toBe("Try a smaller amount.");
    expect(describeError({ code: 4001 }, FALLBACK)).toEqual(CANCELLED);
  });
});

describe("AppError", () => {
  it("keeps a cause without rendering it", () => {
    const cause = new Error("https://rpc.example/secret");
    const error = new AppError("Short copy", { cause });

    expect(error.cause).toBe(cause);
    expect(describeError(error)).toEqual({ tone: "error", message: "Short copy" });
  });

  it("sets no cause when none is given", () => {
    expect("cause" in new AppError("No cause")).toBe(false);
  });

  it("is an Error named AppError", () => {
    const error = new AppError("Named");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(String(error)).toBe("AppError: Named");
  });
});

describe("ProvidersDisagreeError", () => {
  it("asks the user to try again, as a warning", () => {
    const error = new ProvidersDisagreeError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(ProvidersDisagreeError);
    expect(error.name).toBe("ProvidersDisagreeError");
    expect(describeError(error)).toEqual({
      tone: "warning",
      message: "The configured RPC and your wallet returned different values. Wait a moment and try again.",
    });
  });
});

describe("VaultStateChangedError", () => {
  const changes: StateChange[] = [
    "balance",
    "allowance",
    "quote",
    "zero-output",
    "per-transaction",
    "per-block",
    "reserves",
    "paused",
  ];

  it.each(changes)("carries %s with default copy", (change) => {
    const error = new VaultStateChangedError(change);
    const description = describeError(error);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(VaultStateChangedError);
    expect(error.name).toBe("VaultStateChangedError");
    expect(error.change).toBe(change);
    expect(error.retryable).toBe(change !== "paused");
    expect(description.tone).toBe("warning");
    expect(description.message).toBe(error.message);
    expect(description.message).toMatch(/\.$/);
    expect(description.message).not.toMatch(/[!—]/);
  });

  it("uses the Step 1 copy for an allowance change and the paused copy from the view", () => {
    expect(new VaultStateChangedError("allowance").message).toContain("Start again from Step 1.");
    expect(new VaultStateChangedError("paused").message).toBe("Swaps are currently paused. Please check back later.");
  });

  it("takes a message, a retry flag and a cause", () => {
    const cause = new Error("simulated");
    const error = new VaultStateChangedError("quote", {
      message: "The vault's quote changed from 5 to 4.99. Review the new amount and confirm again.",
      retryable: false,
      cause,
    });

    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
    expect(describeError(error)).toEqual({
      tone: "warning",
      message: "The vault's quote changed from 5 to 4.99. Review the new amount and confirm again.",
    });
  });
});

describe("VaultIdentityError", () => {
  it.each(["chain", "contracts"] as const)("fails security verification on a %s mismatch", (mismatch) => {
    const error = new VaultIdentityError(mismatch);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(VaultIdentityError);
    expect(error.name).toBe("VaultIdentityError");
    expect(describeError(error)).toEqual({ tone: "error", message: error.message });
    expect(error.message).toMatch(/^Security verification failed: /);
  });

  it("names the network for a chain mismatch", () => {
    expect(new VaultIdentityError("chain").message).toContain("network");
    expect(new VaultIdentityError("contracts").message).toContain("identity");
  });
});

describe("QuoteUnavailableError", () => {
  it("uses the view's quote copy and keeps the cause", () => {
    const cause = new Error("preview reverted");
    const error = new QuoteUnavailableError({ cause });

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(QuoteUnavailableError);
    expect(error.name).toBe("QuoteUnavailableError");
    expect(error.cause).toBe(cause);
    expect(describeError(error)).toEqual({
      tone: "warning",
      message: "The vault did not return a quote. Try again shortly.",
    });
  });
});

describe("TransactionReplacedError", () => {
  it("reports a cancelled swap calmly", () => {
    const error = new TransactionReplacedError("swap", "cancelled");

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(TransactionReplacedError);
    expect(error.name).toBe("TransactionReplacedError");
    expect(error.kind).toBe("swap");
    expect(error.reason).toBe("cancelled");
    expect(describeError(error)).toEqual({
      tone: "info",
      message: "The swap transaction was cancelled in your wallet. It did not move any funds.",
    });
  });

  it("sends a replaced approval to the explorer as a warning", () => {
    const error = new TransactionReplacedError("approve", "replaced");

    expect(error.kind).toBe("approve");
    expect(error.reason).toBe("replaced");
    expect(describeError(error)).toEqual({
      tone: "warning",
      message:
        "The approval transaction was replaced by another transaction from your wallet. Check the block explorer before trying again.",
    });
  });

  it("says nothing was approved for a cancelled approval", () => {
    expect(new TransactionReplacedError("approve", "cancelled").message).toBe(
      "The approval transaction was cancelled in your wallet. Nothing was approved."
    );
  });
});

describe("ReceiptVerificationError", () => {
  it("says a reverted swap moved no funds", () => {
    const error = new ReceiptVerificationError("swap", "reverted");

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(ReceiptVerificationError);
    expect(error.name).toBe("ReceiptVerificationError");
    expect(error.kind).toBe("swap");
    expect(error.reason).toBe("reverted");
    expect(describeError(error)).toEqual({
      tone: "error",
      message: "This swap transaction reverted. It did not move any funds. Check your balances before trying again.",
    });
  });

  const reasons: ReceiptVerificationReason[] = ["reverted", "missing-event", "post-state", "unverifiable"];

  it.each(reasons.flatMap((reason) => (["approve", "swap"] as const).map((kind) => [kind, reason] as const)))(
    "has plain copy for a %s that failed with %s",
    (kind, reason) => {
      const cause = new Error("receipt");
      const error = new ReceiptVerificationError(kind, reason, { cause });

      expect(error.kind).toBe(kind);
      expect(error.reason).toBe(reason);
      expect(error.cause).toBe(cause);
      expect(describeError(error)).toEqual({ tone: "error", message: error.message });
      expect(error.message).toMatch(/\.$/);
      expect(error.message).not.toMatch(/[!—]|TEL|upgrade|migrat/i);
    }
  );
});

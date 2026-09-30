/** @jest-environment node */
import {
  HttpRequestError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { ReceiptVerificationError, TransactionReplacedError } from "./errors";
import { pendingTtlMs } from "./pendingRecords";
import { VAULT_POST_STATE_RETRY_DELAY_MS, VAULT_WATCHER_TIMINGS, watchReceipt } from "./receiptWatcher";
import {
  TEST_NOW,
  TEST_TX_HASH,
  TEST_WALLET,
  approvalLog,
  approveReceiptFor,
  buildPendingApproveRecord,
  buildPendingSwapRecord,
  buildReceipt,
  swapLog,
  swapReceiptFor,
} from "./testing/receipts";
import type {
  ReceiptWatcherDeps,
  ReplacementReason,
  SmartAccountCallsStatus,
  WaitForReceiptParams,
  WatchOutcome,
  WatchProgress,
} from "./types";

const OWNER: Address = "0x6666666666666666666666666666666666666666";
const OTHER_SPENDER: Address = "0x7777777777777777777777777777777777777777";

const approveRecord = buildPendingApproveRecord();
const swapRecord = buildPendingSwapRecord({ quotedOut: 249_900_000n, quotedFee: 100_000n });
const smartApproveRecord = buildPendingApproveRecord({ smartAccount: true, connectorId: "walletConnect" });
const smartSwapRecord = buildPendingSwapRecord({ smartAccount: true, connectorId: "walletConnect" });

const approveReceipt = approveReceiptFor(approveRecord);
const swapReceipt = swapReceiptFor(swapRecord);
// A smart account executes through its own contract, so the receipt comes from an owner and goes to the account.
const smartApproveReceipt = approveReceiptFor(smartApproveRecord, { from: OWNER, to: smartApproveRecord.address });
const smartSwapReceipt = swapReceiptFor(smartSwapRecord, { from: OWNER, to: smartSwapRecord.address });

type Harness = Readonly<{
  deps: ReceiptWatcherDeps;
  controller: AbortController;
  waitForReceipt: jest.Mock<Promise<TransactionReceipt>, [WaitForReceiptParams]>;
  readAllowanceAt: jest.Mock<Promise<bigint>, [bigint]>;
  sleep: jest.Mock<Promise<void>, [number, AbortSignal]>;
  onProgress: jest.Mock<void, [WatchProgress]>;
  clock: { now: number };
}>;

function harness(overrides: Partial<ReceiptWatcherDeps> = {}, clockStart = TEST_NOW + 1): Harness {
  const controller = new AbortController();
  const clock = { now: clockStart };
  const waitForReceipt = jest.fn<Promise<TransactionReceipt>, [WaitForReceiptParams]>();
  // Reads answer with the pre-approval state unless a test says otherwise.
  const readAllowanceAt = jest.fn<Promise<bigint>, [bigint]>(async () => 0n);
  // Sleeping moves the fake clock, so a watch that never settles runs into its TTL instead of spinning.
  const sleep = jest.fn<Promise<void>, [number, AbortSignal]>(async (ms) => {
    clock.now += ms;
  });
  const onProgress = jest.fn<void, [WatchProgress]>();
  const deps: ReceiptWatcherDeps = {
    waitForReceipt,
    readAllowanceAt,
    now: () => clock.now,
    sleep,
    onProgress,
    ...overrides,
  };
  return { deps, controller, waitForReceipt, readAllowanceAt, sleep, onProgress, clock };
}

function statusFake(impl: () => Promise<SmartAccountCallsStatus>) {
  return jest.fn<Promise<SmartAccountCallsStatus>, [Hash]>(impl);
}

function resolveWith(receipt: TransactionReceipt, reason?: ReplacementReason) {
  return async (params: WaitForReceiptParams) => {
    if (reason) params.onReplaced({ reason });
    return receipt;
  };
}

function timeout() {
  return new WaitForTransactionReceiptTimeoutError({ hash: TEST_TX_HASH });
}

function failureOf(outcome: WatchOutcome) {
  if (outcome.type !== "failed") throw new Error(`expected a failure, got ${outcome.type}`);
  return outcome;
}

const cancelReceipt = buildReceipt({ from: TEST_WALLET, to: TEST_WALLET, logs: [] });

describe("watchReceipt", () => {
  describe("approve", () => {
    it("confirms an approval whose receipt and allowance check out", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValue(approveRecord.amountIn);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(1);
      expect(h.readAllowanceAt).toHaveBeenCalledWith(approveReceipt.blockNumber);
      expect(h.sleep).not.toHaveBeenCalled();
      expect(h.onProgress.mock.calls).toEqual([[{ attempt: 0, phase: "verifying" }]]);
    });

    it("confirms when the allowance is above the amount", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValue(approveRecord.amountIn + 1n);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
    });

    it("confirms after a short allowance when the second read covers the amount", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValueOnce(approveRecord.amountIn - 1n).mockResolvedValueOnce(approveRecord.amountIn);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
      expect(h.readAllowanceAt.mock.calls).toEqual([[approveReceipt.blockNumber], [approveReceipt.blockNumber]]);
      expect(h.sleep.mock.calls).toEqual([[VAULT_POST_STATE_RETRY_DELAY_MS, h.controller.signal]]);
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("confirms after a failed allowance read when the second read covers the amount", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt
        .mockRejectedValueOnce(new Error("header not found"))
        .mockResolvedValueOnce(approveRecord.amountIn);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(2);
      expect(h.sleep.mock.calls).toEqual([[VAULT_POST_STATE_RETRY_DELAY_MS, h.controller.signal]]);
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("fails the post-state check when the allowance is short twice", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValue(approveRecord.amountIn - 1n);

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).toBeInstanceOf(ReceiptVerificationError);
      expect(failure.error).toMatchObject({ kind: "approve", reason: "post-state" });
      expect(failure.error.message).toBe(
        "The transaction was mined, but the resulting allowance did not match. Check it on the block explorer before trying again."
      );
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(2);
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("fails as unverifiable when the allowance read fails twice", async () => {
      const h = harness();
      const readError = new Error("header not found");
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockRejectedValue(readError);

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).toBeInstanceOf(ReceiptVerificationError);
      expect(failure.error).toMatchObject({ kind: "approve", reason: "unverifiable" });
      expect(failure.error.cause).toBe(readError);
      expect(failure.error.message).toContain("could not be verified");
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(2);
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("lets the second read decide when the first read failed and the second is short", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockRejectedValueOnce(new Error("header not found")).mockResolvedValueOnce(0n);

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.error).toMatchObject({ reason: "post-state" });
    });

    it("lets the second read decide when the first read was short and the second fails", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValueOnce(0n).mockRejectedValueOnce(new Error("header not found"));

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.error).toMatchObject({ reason: "unverifiable" });
    });

    it("fails as reverted for a reverted approval without reading the allowance", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith({ ...approveReceipt, status: "reverted" }));

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("reverted");
      expect(failure.error).toMatchObject({ kind: "approve", reason: "reverted" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });

    it("fails verification for a receipt without the expected Approval", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(
        resolveWith(
          buildReceipt({
            logs: [approvalLog(approveRecord.tokenIn, approveRecord.address, OTHER_SPENDER, approveRecord.amountIn)],
          })
        )
      );

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).toMatchObject({ reason: "missing-event" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });

    it("fails verification for an Approval below the amount without reading the allowance", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(
        resolveWith(approveReceiptFor(approveRecord, { value: approveRecord.amountIn - 1n }))
      );

      const failure = failureOf(await watchReceipt(approveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).toMatchObject({ reason: "post-state" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });
  });

  describe("swap", () => {
    it("confirms a swap with the Swap event's amounts and no post-state read", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(swapReceipt));

      const outcome = await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({
        type: "confirmed",
        receipt: swapReceipt,
        swap: { amountIn: swapRecord.amountIn, amountOut: swapRecord.quotedOut, fee: swapRecord.quotedFee },
      });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
      expect(h.sleep).not.toHaveBeenCalled();
      expect(h.onProgress.mock.calls).toEqual([[{ attempt: 0, phase: "verifying" }]]);
    });

    it("confirms a swap whose amount out differs from the quote with the actual amounts", async () => {
      const h = harness();
      const receipt = swapReceiptFor(swapRecord, { amountOut: 249_800_000n, fee: 200_000n });
      h.waitForReceipt.mockImplementation(resolveWith(receipt));

      const outcome = await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({
        type: "confirmed",
        receipt,
        swap: { amountIn: swapRecord.amountIn, amountOut: 249_800_000n, fee: 200_000n },
      });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });

    it("fails a reverted swap as reverted and does nothing else", async () => {
      const h = harness();
      const reverted: TransactionReceipt = { ...swapReceipt, status: "reverted", logs: [] };
      h.waitForReceipt.mockImplementation(resolveWith(reverted));

      const outcome = await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "failed", reason: "reverted", error: expect.any(ReceiptVerificationError) });
      expect(Object.keys(outcome).sort()).toEqual(["error", "reason", "type"]);
      const failure = failureOf(outcome);
      expect(failure.error).toMatchObject({ kind: "swap", reason: "reverted" });
      expect(failure.error.message).toBe(
        "This swap transaction reverted. It did not move any funds. Check your balances before trying again."
      );
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
      expect(h.sleep).not.toHaveBeenCalled();
    });

    it("fails verification for a swap receipt without the Transfers", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(
        resolveWith(
          buildReceipt({
            logs: [
              swapLog(swapRecord.vault, {
                sender: swapRecord.address,
                recipient: swapRecord.address,
                tokenIn: swapRecord.tokenIn,
                tokenOut: swapRecord.tokenOut,
                amountIn: swapRecord.amountIn,
                amountOut: swapRecord.quotedOut,
                fee: swapRecord.quotedFee,
              }),
            ],
          })
        )
      );

      const failure = failureOf(await watchReceipt(swapRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).toMatchObject({ kind: "swap", reason: "missing-event" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });

    it("ends the watch when verification throws unexpectedly", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(
        resolveWith({ ...swapReceipt, logs: undefined as unknown as TransactionReceipt["logs"] })
      );

      const failure = failureOf(await watchReceipt(swapRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("verification");
      expect(failure.error).not.toBeInstanceOf(ReceiptVerificationError);
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
      expect(h.sleep).not.toHaveBeenCalled();
    });
  });

  describe("replacement", () => {
    it.each([
      ["approve", approveRecord, approveReceipt],
      ["swap", swapRecord, swapReceipt],
    ] as const)("confirms a repriced %s and reports the repricing", async (_kind, record, receipt) => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(receipt, "repriced"));
      h.readAllowanceAt.mockResolvedValue(record.amountIn);

      const outcome = await watchReceipt(record, h.deps, h.controller.signal);

      expect(outcome).toMatchObject({ type: "confirmed", receipt, replacementReason: "repriced" });
    });

    it.each([
      ["approve", approveRecord],
      ["swap", swapRecord],
    ] as const)("fails a cancelled %s as cancelled", async (kind, record) => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(cancelReceipt, "cancelled"));

      const failure = failureOf(await watchReceipt(record, h.deps, h.controller.signal));

      expect(failure.reason).toBe("cancelled");
      expect(failure.error).toBeInstanceOf(TransactionReplacedError);
      expect(failure.error).toMatchObject({ kind, reason: "cancelled" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });

    it.each([
      ["approve", approveRecord, approveReceipt],
      ["swap", swapRecord, swapReceipt],
    ] as const)("fails a replaced %s as replaced even when the receipt looks right", async (kind, record, receipt) => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(receipt, "replaced"));
      h.readAllowanceAt.mockResolvedValue(record.amountIn);

      const failure = failureOf(await watchReceipt(record, h.deps, h.controller.signal));

      expect(failure.reason).toBe("replaced");
      expect(failure.error).toMatchObject({ kind, reason: "replaced" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
    });
  });

  describe("wait parameters", () => {
    it("passes EOA wait parameters with replacement detection", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(swapReceipt));

      await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(h.waitForReceipt).toHaveBeenCalledWith({
        hash: swapRecord.hash,
        confirmations: 3,
        pollingInterval: 4_000,
        timeout: VAULT_WATCHER_TIMINGS.waitTimeoutMs,
        checkReplacement: true,
        onReplaced: expect.any(Function),
        signal: h.controller.signal,
      });
    });

    it("passes smart-account wait parameters and skips replacement detection", async () => {
      const h = harness({ getCallsStatus: statusFake(async () => ({ status: "success", statusCode: 200 })) });
      h.waitForReceipt.mockImplementation(resolveWith(smartSwapReceipt));

      const outcome = await watchReceipt(smartSwapRecord, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
      expect(h.waitForReceipt).toHaveBeenCalledWith({
        hash: smartSwapRecord.hash,
        confirmations: 3,
        pollingInterval: 10_000,
        timeout: VAULT_WATCHER_TIMINGS.smartAccountWaitTimeoutMs,
        checkReplacement: false,
        onReplaced: expect.any(Function),
        signal: h.controller.signal,
      });
    });

    it.each([
      [1, 1],
      [137, 3],
      [8453, 1],
    ] as const)("waits for the pinned confirmation count on chain %i", async (chainId, confirmations) => {
      const record = buildPendingApproveRecord({ chainId });
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceiptFor(record)));
      h.readAllowanceAt.mockResolvedValue(record.amountIn);

      const outcome = await watchReceipt(record, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
      expect(h.waitForReceipt).toHaveBeenCalledWith(expect.objectContaining({ confirmations }));
    });

    it("exports the portal's timeouts and backoff bounds", () => {
      expect(VAULT_WATCHER_TIMINGS).toEqual({
        pollingIntervalMs: 4_000,
        smartAccountPollingIntervalMs: 10_000,
        waitTimeoutMs: 90_000,
        smartAccountWaitTimeoutMs: 120_000,
        minBackoffMs: 1_000,
        maxBackoffMs: 15_000,
      });
      expect(VAULT_POST_STATE_RETRY_DELAY_MS).toBe(1_500);
    });
  });

  describe("waiting", () => {
    it("retries after a transient error and reports progress", async () => {
      const h = harness();
      const flaky = new HttpRequestError({ url: "https://rpc.test" });
      h.waitForReceipt.mockRejectedValueOnce(flaky).mockImplementationOnce(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValue(approveRecord.amountIn);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
      expect(h.waitForReceipt).toHaveBeenCalledTimes(2);
      expect(h.sleep.mock.calls).toEqual([[1_000, h.controller.signal]]);
      expect(h.onProgress.mock.calls).toEqual([
        [{ attempt: 1, phase: "waiting", lastError: flaky }],
        [{ attempt: 1, phase: "verifying" }],
      ]);
    });

    it("starts another wait after each timeout", async () => {
      const h = harness();
      h.waitForReceipt
        .mockRejectedValueOnce(timeout())
        .mockRejectedValueOnce(timeout())
        .mockImplementationOnce(resolveWith(swapReceipt));

      const outcome = await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
      expect(h.waitForReceipt).toHaveBeenCalledTimes(3);
      expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
      expect(h.onProgress.mock.calls.map(([p]) => [p.attempt, p.phase])).toEqual([
        [1, "waiting"],
        [2, "waiting"],
        [2, "verifying"],
      ]);
    });

    it("doubles the backoff up to its cap", async () => {
      const h = harness();
      for (let i = 0; i < 6; i++) h.waitForReceipt.mockRejectedValueOnce(timeout());
      h.waitForReceipt.mockImplementationOnce(resolveWith(swapReceipt));

      await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    });

    it("ends the watch on a terminal wait error", async () => {
      const h = harness();
      const rejection = new UserRejectedRequestError(new Error("rejected"));
      h.waitForReceipt.mockRejectedValue(rejection);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "failed", reason: "verification", error: rejection });
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
      expect(h.sleep).not.toHaveBeenCalled();
      expect(h.onProgress).not.toHaveBeenCalled();
    });

    it("gives every wait the signal, so an abandoned wait stops reaching the network", async () => {
      const h = harness({ getCallsStatus: statusFake(async () => ({ status: "pending", statusCode: 100 })) });
      h.waitForReceipt
        .mockRejectedValueOnce(timeout())
        .mockRejectedValueOnce(new HttpRequestError({ url: "https://rpc.test" }))
        .mockImplementationOnce(resolveWith(smartSwapReceipt));

      await watchReceipt(smartSwapRecord, h.deps, h.controller.signal);

      expect(h.waitForReceipt).toHaveBeenCalledTimes(3);
      for (const [params] of h.waitForReceipt.mock.calls) expect(params.signal).toBe(h.controller.signal);
    });

    it("gives every sleep the signal", async () => {
      const h = harness();
      h.waitForReceipt.mockRejectedValueOnce(timeout()).mockImplementationOnce(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValueOnce(0n).mockResolvedValueOnce(approveRecord.amountIn);

      await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(h.sleep.mock.calls).toEqual([
        [1_000, h.controller.signal],
        [VAULT_POST_STATE_RETRY_DELAY_MS, h.controller.signal],
      ]);
    });
  });

  describe("expiry", () => {
    it("returns expired once the TTL passes before any receipt", async () => {
      const h = harness();
      h.waitForReceipt.mockRejectedValue(timeout());
      h.sleep.mockImplementation(async () => {
        h.clock.now = approveRecord.expiresAt;
      });

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "expired" });
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("returns expired without waiting when the record is already expired", async () => {
      const h = harness({}, approveRecord.expiresAt + 1);

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "expired" });
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("verifies a receipt that arrives after the TTL passed during the wait", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(async () => {
        h.clock.now = swapRecord.expiresAt + 1;
        return swapReceipt;
      });

      const outcome = await watchReceipt(swapRecord, h.deps, h.controller.signal);

      expect(outcome).toMatchObject({ type: "confirmed", swap: { amountOut: swapRecord.quotedOut } });
    });

    it("keeps verifying an approval when the TTL passes during the post-state retry", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockRejectedValueOnce(new Error("header not found")).mockResolvedValueOnce(approveRecord.amountIn);
      h.sleep.mockImplementation(async () => {
        h.clock.now = approveRecord.expiresAt + 1;
      });

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: approveReceipt });
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("applies the record's own TTL, which is longer for a smart account", async () => {
      const clockStart = TEST_NOW + pendingTtlMs(false);

      const eoa = harness({}, clockStart);
      expect(await watchReceipt(approveRecord, eoa.deps, eoa.controller.signal)).toEqual({ type: "expired" });

      const smart = harness({}, clockStart);
      smart.waitForReceipt.mockImplementation(resolveWith(smartApproveReceipt));
      smart.readAllowanceAt.mockResolvedValue(smartApproveRecord.amountIn);
      const outcome = await watchReceipt(smartApproveRecord, smart.deps, smart.controller.signal);
      expect(outcome.type).toBe("confirmed");
    });
  });

  describe("smart accounts", () => {
    it("fails as cancelled when the account reports status 400", async () => {
      const h = harness({ getCallsStatus: statusFake(async () => ({ status: "failure", statusCode: 400 })) });

      const failure = failureOf(await watchReceipt(smartSwapRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("cancelled");
      expect(failure.error).toBeInstanceOf(TransactionReplacedError);
      expect(failure.error).toMatchObject({ kind: "swap", reason: "cancelled" });
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("fails as reverted when the account reports status 500", async () => {
      const h = harness({ getCallsStatus: statusFake(async () => ({ status: "failure", statusCode: 500 })) });

      const failure = failureOf(await watchReceipt(smartApproveRecord, h.deps, h.controller.signal));

      expect(failure.reason).toBe("reverted");
      expect(failure.error).toBeInstanceOf(ReceiptVerificationError);
      expect(failure.error).toMatchObject({ kind: "approve", reason: "reverted" });
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("asks for the status before every wait while it reports pending", async () => {
      const getCallsStatus = statusFake(async () => ({ status: "pending", statusCode: 100 }));
      const h = harness({ getCallsStatus });
      h.waitForReceipt.mockRejectedValueOnce(timeout()).mockImplementationOnce(resolveWith(smartSwapReceipt));

      const outcome = await watchReceipt(smartSwapRecord, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
      expect(getCallsStatus).toHaveBeenCalledTimes(2);
      expect(getCallsStatus).toHaveBeenCalledWith(smartSwapRecord.hash);
      expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000]);
    });

    it("ignores a failing status call and waits for the receipt", async () => {
      const getCallsStatus = statusFake(async () => {
        throw new Error("method not supported");
      });
      const h = harness({ getCallsStatus });
      h.waitForReceipt.mockImplementation(resolveWith(smartApproveReceipt));
      h.readAllowanceAt.mockResolvedValue(smartApproveRecord.amountIn);

      const outcome = await watchReceipt(smartApproveRecord, h.deps, h.controller.signal);

      expect(outcome).toEqual({ type: "confirmed", receipt: smartApproveReceipt });
      expect(getCallsStatus).toHaveBeenCalledTimes(1);
    });

    it("waits for the receipt when there is no status call", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(smartSwapReceipt));

      const outcome = await watchReceipt(smartSwapRecord, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
    });

    it("does not ask for the status of an EOA record", async () => {
      const getCallsStatus = statusFake(async () => ({ status: "failure", statusCode: 400 }));
      const h = harness({ getCallsStatus });
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValue(approveRecord.amountIn);

      const outcome = await watchReceipt(approveRecord, h.deps, h.controller.signal);

      expect(outcome.type).toBe("confirmed");
      expect(getCallsStatus).not.toHaveBeenCalled();
    });
  });

  describe("abort", () => {
    it("returns aborted immediately for an aborted signal", async () => {
      const getCallsStatus = statusFake(async () => ({ status: "pending", statusCode: 100 }));
      const h = harness({ getCallsStatus });
      h.controller.abort();

      expect(await watchReceipt(smartApproveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(getCallsStatus).not.toHaveBeenCalled();
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires during the status call", async () => {
      const h = harness();
      const getCallsStatus = statusFake(async () => {
        h.controller.abort();
        return { status: "pending", statusCode: 100 };
      });
      const deps: ReceiptWatcherDeps = { ...h.deps, getCallsStatus };

      expect(await watchReceipt(smartApproveRecord, deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires during a status call that throws", async () => {
      const h = harness();
      const getCallsStatus = statusFake(async () => {
        h.controller.abort();
        throw new Error("method not supported");
      });
      const deps: ReceiptWatcherDeps = { ...h.deps, getCallsStatus };

      expect(await watchReceipt(smartApproveRecord, deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.waitForReceipt).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires while waiting for the receipt", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(async () => {
        h.controller.abort();
        return approveReceipt;
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.readAllowanceAt).not.toHaveBeenCalled();
      expect(h.onProgress).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires during a wait that then fails", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(async () => {
        h.controller.abort();
        throw timeout();
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.sleep).not.toHaveBeenCalled();
      expect(h.onProgress).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires during the backoff sleep", async () => {
      const h = harness();
      h.waitForReceipt.mockRejectedValue(new Error("flaky"));
      h.sleep.mockImplementation(async () => {
        h.controller.abort();
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.waitForReceipt).toHaveBeenCalledTimes(1);
    });

    it("returns aborted when the signal fires during the first allowance read", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockImplementation(async () => {
        h.controller.abort();
        return approveRecord.amountIn;
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.sleep).not.toHaveBeenCalled();
    });

    it("returns aborted when the signal fires during the post-state retry sleep", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.sleep.mockImplementation(async () => {
        h.controller.abort();
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(1);
    });

    it("returns aborted when the signal fires during the second allowance read", async () => {
      const h = harness();
      h.waitForReceipt.mockImplementation(resolveWith(approveReceipt));
      h.readAllowanceAt.mockResolvedValueOnce(0n).mockImplementationOnce(async () => {
        h.controller.abort();
        throw new Error("header not found");
      });

      expect(await watchReceipt(approveRecord, h.deps, h.controller.signal)).toEqual({ type: "aborted" });
      expect(h.readAllowanceAt).toHaveBeenCalledTimes(2);
    });
  });
});

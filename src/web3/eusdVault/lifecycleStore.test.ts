/** @jest-environment node */
import { UserRejectedRequestError, type Address, type Hash, type TransactionReceipt } from "viem";
import { routeFor } from "./deployments";
import { AppError, VaultStateChangedError, describeError } from "./errors";
import { createVaultLifecycleStore } from "./lifecycleStore";
import { PENDING_TTL_MS, pendingStorageKey, serializePendingRecord } from "./pendingRecords";
import { DISAGREE_RETRY_DELAY_MS } from "./preflight";
import {
  HARNESS_HEADS,
  HARNESS_QUOTE,
  approveRequest,
  createLifecycleHarness,
  defaultVaultState,
  deferred,
  flush,
  receiptFor,
  recordSnapshots,
  swapRequest,
  vaultRevert,
  type LifecycleHarness,
  type LifecycleHarnessOptions,
} from "./testing/lifecycleHarness";
import {
  TEST_AMOUNT_IN,
  TEST_BLOCK_NUMBER,
  TEST_NOW,
  TEST_TX_HASH,
  TEST_WALLET,
  buildPendingSwapRecord,
  buildReceipt,
  swapReceiptFor,
} from "./testing/receipts";
import type { PendingContext, SwapDirection, VaultLifecycleStore, VaultPendingRecord } from "./types";

const OTHER_WALLET: Address = "0x6666666666666666666666666666666666666666";
const OTHER_HASH: Hash = `0x${"cd".repeat(32)}`;
const SPED_UP_HASH: Hash = `0x${"ef".repeat(32)}`;
const OTHER_CONTEXT: PendingContext = { chainId: 137, address: OTHER_WALLET, connectorId: "injected" };
const OTHER_WALLET_INPUT = { walletKey: "other-wallet", context: OTHER_CONTEXT };

const CANCELLED = "Wallet request cancelled. No transaction was sent.";
const CONTEXT_CHANGED = "Your wallet's account or network changed. Review the form and try again.";
const CONFLICT =
  "Your transaction was sent, but this page is already tracking a different transaction for this wallet. Check the explorer for the new transaction before sending another.";

function setup(o?: LifecycleHarnessOptions): { h: LifecycleHarness; store: VaultLifecycleStore } {
  const h = createLifecycleHarness(o);
  return { h, store: h.start() };
}

function swapReceipt(record: VaultPendingRecord, overrides: Parameters<typeof swapReceiptFor>[1] = {}): TransactionReceipt {
  if (record.kind !== "swap") throw new Error("expected a swap record");
  return swapReceiptFor(record, overrides);
}

/** Holds the receipt wait until the returned gate resolves, then answers with the record's own receipt. */
function holdReceipt(h: LifecycleHarness) {
  const gate = deferred<void>();
  h.waitForReceipt = (record) => gate.promise.then(() => receiptFor(record));
  return gate;
}

/** Holds the wallet's `aggregate3` until the returned gate resolves. */
function holdWalletRead(h: LifecycleHarness) {
  const gate = deferred<void>();
  h.before = (source, method) => (source === "wallet" && method === "aggregate3" ? gate.promise : undefined);
  return gate;
}

/** Counts listener calls from now on. */
function countNotifications(store: VaultLifecycleStore): () => number {
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  return () => calls;
}

function count(log: readonly string[], entry: string): number {
  return log.filter((e) => e === entry).length;
}

describe("createVaultLifecycleStore", () => {
  describe("snapshots", () => {
    it("serves an idle server snapshot that cannot submit, and starts that way until a wallet is set", () => {
      const h = createLifecycleHarness();
      const store = createVaultLifecycleStore(h.deps);

      expect(store.getServerSnapshot()).toEqual({ status: "idle", smartAccount: false, canSubmit: false });
      expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
      expect(store.getSnapshot()).toEqual(store.getServerSnapshot());

      store.setWallet(h.wallet);
      expect(store.getSnapshot()).toMatchObject({ status: "idle", smartAccount: false, canSubmit: true });
      expect(store.getSnapshot().pending).toBeUndefined();
    });

    it("cannot submit without a wallet context, and submit then does nothing", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      store.setWallet({ walletKey: h.wallet.walletKey });

      expect(store.getSnapshot().canSubmit).toBe(false);
      await store.submit(approveRequest());
      expect(h.log).toEqual([]);
      expect(store.getSnapshot().status).toBe("idle");

      store.setWallet(h.wallet);
      expect(store.getSnapshot().canSubmit).toBe(true);
    });

    it("keeps the snapshot's identity between changes and notifies listeners on each change", async () => {
      const { h, store } = setup();
      const gate = holdReceipt(h);
      const initial = store.getSnapshot();
      const calls = countNotifications(store);

      store.setWallet(h.wallet);
      store.setLive({ allowances: {} });
      store.acknowledge();
      store.done();
      store.dismissPending();
      expect(store.getSnapshot()).toBe(initial);
      expect(calls()).toBe(0);

      const recorder = recordSnapshots(store);
      await store.submit(approveRequest());
      expect(recorder.statuses()).toEqual(["preflight", "signing", "confirming"]);
      expect(calls()).toBe(3);
      expect(new Set([initial, ...recorder.states]).size).toBe(4);
      expect(store.getSnapshot()).toBe(recorder.states[2]);

      recorder.stop();
      gate.resolve();
      await flush();
      expect(recorder.states).toHaveLength(3);
      expect(calls()).toBe(5);
    });
  });

  describe("approve", () => {
    it("runs preflight, signing, confirming, verifying and confirmed, writing then clearing the record", async () => {
      const { h, store } = setup();
      const gate = holdReceipt(h);
      const recorder = recordSnapshots(store);

      await store.submit(approveRequest());
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", kind: "approve", hash: TEST_TX_HASH, canSubmit: false });
      expect(h.storedRecord()).toMatchObject({ kind: "approve", hash: TEST_TX_HASH, amountIn: TEST_AMOUNT_IN });

      gate.resolve();
      await flush();

      expect(recorder.statuses()).toEqual(["preflight", "signing", "confirming", "verifying", "confirmed"]);
      const state = store.getSnapshot();
      expect(state).toMatchObject({
        status: "confirmed",
        kind: "approve",
        direction: "usdcToEusd",
        hash: TEST_TX_HASH,
        amountIn: TEST_AMOUNT_IN,
        confirmedBlock: TEST_BLOCK_NUMBER,
        canSubmit: false,
      });
      expect(state.completed).toBeUndefined();
      expect(state.pending).toBeUndefined();
      expect(state.failure).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
      expect(h.storage.entries.size).toBe(0);
      expect(h.sent).toEqual([
        { fn: "sendApprove", token: h.deployment.gem, spender: h.deployment.vault, amount: TEST_AMOUNT_IN },
      ]);
      // Both preflight timers were released once their races were decided.
      expect(h.clock.hanging()).toBe(0);

      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true, confirmedBlock: TEST_BLOCK_NUMBER });
    });

    it("stays verifying while the allowance is read at the receipt block, with the attempt count from retries", async () => {
      const { h, store } = setup();
      let waits = 0;
      h.waitForReceipt = (record) => {
        waits += 1;
        return waits === 1 ? Promise.reject(new Error("fetch failed")) : Promise.resolve(receiptFor(record));
      };
      const allowance = deferred<bigint>();
      h.readAllowanceAt = () => allowance.promise;

      await store.submit(approveRequest());
      await flush();

      expect(store.getSnapshot().status).toBe("verifying");
      expect(store.getSnapshot().pending?.attempt).toBe(1);
      expect(h.warnings.some(([message]) => message === "Vault receipt wait retried")).toBe(true);

      allowance.resolve(TEST_AMOUNT_IN);
      await flush();
      expect(store.getSnapshot().status).toBe("confirmed");
    });
  });

  describe("swap", () => {
    it("confirms with a CompletedSwap from the Swap event and the mined transaction's hash", async () => {
      const { h, store } = setup();
      h.waitForReceipt = (record, params) => {
        // The wallet sped the transaction up; the mined transaction has another hash but the same call.
        params.onReplaced({ reason: "repriced" });
        return Promise.resolve(swapReceipt(record, { transactionHash: SPED_UP_HASH }));
      };

      await store.submit(swapRequest());
      await flush();

      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "confirmed", kind: "swap", hash: TEST_TX_HASH, confirmedBlock: TEST_BLOCK_NUMBER });
      expect(state.completed).toEqual({
        direction: "usdcToEusd",
        amountOut: HARNESS_QUOTE.amountOut,
        fee: HARNESS_QUOTE.fee,
        quotedOut: HARNESS_QUOTE.amountOut,
        transactionHash: SPED_UP_HASH,
        chainId: 137,
      });
      expect(h.storedRecord()).toBeUndefined();
    });

    it("confirms with the actual amount when the Swap event differs from the quote, keeping quotedOut", async () => {
      const { h, store } = setup();
      const actualOut = HARNESS_QUOTE.amountOut - 1_000n;
      const actualFee = HARNESS_QUOTE.fee + 1_000n;
      h.waitForReceipt = (record) => Promise.resolve(swapReceipt(record, { amountOut: actualOut, fee: actualFee }));

      await store.submit(swapRequest());
      await flush();

      expect(store.getSnapshot().status).toBe("confirmed");
      expect(store.getSnapshot().completed).toMatchObject({
        amountOut: actualOut,
        fee: actualFee,
        quotedOut: HARNESS_QUOTE.amountOut,
        transactionHash: TEST_TX_HASH,
      });
    });

    it("keeps completed through acknowledge, and done clears it", async () => {
      const { store } = setup();
      await store.submit(swapRequest());
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", canSubmit: false });

      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().completed?.transactionHash).toBe(TEST_TX_HASH);

      store.done();
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(store.getSnapshot().status).toBe("idle");
    });

    it("runs the preflight, then the simulation on both providers, then the wallet write", async () => {
      const { h, store } = setup();
      await store.submit(swapRequest());
      await flush();

      const first = (entry: string) => h.log.indexOf(entry);
      const last = (entry: string) => h.log.lastIndexOf(entry);
      expect(first("openSession")).toBe(0);
      expect(first("wallet.getCode")).toBeGreaterThan(first("openSession"));
      expect(first("rpc.getBlockNumber")).toBeGreaterThan(first("wallet.getCode"));
      const lastRead = Math.max(last("rpc.aggregate3"), last("wallet.aggregate3"));
      const firstSimulation = Math.min(first("rpc.simulateSwap"), first("wallet.simulateSwap"));
      const lastSimulation = Math.max(last("rpc.simulateSwap"), last("wallet.simulateSwap"));
      expect(firstSimulation).toBeGreaterThan(lastRead);
      expect(first("sendSwap")).toBeGreaterThan(lastSimulation);
      expect(first("waitForReceipt")).toBeGreaterThan(first("sendSwap"));
      expect(h.simulations.map((s) => s.params)).toEqual([
        { vault: h.deployment.vault, functionName: "sellGem", account: TEST_WALLET, recipient: TEST_WALLET, amountIn: TEST_AMOUNT_IN },
        { vault: h.deployment.vault, functionName: "sellGem", account: TEST_WALLET, recipient: TEST_WALLET, amountIn: TEST_AMOUNT_IN },
      ]);
    });
  });

  describe("guard", () => {
    it("locks synchronously, so a second submit while one is in flight does nothing", async () => {
      const { h, store } = setup();
      holdReceipt(h);

      const first = store.submit(swapRequest());
      expect(store.getSnapshot()).toMatchObject({
        status: "preflight",
        kind: "swap",
        direction: "usdcToEusd",
        amountIn: TEST_AMOUNT_IN,
        canSubmit: false,
      });
      const second = store.submit(approveRequest());
      await Promise.all([first, second]);
      await store.submit(swapRequest());

      expect(count(h.log, "openSession")).toBe(1);
      expect(h.sent).toHaveLength(1);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", kind: "swap", canSubmit: false });
    });
  });

  describe("preflight failures", () => {
    it("fails with state-changed and no wallet prompt when the simulation differs from the quote", async () => {
      const { h, store } = setup();
      h.simulate = (source) => Promise.resolve(source === "wallet" ? HARNESS_QUOTE.amountOut - 1n : HARNESS_QUOTE.amountOut);

      await store.submit(swapRequest());

      const { failure } = store.getSnapshot();
      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(failure?.reason).toBe("state-changed");
      expect((failure?.error as VaultStateChangedError).change).toBe("quote");
      expect(failure?.error.message).toContain("changed from 249.75 to 249.749999");
      expect(h.sent).toEqual([]);
      expect(h.storage.entries.size).toBe(0);
    });

    it("fails with the paused copy and no wallet prompt when the simulation hits EnforcedPause", async () => {
      const { h, store } = setup();
      h.simulate = () => Promise.reject(vaultRevert("EnforcedPause"));

      await store.submit(swapRequest());

      const { failure } = store.getSnapshot();
      expect(failure?.reason).toBe("state-changed");
      expect((failure?.error as VaultStateChangedError).change).toBe("paused");
      expect(describeError(failure?.error)).toEqual({
        tone: "warning",
        message: "Swaps are currently paused. Please check back later.",
      });
      expect(h.sent).toEqual([]);
    });

    it("retries once when the providers disagree, then submits", async () => {
      const { h, store } = setup();
      holdReceipt(h);
      h.state = (read) => ({
        ...defaultVaultState(h.deployment),
        balanceIn: read.source === "wallet" && read.index === 0 ? TEST_AMOUNT_IN - 1n : TEST_AMOUNT_IN,
      });

      await store.submit(approveRequest());

      expect(h.sent).toHaveLength(1);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", hash: TEST_TX_HASH });
      expect(h.reads).toHaveLength(4);
      expect(h.clock.sleeps).toContain(DISAGREE_RETRY_DELAY_MS);
    });

    it("fails with providers-disagree when the second attempt still disagrees", async () => {
      const { h, store } = setup();
      h.state = (read) => ({
        ...defaultVaultState(h.deployment),
        balanceIn: read.source === "wallet" ? TEST_AMOUNT_IN + 1n : TEST_AMOUNT_IN,
      });

      await store.submit(approveRequest());

      expect(h.sent).toEqual([]);
      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(store.getSnapshot().failure?.reason).toBe("providers-disagree");
    });

    it("fails with state-changed when both providers still report another balance at their latest block", async () => {
      const { h, store } = setup();
      h.state = () => ({ ...defaultVaultState(h.deployment), balanceIn: TEST_AMOUNT_IN - 1n });

      await store.submit(approveRequest());

      expect(h.sent).toEqual([]);
      expect(store.getSnapshot().failure?.reason).toBe("state-changed");
      expect((store.getSnapshot().failure?.error as VaultStateChangedError).change).toBe("balance");
      // First attempt pinned to the common head, the retry at each provider's latest.
      const pinned = HARNESS_HEADS.wallet;
      expect(h.reads.map((r) => r.blockNumber)).toEqual([pinned, pinned, undefined, undefined]);
    });

    it("retries at the latest block when the pinned read trails a settled balance", async () => {
      const { h, store } = setup();
      holdReceipt(h);
      h.state = (read) => ({
        ...defaultVaultState(h.deployment),
        balanceIn: read.index === 0 ? TEST_AMOUNT_IN - 1n : TEST_AMOUNT_IN,
      });

      await store.submit(approveRequest());

      expect(h.sent).toHaveLength(1);
      expect(store.getSnapshot().status).toBe("confirming");
      expect(h.reads).toHaveLength(4);
    });

    it("fails as preflight on a vault identity mismatch without sending anything", async () => {
      const { h, store } = setup();
      h.state = () => ({ ...defaultVaultState(h.deployment), stable: OTHER_WALLET });

      await store.submit(swapRequest());

      expect(store.getSnapshot().failure?.reason).toBe("preflight");
      expect(store.getSnapshot().failure?.error.message).toBe(
        "Security verification failed: vault contract identity mismatch"
      );
      expect(h.sent).toEqual([]);
    });

    it.each([
      ["another account", { address: OTHER_WALLET }],
      ["another chain", { chainId: 1 as const }],
      ["another connector", { connectorId: "walletConnect" }],
    ])("fails as preflight when the session is for %s than the context, sending nothing", async (_label, change) => {
      const { h, store } = setup();
      h.openSession = () => Promise.resolve({ ...h.session, ...change });

      await store.submit(swapRequest());

      const { failure } = store.getSnapshot();
      expect(failure?.reason).toBe("preflight");
      expect(describeError(failure?.error)).toEqual({ tone: "warning", message: CONTEXT_CHANGED });
      expect(h.log).toEqual(["openSession"]);
      expect(h.sent).toEqual([]);
    });

    it("reports a session that cannot open as a preflight failure", async () => {
      const { h, store } = setup();
      h.openSession = () => Promise.reject(new AppError("Connect a wallet before swapping."));

      await store.submit(approveRequest());

      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(store.getSnapshot().failure?.reason).toBe("preflight");
      expect(store.getSnapshot().failure?.error.message).toBe("Connect a wallet before swapping.");
      expect(h.sent).toEqual([]);
    });

    it("fails as preflight when the app has no RPC for the chain", async () => {
      const { h, store } = setup();
      h.appSource = () => undefined;

      await store.submit(approveRequest());

      expect(store.getSnapshot().failure?.reason).toBe("preflight");
      expect(store.getSnapshot().failure?.error.message).toContain("configured RPC");
      expect(h.sent).toEqual([]);
    });

    it("gives up when a preflight read never answers, instead of waiting forever", async () => {
      const { h, store } = setup();
      h.before = (source, method) => (source === "wallet" && method === "aggregate3" ? new Promise(() => {}) : undefined);

      const submitted = store.submit(approveRequest());
      await flush();
      expect(store.getSnapshot().status).toBe("preflight");

      h.clock.elapse();
      await submitted;

      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(store.getSnapshot().failure?.reason).toBe("preflight");
      expect(store.getSnapshot().failure?.error.message).toBe("Your wallet or the network did not answer in time. Try again.");
      expect(h.sent).toEqual([]);
      expect(h.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("signing failures", () => {
    it("reports a wallet rejection calmly, stores nothing and allows another attempt", async () => {
      const { h, store } = setup();
      h.send = () => Promise.reject(new UserRejectedRequestError(new Error("User denied")));

      await store.submit(approveRequest());

      const { failure } = store.getSnapshot();
      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(failure?.reason).toBe("rejected");
      expect(failure?.error.message).toBe(CANCELLED);
      expect(describeError(failure?.error)).toEqual({ tone: "info", message: CANCELLED });
      expect(h.storage.entries.size).toBe(0);
      expect(h.warnings).toEqual([]);

      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().failure).toBeUndefined();

      h.send = () => Promise.resolve(TEST_TX_HASH);
      holdReceipt(h);
      await store.submit(approveRequest());
      expect(store.getSnapshot().status).toBe("confirming");
    });

    it("reports any other wallet error as unknown and logs it", async () => {
      const { h, store } = setup();
      h.send = () => Promise.reject(new Error("nonce too low"));

      await store.submit(swapRequest());

      expect(store.getSnapshot().failure?.reason).toBe("unknown");
      expect(store.getSnapshot().failure?.error.message).toBe("nonce too low");
      expect(h.warnings).toHaveLength(1);
      expect(h.storage.entries.size).toBe(0);
    });
  });

  describe("the pending record", () => {
    it.each<[SwapDirection, "sellGem" | "buyGem"]>([
      ["usdcToEusd", "sellGem"],
      ["eusdToUsdc", "buyGem"],
    ])("stores a %s swap with the exact amount, the quote and the wallet as recipient", async (direction, fn) => {
      const { h, store } = setup();
      holdReceipt(h);
      const route = routeFor(h.deployment, direction);
      h.clock.advance(5_000);
      const submittedAt = h.clock.now();

      await store.submit(swapRequest({ direction }));

      expect(h.sent).toEqual([
        { fn: "sendSwap", vault: h.deployment.vault, functionName: fn, recipient: TEST_WALLET, amountIn: TEST_AMOUNT_IN },
      ]);
      expect(h.storedRecord()).toEqual({
        version: 1,
        kind: "swap",
        hash: TEST_TX_HASH,
        direction,
        amountIn: TEST_AMOUNT_IN,
        quotedOut: HARNESS_QUOTE.amountOut,
        quotedFee: HARNESS_QUOTE.fee,
        chainId: 137,
        address: TEST_WALLET,
        connectorId: "injected",
        smartAccount: false,
        submittedAt,
        expiresAt: submittedAt + PENDING_TTL_MS.eoa,
        vault: h.deployment.vault,
        tokenIn: route.tokenIn,
        tokenOut: route.tokenOut,
      });
      expect(store.getSnapshot().pending).toEqual({
        kind: "swap",
        direction,
        hash: TEST_TX_HASH,
        amountIn: TEST_AMOUNT_IN,
        expired: false,
        smartAccount: false,
        attempt: 0,
      });
    });

    it("stores an approve without quote fields", async () => {
      const { h, store } = setup();
      holdReceipt(h);

      await store.submit(approveRequest({ direction: "eusdToUsdc" }));

      const record = h.storedRecord();
      expect(record).toMatchObject({ kind: "approve", direction: "eusdToUsdc", tokenIn: h.deployment.stable });
      expect(record).not.toHaveProperty("quotedOut");
      expect(h.sent).toEqual([
        { fn: "sendApprove", token: h.deployment.stable, spender: h.deployment.vault, amount: TEST_AMOUNT_IN },
      ]);
    });

    it.each([
      ["contract code", "injected", "0x6080604052", true],
      ["an EIP-7702 delegation", "injected", `0xef0100${"ab".repeat(20)}`, false],
      ["empty code", "injected", "0x", false],
      ["no code", "injected", undefined, false],
      ["the safe connector", "safe", undefined, true],
    ] as const)("detects the account type from %s", async (_label, connectorId, code, smartAccount) => {
      const { h, store } = setup({ connectorId, code });
      holdReceipt(h);
      const send = deferred<Hash>();
      h.send = () => send.promise;

      const submitted = store.submit(swapRequest());
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "signing", smartAccount });

      send.resolve(TEST_TX_HASH);
      await submitted;
      const record = h.storedRecord();
      expect(record?.smartAccount).toBe(smartAccount);
      expect(record?.connectorId).toBe(connectorId);
      expect((record?.expiresAt ?? 0) - (record?.submittedAt ?? 0)).toBe(
        smartAccount ? PENDING_TTL_MS.smartAccount : PENDING_TTL_MS.eoa
      );
      expect(store.getSnapshot()).toMatchObject({ smartAccount, pending: { smartAccount } });
    });

    it("does not persist over another tab's live record and tracks that record instead", async () => {
      const { h, store } = setup();
      const other = buildPendingSwapRecord({ hash: OTHER_HASH });
      h.send = async () => {
        h.storage.set(pendingStorageKey(h.context), serializePendingRecord(other));
        return TEST_TX_HASH;
      };

      await store.submit(swapRequest());
      await flush();

      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "failed", hash: TEST_TX_HASH, canSubmit: false });
      expect(state.failure?.reason).toBe("unknown");
      expect(describeError(state.failure?.error)).toEqual({ tone: "warning", message: CONFLICT });
      expect(state.pending?.hash).toBe(OTHER_HASH);
      expect(h.storage.get(pendingStorageKey(h.context))).toBe(serializePendingRecord(other));
      expect(h.log).not.toContain("waitForReceipt");
    });
  });

  describe("watch outcomes", () => {
    it("fails a reverted swap and clears its record", async () => {
      const { h, store } = setup();
      h.waitForReceipt = (record) => Promise.resolve(swapReceipt(record, { status: "reverted" }));

      await store.submit(swapRequest());
      await flush();

      const { failure } = store.getSnapshot();
      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(failure?.reason).toBe("reverted");
      expect(failure?.error.message).toBe(
        "This swap transaction reverted. It did not move any funds. Check your balances before trying again."
      );
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it.each(["cancelled", "replaced"] as const)("fails as %s when the wallet replaced the transaction", async (reason) => {
      const { h, store } = setup();
      h.waitForReceipt = (_record, params) => {
        params.onReplaced({ reason });
        return Promise.resolve(buildReceipt({ logs: [], to: TEST_WALLET }));
      };

      await store.submit(approveRequest());
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true });
      expect(store.getSnapshot().failure?.reason).toBe(reason);
      expect(h.storedRecord()).toBeUndefined();
    });

    it("fails verification when the receipt lacks the vault's events, and logs it", async () => {
      const { h, store } = setup();
      h.waitForReceipt = () => Promise.resolve(buildReceipt({ logs: [] }));

      await store.submit(swapRequest());
      await flush();

      expect(store.getSnapshot().failure?.reason).toBe("verification");
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
      expect(h.errors).toHaveLength(1);
    });

    it("keeps an expired record, returns to idle with pending.expired, and dismissPending removes it", async () => {
      const { h, store } = setup();
      h.waitForReceipt = () => {
        h.clock.advance(PENDING_TTL_MS.eoa);
        return Promise.reject(new Error("fetch failed"));
      };

      await store.submit(swapRequest());
      await flush();

      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "idle", canSubmit: true, hash: TEST_TX_HASH });
      expect(state.pending).toMatchObject({ hash: TEST_TX_HASH, expired: true });
      expect(state.failure).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);

      store.dismissPending();
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(store.getSnapshot().hash).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it("does not dismiss a live record", async () => {
      const { h, store } = setup();
      holdReceipt(h);
      await store.submit(swapRequest());

      store.dismissPending();

      expect(store.getSnapshot().pending?.hash).toBe(TEST_TX_HASH);
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });
  });

  describe("abandoned attempts", () => {
    it("abandons a preflight silently when the wallet changes, and sends nothing", async () => {
      const { h, store } = setup();
      const gate = holdWalletRead(h);

      const submitted = store.submit(swapRequest());
      await flush();
      expect(store.getSnapshot().status).toBe("preflight");

      store.setWallet(OTHER_WALLET_INPUT);
      const afterChange = store.getSnapshot();
      expect(afterChange).toMatchObject({ status: "idle", canSubmit: true });
      expect(afterChange.failure).toBeUndefined();
      expect(afterChange.kind).toBeUndefined();
      const calls = countNotifications(store);

      gate.resolve();
      await submitted;
      await flush();

      expect(store.getSnapshot()).toBe(afterChange);
      expect(calls()).toBe(0);
      expect(h.sent).toEqual([]);
      expect(h.log).not.toContain("rpc.simulateSwap");
      expect(h.storage.entries.size).toBe(0);
      expect(h.warnings).toEqual([]);
    });

    it("persists a hash returned after the wallet changed under the original context, leaving the new wallet idle", async () => {
      const { h, store } = setup();
      const send = deferred<Hash>();
      h.send = () => send.promise;

      const submitted = store.submit(swapRequest());
      await flush();
      expect(store.getSnapshot().status).toBe("signing");

      store.setWallet(OTHER_WALLET_INPUT);
      const afterChange = store.getSnapshot();
      const calls = countNotifications(store);

      send.resolve(TEST_TX_HASH);
      await submitted;
      await flush();

      expect(h.storedRecord()).toMatchObject({
        hash: TEST_TX_HASH,
        kind: "swap",
        address: TEST_WALLET,
        chainId: 137,
        connectorId: "injected",
        submittedAt: TEST_NOW,
      });
      expect(h.storage.get(pendingStorageKey(OTHER_CONTEXT))).toBeNull();
      expect(store.getSnapshot()).toBe(afterChange);
      expect(afterChange).toMatchObject({ status: "idle", canSubmit: true });
      expect(afterChange.pending).toBeUndefined();
      expect(calls()).toBe(0);
      expect(h.log).not.toContain("waitForReceipt");
    });

    it("returns to idle silently when something in the attempt aborts", async () => {
      const { h, store } = setup();
      h.openSession = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));

      await store.submit(approveRequest());

      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.warnings).toEqual([]);
    });

    type Phase = "preflight" | "signing" | "confirming" | "verifying";

    it.each<Phase>(["preflight", "signing", "confirming", "verifying"])(
      "leaves no later state change after dispose during %s",
      async (phase) => {
        const { h, store } = setup();
        const release = deferred<void>();
        if (phase === "preflight") {
          h.before = (source, method) => (source === "wallet" && method === "aggregate3" ? release.promise : undefined);
        } else if (phase === "signing") {
          h.send = () => release.promise.then(() => TEST_TX_HASH);
        } else if (phase === "confirming") {
          h.waitForReceipt = (record) => release.promise.then(() => receiptFor(record));
        } else {
          h.readAllowanceAt = (record) => release.promise.then(() => record.amountIn);
        }

        const submitted = store.submit(phase === "verifying" ? approveRequest() : swapRequest());
        await flush();
        expect(store.getSnapshot().status).toBe(phase);

        store.dispose();
        const disposed = store.getSnapshot();
        const calls = countNotifications(store);

        release.resolve();
        await submitted;
        await flush();

        expect(store.getSnapshot()).toBe(disposed);
        expect(calls()).toBe(0);
        if (phase === "preflight") {
          expect(h.sent).toEqual([]);
          expect(h.storage.entries.size).toBe(0);
        } else {
          // The transaction exists, so its record stays for a later visit to resume.
          expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
        }
        if (phase === "signing") expect(h.log).not.toContain("waitForReceipt");
        expect(h.clock.hanging()).toBe(0);
      }
    );

    it("starts again from setWallet after dispose, as a StrictMode remount does", async () => {
      const { h, store } = setup();
      store.dispose();

      await store.submit(approveRequest());
      expect(h.log).toEqual([]);

      store.setWallet(h.wallet);
      holdReceipt(h);
      await store.submit(approveRequest());
      expect(store.getSnapshot().status).toBe("confirming");
    });
  });

  describe("submit never rejects", () => {
    it("when opening the session throws synchronously", async () => {
      const { h, store } = setup();
      h.openSession = () => {
        throw new Error("boom");
      };

      await expect(store.submit(approveRequest())).resolves.toBeUndefined();
      expect(store.getSnapshot().failure?.reason).toBe("preflight");
    });

    it("when storage throws after the wallet returned a hash, keeping the hash", async () => {
      const { h, store } = setup();
      Object.assign(h.storage, {
        set: () => {
          throw new Error("quota exceeded");
        },
      });

      await expect(store.submit(swapRequest())).resolves.toBeUndefined();
      expect(store.getSnapshot()).toMatchObject({ status: "failed", hash: TEST_TX_HASH });
      expect(store.getSnapshot().failure?.reason).toBe("unknown");
    });

    it("when the logger throws", async () => {
      const { h, store } = setup();
      Object.assign(h.deps.logger ?? {}, {
        warn: () => {
          throw new Error("logger down");
        },
      });
      h.send = () => Promise.reject(new Error("nonce too low"));

      await expect(store.submit(swapRequest())).resolves.toBeUndefined();
      expect(store.getSnapshot().failure?.reason).toBe("unknown");
    });
  });
});

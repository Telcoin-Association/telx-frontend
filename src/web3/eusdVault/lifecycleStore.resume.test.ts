/** @jest-environment node */
import type { Address, Hash } from "viem";
import { AppError, describeError } from "./errors";
import { createVaultLifecycleStore } from "./lifecycleStore";
import { PENDING_TTL_MS, pendingStorageKey, serializePendingRecord } from "./pendingRecords";
import { PREFLIGHT_TIMEOUT_MS } from "./preflight";
import { VAULT_WATCHER_TIMINGS } from "./receiptWatcher";
import {
  approveRequest,
  createLifecycleHarness,
  deferred,
  flush,
  receiptFor,
  recordSnapshots,
  swapRequest,
  type Deferred,
  type LifecycleHarness,
} from "./testing/lifecycleHarness";
import {
  TEST_AMOUNT_IN,
  TEST_BLOCK_NUMBER,
  TEST_NOW,
  TEST_TX_HASH,
  buildPendingApproveRecord,
  buildPendingSwapRecord,
  swapReceiptFor,
} from "./testing/receipts";
import type {
  LiveAllowance,
  PendingContext,
  VaultLifecycleStore,
  VaultLiveState,
  VaultPendingRecord,
  WalletInput,
  WalletSession,
} from "./types";

const CONNECTOR = Object.freeze({ id: "injected", name: "the wagmi connector" });
const OTHER_HASH: Hash = `0x${"cd".repeat(32)}`;
const OTHER_WALLET: Address = "0x6666666666666666666666666666666666666666";
const OTHER_CONTEXT: PendingContext = { chainId: 137, address: OTHER_WALLET, connectorId: "injected" };
const OTHER_WALLET_INPUT: WalletInput = { walletKey: "other-wallet", context: OTHER_CONTEXT };
const DISCONNECTED: WalletInput = { walletKey: "disconnected" };
const MINUTE_MS = 60_000;
const CONFLICT =
  "Your transaction was sent, but this page is already tracking a different transaction for this wallet. Check the explorer for the new transaction before sending another.";

function key(h: LifecycleHarness): string {
  return pendingStorageKey(h.context);
}

/** A record stored before this page loaded. */
function seed(h: LifecycleHarness, record: VaultPendingRecord): void {
  h.storage.set(key(h), serializePendingRecord(record));
}

/** Another tab writes (or, with null, removes) this wallet's record, and this tab receives the StorageEvent. */
function fromOtherTab(h: LifecycleHarness, record: VaultPendingRecord | null): void {
  h.storage.writeFromOtherTab(key(h), record && serializePendingRecord(record));
}

function walletWith(h: LifecycleHarness, connector: unknown = CONNECTOR): WalletInput {
  return { ...h.wallet, connector };
}

/** A fresh store (a page load) for the harness wallet, with a connector to resume through. */
function load(h: LifecycleHarness, connector: unknown = CONNECTOR): VaultLifecycleStore {
  const store = createVaultLifecycleStore(h.deps);
  store.setWallet(walletWith(h, connector));
  return store;
}

function holdReceipt(h: LifecycleHarness): Deferred<void> {
  const gate = deferred<void>();
  h.waitForReceipt = (record) => gate.promise.then(() => receiptFor(record));
  return gate;
}

function recordResumes(h: LifecycleHarness): Array<Readonly<{ record: VaultPendingRecord; connector: unknown }>> {
  const calls: Array<Readonly<{ record: VaultPendingRecord; connector: unknown }>> = [];
  h.resumeSession = (record, connector) => {
    calls.push({ record, connector });
    return Promise.resolve(h.session);
  };
  return calls;
}

/** Submits a swap that loses the write to `other`, which another tab stores while this one is signing. */
async function loseWriteTo(h: LifecycleHarness, store: VaultLifecycleStore, other: VaultPendingRecord): Promise<void> {
  h.send = async () => {
    seed(h, other);
    return TEST_TX_HASH;
  };
  await store.submit(swapRequest());
  await flush();
}

function count(log: readonly string[], entry: string): number {
  return log.filter((e) => e === entry).length;
}

function countNotifications(store: VaultLifecycleStore): () => number {
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  return () => calls;
}

function fresh(value: bigint, updatedAt = TEST_NOW + 1_000): LiveAllowance {
  return { value, updatedAt };
}

describe("createVaultLifecycleStore: resume", () => {
  describe("from storage on setWallet", () => {
    it("resumes a stored approve through the connector, watches that record and confirms it", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingApproveRecord({ direction: "eusdToUsdc" });
      seed(h, record);
      const resumes = recordResumes(h);
      const watched: VaultPendingRecord[] = [];
      h.waitForReceipt = (r) => {
        watched.push(r);
        return Promise.resolve(receiptFor(r));
      };
      const store = createVaultLifecycleStore(h.deps);
      const recorder = recordSnapshots(store);

      store.setWallet(walletWith(h));
      expect(store.getSnapshot()).toMatchObject({
        status: "confirming",
        kind: "approve",
        direction: "eusdToUsdc",
        hash: TEST_TX_HASH,
        amountIn: TEST_AMOUNT_IN,
        smartAccount: false,
        canSubmit: false,
        pending: {
          kind: "approve",
          direction: "eusdToUsdc",
          hash: TEST_TX_HASH,
          amountIn: TEST_AMOUNT_IN,
          chainId: 137,
          submittedAt: record.submittedAt,
          expiresAt: record.expiresAt,
          expired: false,
          smartAccount: false,
          attempt: 0,
        },
      });

      await flush();
      expect(resumes).toEqual([{ record, connector: CONNECTOR }]);
      expect(watched).toEqual([record]);
      expect(h.waits[0]).toMatchObject({ hash: TEST_TX_HASH, checkReplacement: true, pollingInterval: 4_000 });
      expect(recorder.statuses()).toEqual(["idle", "confirming", "verifying", "confirmed"]);
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", confirmedBlock: TEST_BLOCK_NUMBER });
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it("resumes a stored swap and reports the stored quote beside the Swap event's amounts", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingSwapRecord({ quotedOut: 249_000_000n, quotedFee: 1_000_000n });
      seed(h, record);
      h.waitForReceipt = () => Promise.resolve(swapReceiptFor(record, { amountOut: 248_500_000n, fee: 1_500_000n }));
      const store = load(h);
      expect(store.getSnapshot()).toMatchObject({
        status: "confirming",
        kind: "swap",
        pending: { kind: "swap", quotedOut: 249_000_000n, quotedFee: 1_000_000n },
      });

      await flush();
      expect(store.getSnapshot().status).toBe("confirmed");
      expect(store.getSnapshot().completed).toEqual({
        direction: "usdcToEusd",
        amountIn: TEST_AMOUNT_IN,
        amountOut: 248_500_000n,
        fee: 1_500_000n,
        quotedOut: 249_000_000n,
        hash: TEST_TX_HASH,
        transactionHash: TEST_TX_HASH,
        chainId: 137,
      });
    });

    it("refuses a new submission while a resumed record is watched", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      holdReceipt(h);
      const store = load(h);
      await flush();

      await store.submit(approveRequest());
      expect(h.log).not.toContain("openSession");
      expect(h.sent).toEqual([]);
      expect(store.getSnapshot().status).toBe("confirming");
    });

    it("resumes only once a wallet context is set", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      holdReceipt(h);
      const store = createVaultLifecycleStore(h.deps);

      store.setWallet({ walletKey: h.wallet.walletKey, connector: CONNECTOR });
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: false });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.log).toEqual([]);

      store.setWallet(walletWith(h));
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
    });

    it("adopts an expired record as idle with pending.expired, does not watch it, and dismisses it", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingSwapRecord({ expiresAt: TEST_NOW - 1 });
      seed(h, record);
      const store = load(h);
      await flush();

      expect(store.getSnapshot()).toMatchObject({
        status: "idle",
        kind: "swap",
        hash: TEST_TX_HASH,
        canSubmit: true,
        pending: { hash: TEST_TX_HASH, expired: true },
      });
      expect(h.log).toEqual([]);
      expect(h.clock.hanging()).toBe(0);

      store.dismissPending();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(store.getSnapshot().hash).toBeUndefined();
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it.each([
      ["unparseable text", () => "{not json"],
      ["another wallet's record", () => serializePendingRecord(buildPendingApproveRecord({ address: OTHER_WALLET }))],
      ["a record naming another vault", () => serializePendingRecord(buildPendingApproveRecord({ vault: OTHER_WALLET }))],
      ["a record from another connector", () => serializePendingRecord(buildPendingApproveRecord({ connectorId: "safe" }))],
    ])("ignores and removes %s stored under this wallet's key", async (_label, raw) => {
      const h = createLifecycleHarness();
      h.storage.set(key(h), raw());
      const store = load(h);
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.log).toEqual([]);
      expect(h.storage.get(key(h))).toBeNull();
    });
  });

  describe("when the wallet session does not reopen", () => {
    it("keeps the record and the lock without failing, and retries on the next setWallet", async () => {
      const h = createLifecycleHarness({
        hang: (ms) => ms >= PREFLIGHT_TIMEOUT_MS || ms === VAULT_WATCHER_TIMINGS.minBackoffMs,
      });
      const record = buildPendingApproveRecord();
      seed(h, record);
      const connectors: unknown[] = [];
      h.resumeSession = (_r, connector) => {
        connectors.push(connector);
        return Promise.reject(new AppError("The wallet that sent this transaction is not available on its network."));
      };
      const store = load(h, "a connector still reconnecting");
      await flush();

      expect(store.getSnapshot()).toMatchObject({
        status: "confirming",
        canSubmit: false,
        pending: { hash: TEST_TX_HASH, expired: false, attempt: 1 },
      });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.storedRecord()).toEqual(record);
      expect(h.log).not.toContain("waitForReceipt");
      expect(h.warnings).toHaveLength(1);
      expect(h.clock.hanging()).toBe(1);

      await store.submit(approveRequest());
      expect(h.sent).toEqual([]);

      h.resumeSession = (_r, connector) => {
        connectors.push(connector);
        return Promise.resolve(h.session);
      };
      store.setWallet(walletWith(h));
      await flush();

      expect(connectors).toEqual(["a connector still reconnecting", CONNECTOR]);
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", hash: TEST_TX_HASH });
      expect(h.storedRecord()).toBeUndefined();
      expect(h.clock.hanging()).toBe(0);
    });

    it("retries with backoff until the session opens", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      let calls = 0;
      h.resumeSession = () => {
        calls += 1;
        return calls <= 2 ? Promise.reject(new Error("Connector not connected")) : Promise.resolve(h.session);
      };
      const store = load(h);
      await flush();

      expect(calls).toBe(3);
      expect(h.clock.sleeps.slice(0, 2)).toEqual([1_000, 2_000]);
      expect(store.getSnapshot().status).toBe("confirmed");
    });

    it("treats a session on another account as not reopened", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      let calls = 0;
      h.resumeSession = () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? { ...h.session, address: OTHER_WALLET } : h.session);
      };
      const store = load(h);
      await flush();

      expect(calls).toBe(2);
      expect(count(h.log, "waitForReceipt")).toBe(1);
      expect(store.getSnapshot().status).toBe("confirmed");
    });

    it("gives up when the TTL passes: idle with pending.expired, the record kept and nothing failed", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingSwapRecord();
      seed(h, record);
      h.resumeSession = () => Promise.reject(new Error("Connector not connected"));
      const store = load(h);
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true, pending: { expired: true } });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.storedRecord()).toEqual(record);
      expect(h.log).not.toContain("waitForReceipt");
      expect(h.clock.hanging()).toBe(0);
    });
  });

  describe("across tabs", () => {
    it("adopts and watches a record another tab writes", async () => {
      const h = createLifecycleHarness();
      const resumes = recordResumes(h);
      const gate = holdReceipt(h);
      const store = load(h);
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });

      const record = buildPendingSwapRecord({ hash: OTHER_HASH });
      fromOtherTab(h, record);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", canSubmit: false, pending: { hash: OTHER_HASH } });
      await flush();
      expect(resumes).toEqual([{ record, connector: CONNECTOR }]);
      expect(h.waits.map((w) => w.hash)).toEqual([OTHER_HASH]);

      gate.resolve();
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", completed: { hash: OTHER_HASH } });
    });

    it("lets go of a record another tab cleared: watch aborted, idle, no failure and no completed", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      const gate = holdReceipt(h);
      const store = load(h);
      await flush();
      expect(store.getSnapshot().status).toBe("confirming");

      fromOtherTab(h, null);
      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "idle", canSubmit: true });
      expect(state.pending).toBeUndefined();
      expect(state.kind).toBeUndefined();
      expect(state.hash).toBeUndefined();
      expect(state.failure).toBeUndefined();
      expect(state.completed).toBeUndefined();
      expect(state.settledExternally).toBeUndefined();

      gate.resolve();
      await flush();
      expect(store.getSnapshot()).toBe(state);
      expect(h.log).not.toContain("readAllowanceAt");
    });

    it("lets two tabs watch one record without reporting it twice", async () => {
      const h = createLifecycleHarness();
      const receipts: Array<Deferred<void>> = [];
      h.waitForReceipt = (record) => {
        const gate = deferred<void>();
        receipts.push(gate);
        return gate.promise.then(() => receiptFor(record));
      };
      const tabA = h.start();
      const tabB = load(h);

      await tabA.submit(swapRequest());
      // The StorageEvent tab B receives for tab A's write.
      h.storage.writeFromOtherTab(key(h), h.storage.get(key(h)));
      await flush();
      expect(tabA.getSnapshot().status).toBe("confirming");
      expect(tabB.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(receipts).toHaveLength(2);

      receipts[0].resolve();
      await flush();
      expect(tabA.getSnapshot()).toMatchObject({ status: "confirmed", completed: { hash: TEST_TX_HASH } });
      expect(h.storedRecord()).toBeUndefined();

      // The StorageEvent for tab A's removal.
      h.storage.writeFromOtherTab(key(h), null);
      receipts[1].resolve();
      await flush();

      const b = tabB.getSnapshot();
      expect(b).toMatchObject({ status: "idle", canSubmit: true });
      expect(b.completed).toBeUndefined();
      expect(b.failure).toBeUndefined();
      expect(b.pending).toBeUndefined();
      expect(tabA.getSnapshot()).toMatchObject({ status: "confirmed", completed: { hash: TEST_TX_HASH } });
      expect(h.errors).toEqual([]);
    });

    it("picks up a record another tab wrote while this tab was checking, once its own attempt ends", async () => {
      const h = createLifecycleHarness();
      holdReceipt(h);
      const store = load(h);
      const open = deferred<WalletSession>();
      h.openSession = () => open.promise;

      const submitted = store.submit(approveRequest());
      fromOtherTab(h, buildPendingSwapRecord({ hash: OTHER_HASH }));
      expect(store.getSnapshot().status).toBe("preflight");
      expect(store.getSnapshot().pending).toBeUndefined();

      open.reject(new AppError("Connect your wallet to continue."));
      await submitted;
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "confirming", canSubmit: false, pending: { hash: OTHER_HASH } });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.sent).toEqual([]);
      expect(h.waits.map((w) => w.hash)).toEqual([OTHER_HASH]);
    });

    it("tracks the record it lost the write to without watching it, and keeps its conflict failure when that settles", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      await loseWriteTo(h, store, buildPendingSwapRecord({ hash: OTHER_HASH }));

      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: false, pending: { hash: OTHER_HASH } });
      expect(h.log).not.toContain("resumeSession");
      expect(h.clock.hanging()).toBe(1);

      fromOtherTab(h, null);
      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "failed", hash: TEST_TX_HASH, canSubmit: true });
      expect(state.pending).toBeUndefined();
      expect(describeError(state.failure?.error)).toEqual({ tone: "warning", message: CONFLICT });
      expect(h.clock.hanging()).toBe(0);
    });

    it("does not take the missing entry of a record storage never kept as settled elsewhere", async () => {
      const h = createLifecycleHarness();
      Object.assign(h.storage, { set: () => undefined });
      const gate = holdReceipt(h);
      const store = h.start();
      await store.submit(approveRequest());
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(h.storedRecord()).toBeUndefined();

      store.setWallet(h.wallet);
      h.storage.writeFromOtherTab(key(h), null);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });

      gate.resolve();
      await flush();
      expect(store.getSnapshot().status).toBe("confirmed");
    });

    it("changes nothing when a storage event carries the record already tracked", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingApproveRecord();
      seed(h, record);
      holdReceipt(h);
      const store = load(h);
      await flush();
      const before = store.getSnapshot();
      const calls = countNotifications(store);

      fromOtherTab(h, record);
      store.setWallet(walletWith(h));
      await flush();

      expect(store.getSnapshot()).toBe(before);
      expect(calls()).toBe(0);
      expect(count(h.log, "resumeSession")).toBe(1);
      expect(count(h.log, "waitForReceipt")).toBe(1);
    });
  });

  describe("live clearing", () => {
    it("clears an approve once its own token's fresh allowance covers it, and sets settledExternally", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord({ direction: "eusdToUsdc" }));
      const gate = holdReceipt(h);
      const store = load(h);
      await flush();

      store.setLive({ allowances: { eusdToUsdc: fresh(TEST_AMOUNT_IN) } });
      const state = store.getSnapshot();
      expect(state).toMatchObject({
        status: "idle",
        canSubmit: true,
        settledExternally: { kind: "approve", direction: "eusdToUsdc", hash: TEST_TX_HASH },
      });
      expect(state.pending).toBeUndefined();
      expect(state.failure).toBeUndefined();
      expect(state.completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();

      gate.resolve();
      await flush();
      expect(store.getSnapshot()).toBe(state);
      expect(h.log).not.toContain("readAllowanceAt");
    });

    it("clears an expired approve the same way", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord({ expiresAt: TEST_NOW - 1 }));
      const store = load(h);

      store.setLive({ allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN) } });
      expect(store.getSnapshot()).toMatchObject({ status: "idle", settledExternally: { hash: TEST_TX_HASH } });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it.each<[string, VaultLiveState]>([
      ["a read from before the submission", { allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN, TEST_NOW - 1_000) } }],
      ["a read at the submission instant", { allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN, TEST_NOW) } }],
      ["a read without a time", { allowances: { usdcToEusd: { value: TEST_AMOUNT_IN } } }],
      ["a time without a value", { allowances: { usdcToEusd: { updatedAt: TEST_NOW + 1_000 } } }],
      ["an allowance one unit short", { allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN - 1n) } }],
      ["the other direction's allowance", { allowances: { eusdToUsdc: fresh(TEST_AMOUNT_IN * 10n) } }],
      ["no allowance read", { allowances: {} }],
    ])("keeps a watched approve on %s", async (_label, live) => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      holdReceipt(h);
      const store = load(h);
      await flush();

      store.setLive(live);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(store.getSnapshot().settledExternally).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });

    const swapLiveForms: Array<[string, VaultLiveState]> = [
      ["its own token's fresh covering allowance", { allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN * 10n) } }],
      ["the other token's fresh covering allowance", { allowances: { eusdToUsdc: fresh(TEST_AMOUNT_IN * 10n) } }],
      [
        "both allowances fresh and covering",
        { allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN * 10n), eusdToUsdc: fresh(TEST_AMOUNT_IN * 10n) } },
      ],
    ];

    it.each(swapLiveForms)("never clears a watched swap on %s", async (_label, live) => {
      const h = createLifecycleHarness();
      seed(h, buildPendingSwapRecord());
      holdReceipt(h);
      const store = load(h);
      await flush();

      store.setLive(live);
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(store.getSnapshot().settledExternally).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });

    it.each(swapLiveForms)("never clears an expired swap on %s", (_label, live) => {
      const h = createLifecycleHarness();
      seed(h, buildPendingSwapRecord({ expiresAt: TEST_NOW - 1 }));
      const store = load(h);

      store.setLive(live);
      expect(store.getSnapshot()).toMatchObject({ status: "idle", pending: { expired: true } });
      expect(store.getSnapshot().settledExternally).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });

    it("never clears while the submit path is between signing and its stored record", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord({ hash: OTHER_HASH, expiresAt: TEST_NOW - 1 }));
      holdReceipt(h);
      const store = load(h);
      const send = deferred<Hash>();
      h.send = () => send.promise;

      const submitted = store.submit(approveRequest());
      await flush();
      expect(store.getSnapshot().status).toBe("signing");

      // Would settle the expired record the form was submitted over, if the slot were not about to be rewritten.
      store.setLive({ allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN * 2n) } });
      expect(store.getSnapshot().status).toBe("signing");
      expect(store.getSnapshot().settledExternally).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(OTHER_HASH);

      send.resolve(TEST_TX_HASH);
      await submitted;
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(store.getSnapshot().settledExternally).toBeUndefined();
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });

    it.each(["the next submit", "acknowledge", "a wallet change"] as const)(
      "drops settledExternally on %s",
      async (action) => {
        const h = createLifecycleHarness();
        seed(h, buildPendingApproveRecord());
        holdReceipt(h);
        const store = load(h);
        await flush();
        store.setLive({ allowances: { usdcToEusd: fresh(TEST_AMOUNT_IN) } });
        expect(store.getSnapshot().settledExternally).toBeDefined();

        if (action === "the next submit") await store.submit(swapRequest());
        else if (action === "acknowledge") store.acknowledge();
        else store.setWallet(OTHER_WALLET_INPUT);

        expect(store.getSnapshot().settledExternally).toBeUndefined();
        if (action === "acknowledge") expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      }
    );
  });

  describe("smart accounts", () => {
    it.each([
      [true, "confirming", false],
      [false, "idle", true],
    ] as const)("a record with smartAccount %s is %s 31 minutes after submission", async (smartAccount, status, expired) => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord({ smartAccount }));
      holdReceipt(h);
      h.clock.advance(31 * MINUTE_MS);
      const store = load(h);
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status, smartAccount, pending: { smartAccount, expired } });
      if (smartAccount) {
        expect(store.getSnapshot().pending?.expiresAt).toBe(TEST_NOW + PENDING_TTL_MS.smartAccount);
        expect(h.waits[0]).toMatchObject({ pollingInterval: 10_000, checkReplacement: false });
      } else {
        expect(h.waits).toEqual([]);
      }
    });

    it("dismisses a smart-account record at any time while it is watched", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord({ smartAccount: true }));
      const gate = holdReceipt(h);
      const store = load(h);
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { expired: false } });

      store.dismissPending();
      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "idle", canSubmit: true });
      expect(state.pending).toBeUndefined();
      expect(state.failure).toBeUndefined();
      expect(state.completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();

      gate.resolve();
      await flush();
      expect(store.getSnapshot()).toBe(state);
      expect(h.log).not.toContain("readAllowanceAt");
    });

    it("dismisses a live smart-account record while idle", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      await loseWriteTo(h, store, buildPendingSwapRecord({ hash: OTHER_HASH, smartAccount: true }));
      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: false, pending: { expired: false } });

      store.dismissPending();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
      expect(h.clock.hanging()).toBe(0);
    });

    it("does not dismiss the expired record a submission in flight is replacing", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingSwapRecord({ hash: OTHER_HASH, smartAccount: true, expiresAt: TEST_NOW - 1 }));
      const store = load(h);
      const open = deferred<WalletSession>();
      h.openSession = () => open.promise;

      const submitted = store.submit(approveRequest());
      store.dismissPending();
      expect(store.getSnapshot()).toMatchObject({ status: "preflight", pending: { hash: OTHER_HASH } });
      expect(h.storedRecord()?.hash).toBe(OTHER_HASH);

      open.reject(new AppError("Connect your wallet to continue."));
      await submitted;
    });

    it("does not dismiss a live EOA record, watched or not", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      holdReceipt(h);
      const watchedStore = load(h);
      await flush();
      watchedStore.dismissPending();
      expect(watchedStore.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);

      const other = createLifecycleHarness();
      const store = other.start();
      await loseWriteTo(other, store, buildPendingSwapRecord({ hash: OTHER_HASH }));
      store.acknowledge();
      store.dismissPending();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", pending: { hash: OTHER_HASH } });
      expect(other.storedRecord()?.hash).toBe(OTHER_HASH);
    });
  });

  describe("TTL", () => {
    it("flips pending.expired when the TTL passes while idle, without a reload", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      await loseWriteTo(h, store, buildPendingApproveRecord({ hash: OTHER_HASH }));
      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: false, pending: { expired: false } });

      // A timer that wakes early waits again.
      h.clock.elapse();
      await flush();
      expect(store.getSnapshot().pending?.expired).toBe(false);
      expect(h.clock.hanging()).toBe(1);

      h.clock.advance(PENDING_TTL_MS.eoa);
      h.clock.elapse();
      await flush();
      expect(store.getSnapshot()).toMatchObject({
        status: "idle",
        canSubmit: true,
        pending: { hash: OTHER_HASH, expired: true },
      });
      expect(h.storedRecord()?.hash).toBe(OTHER_HASH);
      expect(h.clock.hanging()).toBe(0);
      expect(h.log).not.toContain("resumeSession");

      store.dismissPending();
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it("keeps the conflict failure through expiry and dismissal", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      await loseWriteTo(h, store, buildPendingSwapRecord({ hash: OTHER_HASH }));

      h.clock.advance(PENDING_TTL_MS.eoa);
      h.clock.elapse();
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "failed", canSubmit: true, pending: { expired: true } });

      store.dismissPending();
      const state = store.getSnapshot();
      expect(state).toMatchObject({ status: "failed", hash: TEST_TX_HASH, canSubmit: true });
      expect(state.pending).toBeUndefined();
      expect(describeError(state.failure?.error).message).toBe(CONFLICT);
    });

    it("still surfaces the TTL of a record whose watch broke", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      h.resumeSession = () =>
        Promise.resolve({
          ...h.session,
          watcherDeps: () => {
            throw new Error("no client");
          },
        });
      const store = load(h);
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { expired: false } });
      expect(h.errors).toHaveLength(1);

      h.clock.advance(PENDING_TTL_MS.eoa);
      h.clock.elapse();
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true, pending: { expired: true } });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.clock.hanging()).toBe(0);
    });

    it("lets the watcher expire a resumed record that never produced a receipt", async () => {
      const h = createLifecycleHarness();
      const record = buildPendingSwapRecord();
      seed(h, record);
      h.waitForReceipt = () => {
        h.clock.advance(PENDING_TTL_MS.eoa);
        return Promise.reject(new Error("fetch failed"));
      };
      const store = load(h);
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true, pending: { expired: true } });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(h.storedRecord()).toEqual(record);
    });

    it("stops applying the TTL once a receipt was seen, even when a reconcile runs past it", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      const read = deferred<bigint>();
      h.readAllowanceAt = () => {
        h.clock.advance(PENDING_TTL_MS.eoa);
        return read.promise;
      };
      const store = load(h);
      await flush();
      expect(store.getSnapshot().status).toBe("verifying");

      store.setWallet(walletWith(h));
      expect(store.getSnapshot()).toMatchObject({ status: "verifying", pending: { expired: false } });

      read.resolve(TEST_AMOUNT_IN);
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", hash: TEST_TX_HASH });
      expect(h.storedRecord()).toBeUndefined();
    });
  });

  describe("wallet changes", () => {
    it("aborts the watch, keeps the record, clears completed, and resumes when the wallet returns", async () => {
      const h = createLifecycleHarness();
      const store = load(h);
      await store.submit(swapRequest());
      await flush();
      store.acknowledge();
      expect(store.getSnapshot()).toMatchObject({ status: "idle", completed: { hash: TEST_TX_HASH } });

      const gate = holdReceipt(h);
      fromOtherTab(h, buildPendingApproveRecord({ hash: OTHER_HASH }));
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", completed: { hash: TEST_TX_HASH } });

      store.setWallet(OTHER_WALLET_INPUT);
      const changed = store.getSnapshot();
      expect(changed).toMatchObject({ status: "idle", canSubmit: true });
      expect(changed.completed).toBeUndefined();
      expect(changed.pending).toBeUndefined();
      expect(changed.failure).toBeUndefined();

      gate.resolve();
      await flush();
      expect(store.getSnapshot()).toBe(changed);
      expect(h.log).not.toContain("readAllowanceAt");
      expect(h.storedRecord()?.hash).toBe(OTHER_HASH);

      store.setWallet(walletWith(h));
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", kind: "approve", hash: OTHER_HASH });
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(h.storedRecord()).toBeUndefined();
    });

    it("treats a disconnect as a change to no wallet, and resumes on reconnect", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      const gate = holdReceipt(h);
      const store = load(h);
      await flush();

      store.setWallet(DISCONNECTED);
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: false });
      expect(store.getSnapshot().pending).toBeUndefined();
      expect(h.storage.listenerCount(key(h))).toBe(0);
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);

      store.setWallet(walletWith(h));
      expect(store.getSnapshot()).toMatchObject({ status: "confirming", pending: { hash: TEST_TX_HASH } });
      gate.resolve();
      await flush();

      expect(store.getSnapshot().status).toBe("confirmed");
      expect(count(h.log, "resumeSession")).toBe(2);
      expect(count(h.log, "readAllowanceAt")).toBe(1);
    });

    it("clears a finished swap's completed", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      await store.submit(swapRequest());
      await flush();
      expect(store.getSnapshot().completed).toBeDefined();

      store.setWallet(OTHER_WALLET_INPUT);
      expect(store.getSnapshot().completed).toBeUndefined();
      expect(store.getSnapshot().status).toBe("idle");
    });

    it("clears a failure", async () => {
      const h = createLifecycleHarness();
      const store = h.start();
      h.send = () => Promise.reject(new Error("nonce too low"));
      await store.submit(swapRequest());
      expect(store.getSnapshot().status).toBe("failed");

      store.setWallet(OTHER_WALLET_INPUT);
      expect(store.getSnapshot()).toMatchObject({ status: "idle", canSubmit: true });
      expect(store.getSnapshot().failure).toBeUndefined();
      expect(store.getSnapshot().hash).toBeUndefined();
    });
  });

  describe("dispose", () => {
    it("resumes cleanly with one watch when setWallet runs again after dispose, as StrictMode does", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      const store = load(h);
      store.dispose();
      store.setWallet(walletWith(h));
      await flush();

      expect(store.getSnapshot()).toMatchObject({ status: "confirmed", hash: TEST_TX_HASH });
      expect(count(h.log, "resumeSession")).toBe(2);
      expect(h.waits).toHaveLength(1);
      expect(count(h.log, "readAllowanceAt")).toBe(1);
      expect(h.storage.listenerCount(key(h))).toBe(1);
    });

    it("starts no watch when the session reopens after dispose", async () => {
      const h = createLifecycleHarness();
      seed(h, buildPendingApproveRecord());
      const session = deferred<WalletSession>();
      h.resumeSession = () => session.promise;
      const store = load(h);
      store.dispose();
      const disposed = store.getSnapshot();

      session.resolve(h.session);
      await flush();
      expect(h.waits).toEqual([]);
      expect(store.getSnapshot()).toBe(disposed);
      expect(h.storedRecord()?.hash).toBe(TEST_TX_HASH);
    });

    type Held = "watching" | "waiting to reopen the session" | "timing a record without a watch" | "idle";

    it.each<Held>(["watching", "waiting to reopen the session", "timing a record without a watch", "idle"])(
      "leaves no listener, timer or retry behind when disposed while %s",
      async (held) => {
        const h = createLifecycleHarness({
          hang: (ms) => ms >= PREFLIGHT_TIMEOUT_MS || ms === VAULT_WATCHER_TIMINGS.minBackoffMs,
        });
        let store: VaultLifecycleStore;
        if (held === "timing a record without a watch") {
          store = h.start();
          await loseWriteTo(h, store, buildPendingSwapRecord({ hash: OTHER_HASH }));
        } else {
          if (held !== "idle") seed(h, buildPendingApproveRecord());
          if (held === "watching") holdReceipt(h);
          if (held === "waiting to reopen the session") h.resumeSession = () => Promise.reject(new Error("not ready"));
          store = load(h);
          await flush();
        }
        expect(h.storage.listenerCount(key(h))).toBe(1);
        expect(h.clock.hanging()).toBe(held === "idle" || held === "watching" ? 0 : 1);

        store.dispose();
        expect(h.storage.listenerCount(key(h))).toBe(0);
        expect(h.clock.hanging()).toBe(0);

        const disposed = store.getSnapshot();
        const resumes = count(h.log, "resumeSession");
        fromOtherTab(h, buildPendingSwapRecord({ hash: `0x${"ab".repeat(32)}` }));
        await flush();
        expect(store.getSnapshot()).toBe(disposed);
        expect(count(h.log, "resumeSession")).toBe(resumes);
      }
    );
  });
});

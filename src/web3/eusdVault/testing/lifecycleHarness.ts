/**
 * Fake dependencies for the lifecycle store's tests. Everything is a plain fake (no module mocks, no timers, no Jest
 * globals), so any test file can use it:
 *
 *   const h = createLifecycleHarness();
 *   const store = h.start();              // createVaultLifecycleStore(h.deps), then setWallet(h.wallet)
 *   await store.submit(swapRequest());
 *   await flush();                        // lets the receipt watch settle
 *
 * The chain sources answer `aggregate3` with real ABI-encoded results, so the real `runVaultPreflight` and
 * `decodeSnapshot` run. Every behaviour (session, sends, receipts, reads, simulation) is a writable field on the
 * harness; replace it before or during a test. Every request is appended to `h.log` ("openSession",
 * "wallet.getCode", "rpc.aggregate3", "wallet.simulateSwap", "sendSwap", "waitForReceipt", ...), so a test can
 * assert call order. Sleeps resolve at once and move the manual clock forward, except the preflight timeout's,
 * which hangs until `h.clock.elapse()` or its signal aborts.
 */
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  isAddressEqual,
  type Address,
  type ContractErrorName,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, multicall3Abi, vaultAbi } from "../abis";
import { VAULT_DEPLOYMENTS } from "../deployments";
import { createVaultLifecycleStore } from "../lifecycleStore";
import { readPendingRecord } from "../pendingRecords";
import { PREFLIGHT_TIMEOUT_MS } from "../preflight";
import type {
  ApproveRequest,
  ChainSource,
  Multicall3Call,
  Multicall3Result,
  PendingContext,
  PendingStorage,
  SimulateSwapParams,
  SmartAccountCallsStatus,
  SwapQuote,
  SwapRequest,
  VaultChainId,
  VaultDeployment,
  VaultLifecycleDeps,
  VaultLifecycleState,
  VaultLifecycleStatus,
  VaultLifecycleStore,
  VaultPendingRecord,
  WaitForReceiptParams,
  WalletInput,
  WalletSession,
} from "../types";
import { TEST_AMOUNT_IN, TEST_NOW, TEST_TX_HASH, TEST_WALLET, approveReceiptFor, swapReceiptFor } from "./receipts";

/** The quote every default request and fake source uses: 250 in, 249.75 out, 0.25 fee. */
export const HARNESS_QUOTE: SwapQuote = Object.freeze({ amountOut: 249_750_000n, fee: 250_000n });

/** Both reserves of the default vault state. */
export const HARNESS_RESERVE = 1_000_000_000_000n;

/** The heads the fake sources report; the preflight pins to the lower one. */
export const HARNESS_HEADS: Readonly<{ rpc: bigint; wallet: bigint }> = Object.freeze({ rpc: 1_000n, wallet: 998n });

export type Deferred<T> = Readonly<{ promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }>;

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise chain run. The fakes settle through microtasks only, so a few macrotask turns suffice. */
export async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

export function approveRequest(o: Partial<Omit<ApproveRequest, "kind">> = {}): ApproveRequest {
  return { kind: "approve", direction: "usdcToEusd", amountIn: TEST_AMOUNT_IN, ...o };
}

export function swapRequest(o: Partial<Omit<SwapRequest, "kind">> = {}): SwapRequest {
  return { kind: "swap", direction: "usdcToEusd", amountIn: TEST_AMOUNT_IN, quote: HARNESS_QUOTE, ...o };
}

/** A revert as viem reports an `eth_call` that hit one of the vault's custom errors. */
export function vaultRevert(errorName: ContractErrorName<typeof vaultAbi>): Error {
  return Object.assign(new Error("execution reverted"), { code: 3, data: encodeErrorResult({ abi: vaultAbi, errorName }) });
}

// storage

export type MemoryStorage = PendingStorage &
  Readonly<{
    entries: Map<string, string>;
    /** Another tab's write: stores `value` (removes on null) and notifies this key's subscribers, as a StorageEvent. */
    writeFromOtherTab(key: string, value: string | null): void;
    listenerCount(key: string): number;
  }>;

/** `set` and `remove` do not notify: a tab never receives StorageEvents for its own writes. */
export function createMemoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    entries,
    get: (k) => entries.get(k) ?? null,
    set: (k, v) => {
      entries.set(k, v);
    },
    remove: (k) => {
      entries.delete(k);
    },
    subscribe(k, l) {
      const set = listeners.get(k) ?? new Set<() => void>();
      set.add(l);
      listeners.set(k, set);
      return () => {
        set.delete(l);
      };
    },
    writeFromOtherTab(key, value) {
      if (value === null) entries.delete(key);
      else entries.set(key, value);
      [...(listeners.get(key) ?? [])].forEach((l) => l());
    },
    listenerCount: (key) => listeners.get(key)?.size ?? 0,
  };
}

// clock

export type ManualClock = Readonly<{
  now(): number;
  advance(ms: number): void;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Every sleep's duration, in call order. */
  sleeps: number[];
  /** Resolves every hanging sleep as if its time had passed. */
  elapse(): void;
  /** Number of sleeps still hanging. */
  hanging(): number;
}>;

/** Sleeps resolve at once and advance the clock, except those for which `hang(ms)` holds. */
export function createManualClock(
  o: Readonly<{ start?: number; hang?: (ms: number) => boolean }> = {}
): ManualClock {
  let time = o.start ?? TEST_NOW;
  const hang = o.hang ?? ((ms: number) => ms === PREFLIGHT_TIMEOUT_MS);
  const sleeps: number[] = [];
  const waiting = new Set<() => void>();
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
    sleeps,
    sleep(ms, signal) {
      sleeps.push(ms);
      if (signal?.aborted) return Promise.resolve();
      if (!hang(ms)) {
        time += ms;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const done = () => {
          waiting.delete(done);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        waiting.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    },
    elapse() {
      [...waiting].forEach((done) => done());
    },
    hanging: () => waiting.size,
  };
}

// chain sources

export type FakeVaultState = Readonly<{
  chainId: number;
  stable: Address;
  gem: Address;
  vaultPaused: boolean;
  stablePaused: boolean;
  stableReserve: bigint;
  gemReserve: bigint;
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  /** Undefined makes the preview sub-call fail. */
  quote?: SwapQuote;
  balanceIn: bigint;
  allowanceIn: bigint;
}>;

export type SourceName = "rpc" | "wallet";

/** One `aggregate3` as a fake source saw it. `index` counts that source's reads from 0. */
export type FakeRead = Readonly<{ source: SourceName; index: number; blockNumber?: bigint }>;

export function defaultVaultState(d: VaultDeployment): FakeVaultState {
  return {
    chainId: d.chainId,
    stable: d.stable,
    gem: d.gem,
    vaultPaused: false,
    stablePaused: false,
    stableReserve: HARNESS_RESERVE,
    gemReserve: HARNESS_RESERVE,
    maxPerTransaction: 0n,
    maxPerBlock: 0n,
    quote: HARNESS_QUOTE,
    balanceIn: TEST_AMOUNT_IN,
    allowanceIn: TEST_AMOUNT_IN,
  };
}

function answer(d: VaultDeployment, call: Multicall3Call, s: FakeVaultState, blockNumber: bigint): Multicall3Result {
  const ok = (returnData: Hex): Multicall3Result => ({ success: true, returnData });
  if (isAddressEqual(call.target, d.multicall3)) {
    const { functionName } = decodeFunctionData({ abi: multicall3Abi, data: call.callData });
    if (functionName === "getChainId") return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: BigInt(s.chainId) }));
    if (functionName === "getBlockNumber") return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: blockNumber }));
  } else if (isAddressEqual(call.target, d.vault)) {
    const { functionName } = decodeFunctionData({ abi: vaultAbi, data: call.callData });
    switch (functionName) {
      case "STABLE":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.stable }));
      case "GEM":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.gem }));
      case "paused":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.vaultPaused }));
      case "getReserves":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: [s.stableReserve, s.gemReserve] }));
      case "maxPerTransaction":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.maxPerTransaction }));
      case "maxPerBlock":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.maxPerBlock }));
      case "previewSellGem":
      case "previewBuyGem":
        if (s.quote === undefined) return { success: false, returnData: "0x" };
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: [s.quote.amountOut, s.quote.fee] }));
    }
  } else {
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data: call.callData });
    switch (functionName) {
      case "paused":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.stablePaused }));
      case "balanceOf":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.balanceIn }));
      case "allowance":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.allowanceIn }));
    }
  }
  throw new Error(`unexpected sub-call to ${call.target}`);
}

// session

export type SentTransaction =
  | Readonly<{ fn: "sendApprove"; token: Address; spender: Address; amount: bigint }>
  | Readonly<{ fn: "sendSwap"; vault: Address; functionName: "sellGem" | "buyGem"; recipient: Address; amountIn: bigint }>;

export type LifecycleHarnessOptions = Readonly<{
  chainId?: VaultChainId;
  address?: Address;
  connectorId?: string;
  /** What `session.source.getCode(address)` returns. Undefined (no code) is an EOA. */
  code?: Hex;
}>;

export type LifecycleHarness = {
  readonly deployment: VaultDeployment;
  readonly context: PendingContext;
  /** What `start()` passes to `setWallet`. */
  readonly wallet: WalletInput;
  readonly deps: VaultLifecycleDeps;
  readonly storage: MemoryStorage;
  readonly clock: ManualClock;
  readonly rpc: ChainSource;
  readonly session: WalletSession;
  /** Every request in order; see the file comment. */
  readonly log: string[];
  readonly reads: FakeRead[];
  readonly simulations: Array<Readonly<{ source: SourceName; params: SimulateSwapParams }>>;
  readonly sent: SentTransaction[];
  readonly waits: WaitForReceiptParams[];
  readonly warnings: unknown[][];
  readonly errors: unknown[][];

  /** Writable behaviour. */
  heads: { rpc: bigint; wallet: bigint };
  /** The vault state a read sees; defaults to `defaultVaultState` for every read. */
  state: (read: FakeRead) => FakeVaultState;
  simulate: (source: SourceName, p: SimulateSwapParams) => Promise<bigint>;
  code: Hex | undefined;
  /** Runs when a source request is sent, before it answers; may return a promise the request waits for. */
  before: (source: SourceName, method: string) => Promise<void> | void;
  openSession: () => Promise<WalletSession>;
  resumeSession: (r: VaultPendingRecord, connector: unknown) => Promise<WalletSession>;
  appSource: (chainId: VaultChainId) => ChainSource | undefined;
  /** Answers both `sendApprove` and `sendSwap`. Defaults to `TEST_TX_HASH`. */
  send: (tx: SentTransaction) => Promise<Hash>;
  /** Defaults to the record's own verified receipt, at once. */
  waitForReceipt: (record: VaultPendingRecord, params: WaitForReceiptParams) => Promise<TransactionReceipt>;
  /** Defaults to the record's `amountIn`. */
  readAllowanceAt: (record: VaultPendingRecord, blockNumber: bigint) => Promise<bigint>;
  getCallsStatus: ((hash: Hash) => Promise<SmartAccountCallsStatus>) | undefined;

  /** `createVaultLifecycleStore(deps)` followed by `setWallet(wallet)`. */
  start(): VaultLifecycleStore;
  /** The record stored for `context`, parsed. */
  storedRecord(): VaultPendingRecord | undefined;
};

/** The receipt a record's transaction produces when everything goes as submitted. */
export function receiptFor(record: VaultPendingRecord): TransactionReceipt {
  return record.kind === "approve" ? approveReceiptFor(record) : swapReceiptFor(record);
}

export function createLifecycleHarness(o: LifecycleHarnessOptions = {}): LifecycleHarness {
  const deployment = VAULT_DEPLOYMENTS[o.chainId ?? 137];
  const context: PendingContext = {
    chainId: deployment.chainId,
    address: o.address ?? TEST_WALLET,
    connectorId: o.connectorId ?? "injected",
  };
  const storage = createMemoryStorage();
  const clock = createManualClock();
  const log: string[] = [];
  const reads: FakeRead[] = [];
  const simulations: Array<Readonly<{ source: SourceName; params: SimulateSwapParams }>> = [];
  const sent: SentTransaction[] = [];
  const waits: WaitForReceiptParams[] = [];
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];

  function source(name: SourceName): ChainSource {
    let index = 0;
    const request = async (method: string) => {
      log.push(`${name}.${method}`);
      await h.before(name, method);
    };
    return {
      async getBlockNumber() {
        await request("getBlockNumber");
        return h.heads[name];
      },
      async aggregate3(multicall3, calls, blockNumber) {
        if (!isAddressEqual(multicall3, deployment.multicall3)) throw new Error(`unexpected multicall3 ${multicall3}`);
        const read: FakeRead = { source: name, index, blockNumber };
        index += 1;
        reads.push(read);
        await request("aggregate3");
        const state = h.state(read);
        return calls.map((call) => answer(deployment, call, state, blockNumber ?? h.heads[name]));
      },
      async simulateSwap(params) {
        simulations.push({ source: name, params });
        await request("simulateSwap");
        return h.simulate(name, params);
      },
      async getCode() {
        await request("getCode");
        return h.code;
      },
    };
  }

  const rpc = source("rpc");
  const walletSource = source("wallet");

  const session: WalletSession = {
    address: context.address,
    chainId: deployment.chainId,
    connectorId: context.connectorId,
    source: walletSource,
    sendApprove(token, spender, amount) {
      log.push("sendApprove");
      const tx: SentTransaction = { fn: "sendApprove", token, spender, amount };
      sent.push(tx);
      return h.send(tx);
    },
    sendSwap(vault, functionName, recipient, amountIn) {
      log.push("sendSwap");
      const tx: SentTransaction = { fn: "sendSwap", vault, functionName, recipient, amountIn };
      sent.push(tx);
      return h.send(tx);
    },
    watcherDeps(record) {
      const getCallsStatus = h.getCallsStatus;
      return {
        waitForReceipt(params) {
          log.push("waitForReceipt");
          waits.push(params);
          return h.waitForReceipt(record, params);
        },
        readAllowanceAt(blockNumber) {
          log.push("readAllowanceAt");
          return h.readAllowanceAt(record, blockNumber);
        },
        getCallsStatus,
      };
    },
  };

  const wallet: WalletInput = { walletKey: `${context.address}:${context.chainId}:${context.connectorId}`, context };

  const deps: VaultLifecycleDeps = {
    storage,
    now: () => clock.now(),
    sleep: (ms, signal) => clock.sleep(ms, signal),
    openSession: () => {
      log.push("openSession");
      return h.openSession();
    },
    resumeSession: (r, connector) => {
      log.push("resumeSession");
      return h.resumeSession(r, connector);
    },
    appSource: (chainId) => h.appSource(chainId),
    logger: {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    },
  };

  const h: LifecycleHarness = {
    deployment,
    context,
    wallet,
    deps,
    storage,
    clock,
    rpc,
    session,
    log,
    reads,
    simulations,
    sent,
    waits,
    warnings,
    errors,
    heads: { ...HARNESS_HEADS },
    state: () => defaultVaultState(deployment),
    simulate: () => Promise.resolve(HARNESS_QUOTE.amountOut),
    code: o.code,
    before: () => undefined,
    openSession: () => Promise.resolve(session),
    resumeSession: () => Promise.resolve(session),
    appSource: (chainId) => (chainId === deployment.chainId ? rpc : undefined),
    send: () => Promise.resolve(TEST_TX_HASH),
    waitForReceipt: (record) => Promise.resolve(receiptFor(record)),
    readAllowanceAt: (record) => Promise.resolve(record.amountIn),
    getCallsStatus: undefined,
    start() {
      const store = createVaultLifecycleStore(deps);
      store.setWallet(wallet);
      return store;
    },
    storedRecord: () => readPendingRecord(storage, context),
  };
  return h;
}

export type SnapshotRecorder = Readonly<{
  /** Every published snapshot, in order. */
  states: VaultLifecycleState[];
  statuses(): VaultLifecycleStatus[];
  stop(): void;
}>;

/** Subscribes to `store` and keeps each snapshot it publishes. */
export function recordSnapshots(store: VaultLifecycleStore): SnapshotRecorder {
  const states: VaultLifecycleState[] = [];
  const stop = store.subscribe(() => {
    states.push(store.getSnapshot());
  });
  return { states, statuses: () => states.map((s) => s.status), stop };
}

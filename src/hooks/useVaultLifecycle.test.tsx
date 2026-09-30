import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { getAddress, type Address, type Hash } from "viem";
import { useAccount } from "wagmi";
import { routeFor } from "@/web3/eusdVault/deployments";
import { createVaultLifecycleStore } from "@/web3/eusdVault/lifecycleStore";
import { writePendingRecord } from "@/web3/eusdVault/pendingRecords";
import {
  HARNESS_QUOTE,
  createLifecycleHarness,
  deferred,
  receiptFor,
  type LifecycleHarness,
} from "@/web3/eusdVault/testing/lifecycleHarness";
import { TEST_AMOUNT_IN, TEST_TX_HASH, TEST_WALLET, buildPendingApproveRecord } from "@/web3/eusdVault/testing/receipts";
import type {
  LiveAllowance,
  SwapRequest,
  VaultLifecycleDeps,
  VaultLifecycleStore,
  VaultLiveState,
} from "@/web3/eusdVault/types";
import { useVaultLifecycle } from "./useVaultLifecycle";

jest.mock("wagmi", () => ({ useAccount: jest.fn() }));

// The real store, created through a mock so each test can see what the hook calls on it.
jest.mock("../web3/eusdVault/lifecycleStore", () => ({
  ...jest.requireActual<object>("../web3/eusdVault/lifecycleStore"),
  createVaultLifecycleStore: jest.fn(),
}));

const { createVaultLifecycleStore: createRealStore } = jest.requireActual<
  Readonly<{ createVaultLifecycleStore: typeof createVaultLifecycleStore }>
>("../web3/eusdVault/lifecycleStore");

type Connector = Readonly<{ id: string; uid: string }>;
type Account = Readonly<{
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  address?: Address;
  chainId?: number;
  connector?: Connector;
}>;
type Props = Readonly<{ live: VaultLiveState; deps: VaultLifecycleDeps | undefined }>;

const INJECTED: Connector = { id: "injected", uid: "uid-1" };
const OTHER_WALLET = getAddress(`0x${"ab".repeat(20)}`);
const KEY = `${TEST_WALLET.toLowerCase()}:137:uid-1`;
const EMPTY_LIVE: VaultLiveState = { allowances: {} };

function spyOnStore(store: VaultLifecycleStore) {
  return {
    ...store,
    setWallet: jest.fn(store.setWallet),
    setLive: jest.fn(store.setLive),
    submit: jest.fn(store.submit),
    acknowledge: jest.fn(store.acknowledge),
    dismissPending: jest.fn(store.dismissPending),
    done: jest.fn(store.done),
    dispose: jest.fn(store.dispose),
  };
}

type SpiedStore = ReturnType<typeof spyOnStore>;

let h: LifecycleHarness;
let account: Account;
let stores: SpiedStore[];

function connected(o: Partial<Account> = {}): Account {
  return { status: "connected", address: TEST_WALLET, chainId: 137, connector: INJECTED, ...o };
}

function live(usdc?: LiveAllowance, eusd?: LiveAllowance): VaultLiveState {
  return { allowances: { ...(usdc ? { usdcToEusd: usdc } : {}), ...(eusd ? { eusdToUsdc: eusd } : {}) } };
}

function props(o: Partial<Props> = {}): Props {
  return { live: o.live ?? EMPTY_LIVE, deps: "deps" in o ? o.deps : h.deps };
}

function renderLifecycle(initial: Partial<Props> = {}, o: Readonly<{ strict?: boolean }> = {}) {
  // A fresh `o` every render, as the page passes it.
  return renderHook((p: Props) => useVaultLifecycle({ live: p.live }, p.deps), {
    initialProps: props(initial),
    wrapper: o.strict ? StrictMode : undefined,
  });
}

function swapInput(o: Partial<Omit<SwapRequest, "kind">> = {}): Omit<SwapRequest, "kind"> {
  return { direction: "usdcToEusd", amountIn: TEST_AMOUNT_IN, quote: HARNESS_QUOTE, ...o };
}

async function flushTasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Lets the store's promise chains run and React render what they publish. */
async function settle(): Promise<void> {
  await act(flushTasks);
}

/** Holds every receipt until `release` resolves, then answers with the record's verified receipt. */
function holdReceipts() {
  const release = deferred<void>();
  h.waitForReceipt = (record) => release.promise.then(() => receiptFor(record));
  return release;
}

beforeEach(() => {
  jest.clearAllMocks();
  h = createLifecycleHarness();
  stores = [];
  account = connected();
  jest.mocked(useAccount).mockImplementation(() => account as unknown as ReturnType<typeof useAccount>);
  jest.mocked(createVaultLifecycleStore).mockImplementation((deps) => {
    const store = spyOnStore(createRealStore(deps));
    stores.push(store);
    return store;
  });
});

describe("useVaultLifecycle", () => {
  it("is inert without dependencies and creates no store", async () => {
    const { result } = renderLifecycle({ deps: undefined });

    expect(result.current.state).toEqual({ status: "idle", smartAccount: false, canSubmit: false });
    await act(async () => {
      await expect(result.current.approve({ direction: "usdcToEusd", amountIn: TEST_AMOUNT_IN })).resolves.toBeUndefined();
      await expect(result.current.swap(swapInput())).resolves.toBeUndefined();
      result.current.acknowledge();
      result.current.dismissPending();
      result.current.done();
    });

    expect(createVaultLifecycleStore).not.toHaveBeenCalled();
    expect(h.log).toEqual([]);
    expect(result.current.state).toEqual({ status: "idle", smartAccount: false, canSubmit: false });
  });

  it("creates the store once dependencies arrive", () => {
    const { result, rerender } = renderLifecycle({ deps: undefined });

    rerender(props());

    expect(createVaultLifecycleStore).toHaveBeenCalledTimes(1);
    expect(createVaultLifecycleStore).toHaveBeenCalledWith(h.deps);
    expect(stores[0].setWallet).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: "idle", canSubmit: true });
  });

  it("keeps one store per dependencies object and disposes the old one when they change", () => {
    const { result, rerender } = renderLifecycle();
    rerender(props());
    expect(stores).toHaveLength(1);

    const next = createLifecycleHarness();
    rerender(props({ deps: next.deps }));

    expect(stores).toHaveLength(2);
    expect(createVaultLifecycleStore).toHaveBeenLastCalledWith(next.deps);
    expect(stores[0].dispose).toHaveBeenCalledTimes(1);
    expect(stores[1].dispose).not.toHaveBeenCalled();
    expect(stores[1].setWallet.mock.calls[0][0].walletKey).toBe(KEY);
    expect(stores[1].setLive).toHaveBeenCalledTimes(1);
    expect(result.current.state.canSubmit).toBe(true);

    rerender(props({ deps: undefined }));

    expect(stores[1].dispose).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: "idle", smartAccount: false, canSubmit: false });
  });

  it("gives a connected wallet a context and lets it submit", () => {
    const { result } = renderLifecycle();

    expect(stores[0].setWallet).toHaveBeenCalledTimes(1);
    expect(stores[0].setWallet).toHaveBeenCalledWith({
      walletKey: KEY,
      context: { chainId: 137, address: TEST_WALLET, connectorId: "injected" },
      connector: INJECTED,
    });
    expect(result.current.state).toMatchObject({ status: "idle", canSubmit: true });
  });

  it.each<[string, Account, string]>([
    ["reconnecting", connected({ status: "reconnecting" }), KEY],
    ["connecting", { status: "connecting" }, "disconnected:no-chain:no-connector"],
    ["disconnected", { status: "disconnected" }, "disconnected:no-chain:no-connector"],
    ["connected without a connector", connected({ connector: undefined }), `${TEST_WALLET.toLowerCase()}:137:no-connector`],
  ])("passes no context while %s", async (_name, a, walletKey) => {
    writePendingRecord(h.storage, buildPendingApproveRecord(), undefined, h.clock.now());
    account = a;
    const { result } = renderLifecycle();
    await settle();

    const [input] = stores[0].setWallet.mock.calls[0];
    expect(input.walletKey).toBe(walletKey);
    expect(input.context).toBeUndefined();
    expect(result.current.state).toMatchObject({ status: "idle", canSubmit: false });
    expect(result.current.state.pending).toBeUndefined();
    expect(h.log).not.toContain("resumeSession");

    await act(() => result.current.swap(swapInput()));
    expect(h.log).toEqual([]);
  });

  it("lets a reconnecting wallet submit once it is connected", () => {
    account = connected({ status: "reconnecting" });
    const { result, rerender } = renderLifecycle();
    expect(result.current.state.canSubmit).toBe(false);

    account = connected();
    rerender(props());

    expect(stores[0].setWallet).toHaveBeenCalledTimes(2);
    expect(stores[0].setWallet.mock.calls[1][0]).toMatchObject({ walletKey: KEY, context: h.context });
    expect(result.current.state.canSubmit).toBe(true);
  });

  it("sends an approval through the store with its direction and amount", async () => {
    const { result } = renderLifecycle();

    await act(() => result.current.approve({ direction: "eusdToUsdc", amountIn: 7_000_000n }));
    await settle();

    expect(stores[0].submit).toHaveBeenCalledWith({ kind: "approve", direction: "eusdToUsdc", amountIn: 7_000_000n });
    const route = routeFor(h.deployment, "eusdToUsdc");
    expect(h.log).toContain("sendApprove");
    expect(h.sent).toEqual([{ fn: "sendApprove", token: route.tokenIn, spender: h.deployment.vault, amount: 7_000_000n }]);
    expect(result.current.state).toMatchObject({ status: "confirmed", kind: "approve", direction: "eusdToUsdc" });
  });

  it("sends a swap through the store with its direction, amount and quote", async () => {
    holdReceipts();
    const { result } = renderLifecycle();

    await act(() => result.current.swap(swapInput({ direction: "eusdToUsdc" })));
    await settle();

    expect(stores[0].submit).toHaveBeenCalledWith({
      kind: "swap",
      direction: "eusdToUsdc",
      amountIn: TEST_AMOUNT_IN,
      quote: HARNESS_QUOTE,
    });
    const route = routeFor(h.deployment, "eusdToUsdc");
    expect(h.log).toContain("sendSwap");
    expect(h.sent).toEqual([
      {
        fn: "sendSwap",
        vault: h.deployment.vault,
        functionName: route.swapFunction,
        recipient: TEST_WALLET,
        amountIn: TEST_AMOUNT_IN,
      },
    ]);
    expect(h.storedRecord()).toMatchObject({
      kind: "swap",
      direction: "eusdToUsdc",
      amountIn: TEST_AMOUNT_IN,
      quotedOut: HARNESS_QUOTE.amountOut,
      quotedFee: HARNESS_QUOTE.fee,
    });
    expect(result.current.state).toMatchObject({ status: "confirming", kind: "swap", direction: "eusdToUsdc" });
    expect(result.current.state.pending).toMatchObject({ quotedOut: HARNESS_QUOTE.amountOut, quotedFee: HARNESS_QUOTE.fee });
  });

  it("re-renders through each status of a swap", async () => {
    const identity = deferred<void>();
    h.before = (source, method) => (source === "wallet" && method === "getCode" ? identity.promise : undefined);
    const signature = deferred<Hash>();
    h.send = () => signature.promise;
    const receipt = holdReceipts();
    const { result } = renderLifecycle();
    expect(result.current.state.status).toBe("idle");

    let submitted: Promise<void> = Promise.resolve();
    act(() => {
      submitted = result.current.swap(swapInput());
    });
    await settle();
    expect(result.current.state).toMatchObject({ status: "preflight", kind: "swap", canSubmit: false });

    identity.resolve();
    await settle();
    expect(result.current.state.status).toBe("signing");

    signature.resolve(TEST_TX_HASH);
    await settle();
    expect(result.current.state).toMatchObject({ status: "confirming", hash: TEST_TX_HASH });
    await act(() => submitted);

    receipt.resolve();
    await settle();
    expect(result.current.state.status).toBe("confirmed");
    expect(result.current.state.completed).toMatchObject({ hash: TEST_TX_HASH, direction: "usdcToEusd" });
  });

  it.each<[string, Partial<Account>, string]>([
    ["address", { address: OTHER_WALLET }, `${OTHER_WALLET.toLowerCase()}:137:uid-1`],
    ["chain", { chainId: 8453 }, `${TEST_WALLET.toLowerCase()}:8453:uid-1`],
    ["connector", { connector: { id: "injected", uid: "uid-2" } }, `${TEST_WALLET.toLowerCase()}:137:uid-2`],
  ])("calls setWallet with a new key when the %s changes", (_name, change, walletKey) => {
    const { rerender } = renderLifecycle();

    account = connected(change);
    rerender(props());

    const { setWallet } = stores[0];
    expect(setWallet).toHaveBeenCalledTimes(2);
    expect(setWallet.mock.calls[1][0].walletKey).toBe(walletKey);
    expect(setWallet.mock.calls[1][0].walletKey).not.toBe(setWallet.mock.calls[0][0].walletKey);
    expect(setWallet.mock.calls[1][0].context).toEqual({
      chainId: account.chainId,
      address: account.address,
      connectorId: "injected",
    });
  });

  it("resets on a wallet change and ignores the old transaction's late receipt", async () => {
    const receipt = holdReceipts();
    const { result, rerender } = renderLifecycle();
    await act(() => result.current.swap(swapInput()));
    await settle();
    expect(result.current.state.status).toBe("confirming");

    account = connected({ address: OTHER_WALLET });
    rerender(props());

    expect(result.current.state).toMatchObject({ status: "idle", canSubmit: true });
    expect(result.current.state.pending).toBeUndefined();
    expect(h.storedRecord()).toBeDefined();

    receipt.resolve();
    await settle();

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.completed).toBeUndefined();
    expect(h.storedRecord()).toBeDefined();
  });

  it("calls setLive when an allowance value or timestamp changes, not on an unrelated re-render", () => {
    const { rerender } = renderLifecycle({ live: live({ value: 1n, updatedAt: 10 }) });
    const { setLive, setWallet } = stores[0];
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setLive).toHaveBeenLastCalledWith(live({ value: 1n, updatedAt: 10 }));

    rerender(props({ live: live({ value: 1n, updatedAt: 10 }) }));
    account = { ...account };
    rerender(props({ live: live({ value: 1n, updatedAt: 10 }) }));
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setWallet).toHaveBeenCalledTimes(1);

    rerender(props({ live: live({ value: 2n, updatedAt: 10 }) }));
    expect(setLive).toHaveBeenCalledTimes(2);
    expect(setLive).toHaveBeenLastCalledWith(live({ value: 2n, updatedAt: 10 }));

    rerender(props({ live: live({ value: 2n, updatedAt: 11 }) }));
    expect(setLive).toHaveBeenCalledTimes(3);

    rerender(props({ live: live({ value: 2n, updatedAt: 11 }, { value: 5n, updatedAt: 12 }) }));
    expect(setLive).toHaveBeenCalledTimes(4);
    expect(setLive).toHaveBeenLastCalledWith(live({ value: 2n, updatedAt: 11 }, { value: 5n, updatedAt: 12 }));

    rerender(props({ live: live({ value: 2n, updatedAt: 11 }, { value: 5n, updatedAt: 13 }) }));
    expect(setLive).toHaveBeenCalledTimes(5);

    rerender(props({ live: live({ value: 2n, updatedAt: 11 }, { value: 5n, updatedAt: 13 }) }));
    expect(setLive).toHaveBeenCalledTimes(5);
  });

  it("disposes the store on unmount, after which a late receipt changes nothing", async () => {
    const receipt = holdReceipts();
    const { result, unmount } = renderLifecycle();
    await act(() => result.current.swap(swapInput()));
    await settle();
    expect(result.current.state.status).toBe("confirming");
    const [store] = stores;
    const before = store.getSnapshot();

    unmount();
    expect(store.dispose).toHaveBeenCalledTimes(1);

    receipt.resolve();
    await flushTasks();
    expect(store.getSnapshot()).toBe(before);
    expect(h.storedRecord()).toBeDefined();

    await result.current.swap(swapInput());
    expect(h.sent).toHaveLength(1);
  });

  it("ends StrictMode's double mount with a working store", async () => {
    const { result } = renderLifecycle({}, { strict: true });

    const armed = stores.filter((s) => s.setWallet.mock.calls.length > 0);
    expect(armed).toHaveLength(1);
    const [store] = armed;
    expect(store.dispose).toHaveBeenCalledTimes(1);
    expect(store.setWallet).toHaveBeenCalledTimes(2);
    expect(store.dispose.mock.invocationCallOrder[0]).toBeLessThan(store.setWallet.mock.invocationCallOrder[1]);
    expect(result.current.state.canSubmit).toBe(true);

    await act(() => result.current.swap(swapInput()));
    await settle();

    expect(h.log.filter((entry) => entry === "sendSwap")).toHaveLength(1);
    expect(h.log.filter((entry) => entry === "waitForReceipt")).toHaveLength(1);
    expect(result.current.state.status).toBe("confirmed");
  });

  it("passes acknowledge, dismissPending and done through to the store", async () => {
    const { result } = renderLifecycle();
    await act(() => result.current.swap(swapInput()));
    await settle();
    expect(result.current.state.status).toBe("confirmed");
    expect(result.current.state.completed).toBeDefined();

    act(() => result.current.acknowledge());
    expect(stores[0].acknowledge).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.completed).toBeDefined();

    act(() => result.current.dismissPending());
    expect(stores[0].dismissPending).toHaveBeenCalledTimes(1);

    act(() => result.current.done());
    expect(stores[0].done).toHaveBeenCalledTimes(1);
    expect(result.current.state.completed).toBeUndefined();
  });

  it("keeps the action identities across re-renders", async () => {
    const { result, rerender } = renderLifecycle();
    const first = result.current;

    rerender(props({ live: live({ value: 3n, updatedAt: 1 }) }));
    await act(() => result.current.swap(swapInput()));
    await settle();

    expect(result.current.state).not.toBe(first.state);
    expect(result.current.approve).toBe(first.approve);
    expect(result.current.swap).toBe(first.swap);
    expect(result.current.acknowledge).toBe(first.acknowledge);
    expect(result.current.dismissPending).toBe(first.dismissPending);
    expect(result.current.done).toBe(first.done);
  });
});

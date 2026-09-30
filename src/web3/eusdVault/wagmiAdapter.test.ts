/** @jest-environment node */
import {
  createClient,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  isAddressEqual,
  numberToHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { polygon } from "viem/chains";
import type { Config, Connector } from "wagmi";
import {
  connect,
  getAccount,
  getConnectorClient,
  getPublicClient,
  reconnect,
  switchChain,
  writeContract,
} from "wagmi/actions";
import { erc20Abi, vaultAbi } from "./abis";
import { VAULT_DEPLOYMENTS } from "./deployments";
import { AppError } from "./errors";
import { TEST_TX_HASH, TEST_WALLET, buildPendingApproveRecord, buildPendingSwapRecord } from "./testing/receipts";
import { createWagmiVaultDeps } from "./wagmiAdapter";

jest.mock("wagmi/actions", () => ({
  getAccount: jest.fn(),
  getConnectorClient: jest.fn(),
  getPublicClient: jest.fn(),
  writeContract: jest.fn(),
  switchChain: jest.fn(),
  connect: jest.fn(),
  reconnect: jest.fn(),
}));

type RpcRequest = Readonly<{ method: string; params: readonly unknown[] }>;

/** An EIP-1193 provider that records every request and answers from `handler`. */
function fakeProvider(handler: (r: RpcRequest) => unknown) {
  const requests: RpcRequest[] = [];
  return {
    requests,
    request: async ({ method, params }: Readonly<{ method: string; params?: unknown }>) => {
      const r = { method, params: Array.isArray(params) ? params : [] };
      requests.push(r);
      return handler(r);
    },
  };
}

function unexpected(r: RpcRequest): never {
  throw new Error(`unexpected RPC ${r.method}`);
}

type WalletClient = Awaited<ReturnType<typeof getConnectorClient>>;
type PublicClient = ReturnType<typeof getPublicClient>;
type AccountState = ReturnType<typeof getAccount>;

function walletClient(provider: ReturnType<typeof fakeProvider>, address: Address = TEST_WALLET): WalletClient {
  return createClient({ account: address, chain: polygon, transport: custom(provider, { retryCount: 0 }) });
}

function fakeConnector(id = "injected"): Connector {
  return {
    id,
    name: id,
    type: id,
    uid: `uid-${id}`,
    getProvider: jest.fn(),
    getAccounts: jest.fn(),
    getChainId: jest.fn(),
  } as unknown as Connector;
}

function accountState(state: Readonly<{ status: AccountState["status"]; chainId?: number; connector?: Connector }>) {
  return {
    status: state.status,
    address: state.status === "disconnected" ? undefined : TEST_WALLET,
    addresses: state.status === "disconnected" ? undefined : [TEST_WALLET],
    chainId: state.chainId,
    connector: state.connector,
  } as unknown as AccountState;
}

const config = { chains: [] } as unknown as Config;
const polygonVault = VAULT_DEPLOYMENTS[137];

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createWagmiVaultDeps", () => {
  it("wires storage, the clock and the logger", () => {
    const deps = createWagmiVaultDeps(config);
    expect(deps.storage.get("missing")).toBeNull();
    const before = Date.now();
    expect(deps.now()).toBeGreaterThanOrEqual(before);
    expect(deps.logger).toBe(console);
  });
});

describe("openSession", () => {
  it.each([
    ["disconnected", accountState({ status: "disconnected" })],
    ["connecting", accountState({ status: "connecting", chainId: 137, connector: fakeConnector() })],
    ["reconnecting", accountState({ status: "reconnecting", chainId: 137, connector: fakeConnector() })],
    ["connected without a connector", accountState({ status: "connected", chainId: 137 })],
  ])("asks for a wallet when %s", async (_, state) => {
    jest.mocked(getAccount).mockReturnValue(state);
    const deps = createWagmiVaultDeps(config);
    const error = await deps.openSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe("Connect your wallet to continue.");
    expect(getConnectorClient).not.toHaveBeenCalled();
  });

  it.each([10, 42161, undefined])("asks for a supported network on chain %s", async (chainId) => {
    jest.mocked(getAccount).mockReturnValue(accountState({ status: "connected", chainId, connector: fakeConnector() }));
    const deps = createWagmiVaultDeps(config);
    const error = await deps.openSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe("Switch to a supported network to continue.");
    expect(getConnectorClient).not.toHaveBeenCalled();
  });

  it("opens a session on the wallet's own client for its chain, account and connector", async () => {
    const connector = fakeConnector("metaMask");
    const provider = fakeProvider((r) => (r.method === "eth_getCode" ? "0x6001" : unexpected(r)));
    jest.mocked(getAccount).mockReturnValue(accountState({ status: "connected", chainId: 137, connector }));
    jest.mocked(getConnectorClient).mockResolvedValue(walletClient(provider));

    const session = await createWagmiVaultDeps(config).openSession();

    expect(getConnectorClient).toHaveBeenCalledWith(config, {
      chainId: 137,
      connector,
      account: TEST_WALLET,
      assertChainId: true,
    });
    expect(session).toMatchObject({ address: TEST_WALLET, chainId: 137, connectorId: "metaMask" });
    expect(await session.source.getCode(TEST_WALLET)).toBe("0x6001");
    expect(provider.requests.map((r) => r.method)).toEqual(["eth_getCode"]);
    expect(getPublicClient).not.toHaveBeenCalled();
  });

  it("passes a connector client failure through", async () => {
    const failure = new Error("Chain mismatch");
    jest.mocked(getAccount).mockReturnValue(accountState({ status: "connected", chainId: 1, connector: fakeConnector() }));
    jest.mocked(getConnectorClient).mockRejectedValue(failure);
    await expect(createWagmiVaultDeps(config).openSession()).rejects.toBe(failure);
  });
});

describe("session writes", () => {
  async function openOn(chainId: 1 | 137 | 8453, connector: Connector) {
    jest.mocked(getAccount).mockReturnValue(accountState({ status: "connected", chainId, connector }));
    jest.mocked(getConnectorClient).mockResolvedValue(walletClient(fakeProvider(unexpected)));
    return createWagmiVaultDeps(config).openSession();
  }

  it("approves the spender for the amount, pinned to the session", async () => {
    const connector = fakeConnector();
    const session = await openOn(137, connector);
    jest.mocked(writeContract).mockResolvedValue(TEST_TX_HASH);

    const hash = await session.sendApprove(polygonVault.gem, polygonVault.vault, 250_000_000n);

    expect(hash).toBe(TEST_TX_HASH);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledWith(config, {
      abi: erc20Abi,
      address: polygonVault.gem,
      functionName: "approve",
      args: [polygonVault.vault, 250_000_000n],
      chainId: 137,
      account: TEST_WALLET,
      connector,
    });
  });

  it.each(["sellGem", "buyGem"] as const)("sends %s(recipient, amountIn), pinned to the session", async (fn) => {
    const connector = fakeConnector("walletConnect");
    const session = await openOn(8453, connector);
    const recipient: Address = "0x7777777777777777777777777777777777777777";
    jest.mocked(writeContract).mockResolvedValue(TEST_TX_HASH);

    await expect(session.sendSwap(VAULT_DEPLOYMENTS[8453].vault, fn, recipient, 5n)).resolves.toBe(TEST_TX_HASH);

    expect(writeContract).toHaveBeenCalledWith(config, {
      abi: vaultAbi,
      address: VAULT_DEPLOYMENTS[8453].vault,
      functionName: fn,
      args: [recipient, 5n],
      chainId: 8453,
      account: TEST_WALLET,
      connector,
    });
  });

  it("passes a wallet rejection through", async () => {
    const session = await openOn(1, fakeConnector());
    const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });
    jest.mocked(writeContract).mockRejectedValue(rejection);
    await expect(session.sendApprove(VAULT_DEPLOYMENTS[1].gem, VAULT_DEPLOYMENTS[1].vault, 1n)).rejects.toBe(rejection);
  });
});

describe("watcherDeps", () => {
  async function sessionOver(provider: ReturnType<typeof fakeProvider>) {
    jest.mocked(getAccount).mockReturnValue(accountState({ status: "connected", chainId: 137, connector: fakeConnector() }));
    jest.mocked(getConnectorClient).mockResolvedValue(walletClient(provider));
    return createWagmiVaultDeps(config).openSession();
  }

  it("offers the calls status only for a smart-account record", async () => {
    const provider = fakeProvider((r) =>
      r.method === "wallet_getCallsStatus"
        ? { version: "2.0.0", id: r.params[0], chainId: "0x89", status: 200, atomic: true, receipts: [] }
        : unexpected(r)
    );
    const session = await sessionOver(provider);

    expect(session.watcherDeps(buildPendingApproveRecord()).getCallsStatus).toBeUndefined();
    expect(session.watcherDeps(buildPendingSwapRecord()).getCallsStatus).toBeUndefined();

    const getCallsStatus = session.watcherDeps(buildPendingSwapRecord({ smartAccount: true })).getCallsStatus;
    expect(getCallsStatus).toBeDefined();
    await expect(getCallsStatus?.(TEST_TX_HASH)).resolves.toEqual({ status: "success", statusCode: 200 });
    expect(provider.requests).toEqual([{ method: "wallet_getCallsStatus", params: [TEST_TX_HASH] }]);
  });

  it("reads allowance(owner, vault) on tokenIn at the given block through the wallet", async () => {
    const record = buildPendingApproveRecord({ direction: "eusdToUsdc" });
    const provider = fakeProvider((r) => {
      if (r.method !== "eth_call") return unexpected(r);
      const [call, block] = r.params as [{ to: Address; data: Hex }, Hex];
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
      const matches =
        isAddressEqual(call.to, record.tokenIn) &&
        functionName === "allowance" &&
        isAddressEqual(args[0] as Address, record.address) &&
        isAddressEqual(args[1] as Address, record.vault) &&
        block === numberToHex(123n);
      return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: matches ? 777n : 0n });
    });
    const session = await sessionOver(provider);

    await expect(session.watcherDeps(record).readAllowanceAt(123n)).resolves.toBe(777n);
    expect(provider.requests).toHaveLength(1);
    expect(record.tokenIn).toBe(polygonVault.stable);
  });

  it("waits for the receipt of the hash on the wallet's client", async () => {
    const hash: Hash = `0x${"ab".repeat(32)}`;
    const provider = fakeProvider((r) =>
      r.method === "eth_getTransactionReceipt" && r.params[0] === hash
        ? { transactionHash: hash, blockNumber: "0x64", status: "0x1", logs: [] }
        : unexpected(r)
    );
    const session = await sessionOver(provider);
    const onReplaced = jest.fn();

    const receipt = await session.watcherDeps(buildPendingSwapRecord({ hash })).waitForReceipt({
      hash,
      confirmations: 1,
      pollingInterval: 4_000,
      timeout: 60_000,
      checkReplacement: true,
      onReplaced,
    });

    expect(receipt).toMatchObject({ transactionHash: hash, blockNumber: 100n, status: "success" });
    expect(onReplaced).not.toHaveBeenCalled();
  });
});

describe("resumeSession", () => {
  it.each([
    ["no connector", undefined],
    ["a plain object", { id: "injected" }],
    ["a connector with another id", fakeConnector("walletConnect")],
  ])("refuses %s without prompting the wallet", async (_, connector) => {
    const deps = createWagmiVaultDeps(config);
    const error = await deps.resumeSession(buildPendingSwapRecord(), connector).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(getConnectorClient).not.toHaveBeenCalled();
    expect(switchChain).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("reports a connector that cannot serve the record's chain and account", async () => {
    const failure = new Error("Connector chain mismatch");
    jest.mocked(getConnectorClient).mockRejectedValue(failure);
    const error = await createWagmiVaultDeps(config)
      .resumeSession(buildPendingSwapRecord(), fakeConnector())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).cause).toBe(failure);
    expect(switchChain).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("binds the session to the record's chain, address and connector", async () => {
    const owner: Address = "0x8888888888888888888888888888888888888888";
    const record = buildPendingApproveRecord({ chainId: 8453, address: owner, connectorId: "coinbaseWalletSDK" });
    const connector = fakeConnector("coinbaseWalletSDK");
    jest.mocked(getConnectorClient).mockResolvedValue(walletClient(fakeProvider(unexpected), owner));
    jest.mocked(writeContract).mockResolvedValue(TEST_TX_HASH);

    const session = await createWagmiVaultDeps(config).resumeSession(record, connector);

    expect(getAccount).not.toHaveBeenCalled();
    expect(getConnectorClient).toHaveBeenCalledWith(config, {
      chainId: 8453,
      connector,
      account: owner,
      assertChainId: true,
    });
    expect(session).toMatchObject({ address: owner, chainId: 8453, connectorId: "coinbaseWalletSDK" });
    await session.sendApprove(record.tokenIn, record.vault, record.amountIn);
    expect(writeContract).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ chainId: 8453, account: owner, connector })
    );
    expect(switchChain).not.toHaveBeenCalled();
  });
});

describe("appSource", () => {
  it("builds one source per chain over the app's public client", async () => {
    const provider = fakeProvider((r) => (r.method === "eth_blockNumber" ? "0x64" : unexpected(r)));
    const client = createPublicClient({ chain: polygon, transport: custom(provider) });
    jest.mocked(getPublicClient).mockImplementation(((_: Config, p?: { chainId?: number }) =>
      p?.chainId === 137 ? client : undefined) as unknown as typeof getPublicClient);
    const deps = createWagmiVaultDeps(config);

    const source = deps.appSource(137);
    expect(source).toBeDefined();
    expect(deps.appSource(137)).toBe(source);
    expect(getPublicClient).toHaveBeenCalledTimes(1);
    expect(getPublicClient).toHaveBeenCalledWith(config, { chainId: 137 });
    await expect(source?.getBlockNumber()).resolves.toBe(100n);
    expect(provider.requests.map((r) => r.method)).toEqual(["eth_blockNumber"]);
  });

  it("returns undefined when the chain has no client", () => {
    jest.mocked(getPublicClient).mockReturnValue(undefined as unknown as PublicClient);
    const deps = createWagmiVaultDeps(config);
    expect(deps.appSource(8453)).toBeUndefined();
    expect(deps.appSource(8453)).toBeUndefined();
    expect(getPublicClient).toHaveBeenCalledTimes(2);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    jest.useFakeTimers();
    let done = false;
    void createWagmiVaultDeps(config)
      .sleep(1_000)
      .then(() => {
        done = true;
      });
    await jest.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("resolves early when the signal aborts and clears its timer", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const sleeping = createWagmiVaultDeps(config).sleep(60_000, controller.signal);
    expect(jest.getTimerCount()).toBe(1);
    controller.abort();
    await expect(sleeping).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("resolves at once for an already aborted signal", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await expect(createWagmiVaultDeps(config).sleep(60_000, controller.signal)).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});

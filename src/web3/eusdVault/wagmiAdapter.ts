/**
 * Builds the vault lifecycle's dependencies from wagmi. The only module in the feature that talks to wagmi's
 * actions and signs through the wallet; everything it hands out is plain functions over viem clients.
 */
import type { Account, Address, Chain, Client, Transport } from "viem";
import { getCallsStatus, readContract, waitForTransactionReceipt } from "viem/actions";
import type { Config, Connector } from "wagmi";
import { getAccount, getConnectorClient, getPublicClient, writeContract } from "wagmi/actions";
import { erc20Abi, vaultAbi } from "./abis";
import { isVaultChainId } from "./deployments";
import { AppError } from "./errors";
import { createPendingStorage } from "./pendingRecords";
import { createClientChainSource } from "./reads";
import type { ChainSource, VaultChainId, VaultLifecycleDeps, VaultPendingRecord, WalletSession } from "./types";

type WalletClient = Client<Transport, Chain | undefined, Account>;
type RawRequest = (args: Readonly<{ method: string; params?: unknown }>, options?: unknown) => Promise<unknown>;

const CONNECT_MESSAGE = "Connect your wallet to continue.";
const SWITCH_MESSAGE = "Switch to a supported network to continue.";
const RESUME_MESSAGE =
  "The wallet that sent this transaction is not available on its network. Reconnect it to keep tracking the transaction.";
const WALLET_MOVED_MESSAGE = "Your wallet switched to another network. Switch it back to continue.";

let pinnedClientCount = 0;

/**
 * The session's client held to the session's chain. For an injected wallet the connector client's transport is the
 * wallet's own provider, so its reads follow the wallet to whatever network it is on now. Every call except
 * `eth_chainId` first asks the same provider for its chain (injected wallets, WalletConnect and Base Account answer
 * that themselves, without a network request) and fails rather than read another chain. Once `signal` aborts, every
 * call fails before reaching the provider: viem's receipt wait takes no signal, so this is what silences a poll that
 * was abandoned, until its own timeout ends it.
 *
 * wagmi builds the connector client with `createClient`, so it carries no bound actions and every viem action run on
 * the copy goes through this `request`. The copy gets its own `uid` because viem merges receipt waits and block
 * watchers by client uid; a new wait must never attach to an abandoned poller.
 */
function pinnedClient(client: WalletClient, chainId: VaultChainId, signal?: AbortSignal): WalletClient {
  // viem types `request` per RPC schema; the wrapper only inspects the method name and forwards the rest untouched.
  const forward = client.request as unknown as RawRequest;
  const request: RawRequest = async (args, options) => {
    if (signal?.aborted) throw signal.reason;
    if (args.method !== "eth_chainId") {
      const current = Number(await forward({ method: "eth_chainId" }));
      if (signal?.aborted) throw signal.reason;
      if (current !== chainId) throw new AppError(WALLET_MOVED_MESSAGE);
    }
    return forward(args, options);
  };
  pinnedClientCount += 1;
  const uid = `${client.uid}.pinned.${pinnedClientCount}`;
  return { ...client, uid, request: request as unknown as WalletClient["request"] };
}

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects; callers check the signal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** `useAccount().connector` reaches the store untyped. */
function isConnector(value: unknown): value is Connector {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "getProvider" in value &&
    typeof value.getProvider === "function" &&
    "getAccounts" in value &&
    typeof value.getAccounts === "function" &&
    "getChainId" in value &&
    typeof value.getChainId === "function"
  );
}

export function createWagmiVaultDeps(config: Config): VaultLifecycleDeps {
  const appSources = new Map<VaultChainId, ChainSource>();

  // `assertChainId` makes wagmi refuse, rather than switch, when the wallet is on another chain.
  function connectorClient(chainId: VaultChainId, connector: Connector, account: Address): Promise<WalletClient> {
    return getConnectorClient(config, { chainId, connector, account, assertChainId: true });
  }

  function buildSession(
    client: WalletClient,
    address: Address,
    chainId: VaultChainId,
    connector: Connector
  ): WalletSession {
    // Every write names the session's chain, account and connector, so a wallet that moved since the preflight
    // fails the request instead of signing somewhere else. Reads go through `reader`, which refuses another chain.
    const pin = { chainId, account: address, connector } as const;
    const reader = pinnedClient(client, chainId);
    return Object.freeze({
      address,
      chainId,
      connectorId: connector.id,
      source: createClientChainSource(reader),
      sendApprove: (token: Address, spender: Address, amount: bigint) =>
        writeContract(config, { ...pin, abi: erc20Abi, address: token, functionName: "approve", args: [spender, amount] }),
      sendSwap: (vault: Address, fn: "sellGem" | "buyGem", recipient: Address, amountIn: bigint) =>
        writeContract(config, { ...pin, abi: vaultAbi, address: vault, functionName: fn, args: [recipient, amountIn] }),
      watcherDeps: (record: VaultPendingRecord) => ({
        waitForReceipt: (p) =>
          waitForTransactionReceipt(pinnedClient(client, chainId, p.signal), {
            hash: p.hash,
            confirmations: p.confirmations,
            pollingInterval: p.pollingInterval,
            timeout: p.timeout,
            checkReplacement: p.checkReplacement,
            onReplaced: ({ reason }) => p.onReplaced({ reason }),
          }),
        readAllowanceAt: (blockNumber) =>
          readContract(reader, {
            address: record.tokenIn,
            abi: erc20Abi,
            functionName: "allowance",
            args: [record.address, record.vault],
            blockNumber,
          }),
        getCallsStatus: record.smartAccount
          ? async (hash) => {
              const { status, statusCode } = await getCallsStatus(reader, { id: hash });
              return { status, statusCode };
            }
          : undefined,
      }),
    });
  }

  async function openSession(): Promise<WalletSession> {
    const account = getAccount(config);
    if (account.status !== "connected" || !account.address || !account.connector) {
      throw new AppError(CONNECT_MESSAGE);
    }
    const { address, chainId, connector } = account;
    if (!isVaultChainId(chainId)) throw new AppError(SWITCH_MESSAGE);
    const client = await connectorClient(chainId, connector, address);
    return buildSession(client, address, chainId, connector);
  }

  // Never prompts: no switch, no connect. A connector that cannot serve the record's chain and account is reported.
  async function resumeSession(record: VaultPendingRecord, connector: unknown): Promise<WalletSession> {
    if (!isConnector(connector) || connector.id !== record.connectorId) throw new AppError(RESUME_MESSAGE);
    let client: WalletClient;
    try {
      client = await connectorClient(record.chainId, connector, record.address);
    } catch (error) {
      throw new AppError(RESUME_MESSAGE, { cause: error });
    }
    return buildSession(client, record.address, record.chainId, connector);
  }

  function appSource(chainId: VaultChainId): ChainSource | undefined {
    const cached = appSources.get(chainId);
    if (cached) return cached;
    const client = getPublicClient(config, { chainId });
    if (!client) return undefined;
    const source = createClientChainSource(client);
    appSources.set(chainId, source);
    return source;
  }

  return Object.freeze({
    storage: createPendingStorage(),
    now: () => Date.now(),
    sleep,
    openSession,
    resumeSession,
    appSource,
    logger: console,
  });
}

import React, { type ReactElement } from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { decodeFunctionData, encodeFunctionResult, getAddress, isAddressEqual, type Address, type Hex } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { erc20Abi, multicall3Abi, vaultAbi } from "@/web3/eusdVault/abis";
import { VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { writePendingRecord } from "@/web3/eusdVault/pendingRecords";
import { createLifecycleHarness, receiptFor, type LifecycleHarness } from "@/web3/eusdVault/testing/lifecycleHarness";
import { TEST_TX_HASH, TEST_WALLET, buildPendingSwapRecord } from "@/web3/eusdVault/testing/receipts";
import type {
  ChainSource,
  Multicall3Call,
  Multicall3Result,
  SwapQuote,
  VaultChainId,
  VaultDeployment,
  VaultPendingRecord,
} from "@/web3/eusdVault/types";
import EusdVaultPage from "./EusdVaultPage";

jest.mock("wagmi", () => ({ useAccount: jest.fn(), useConfig: jest.fn(), useSwitchChain: jest.fn() }));

jest.mock("../../components/layout/CustomConnectButton", () => ({
  CustomConnectButton: () => (
    <button type="button" data-testid="connect-button">
      Connect Wallet
    </button>
  ),
}));

// The page's only way to the wallet and the chain: the harness's fake deps, read lazily per test.
jest.mock("../../web3/eusdVault/wagmiAdapter", () => ({ createWagmiVaultDeps: () => mockHarness.deps }));

jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

type Account = Readonly<{
  status: "connected" | "disconnected";
  isConnected: boolean;
  address?: Address;
  chainId?: number;
  connector?: Readonly<{ id: string; uid: string }>;
}>;

/** What the fake chain answers. Quotes charge `amountIn / feeDivisor`. */
type VaultWorld = {
  stable: Address;
  paused: boolean;
  reserves: { stable: bigint; gem: bigint };
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  feeDivisor: bigint;
  block: bigint;
  balances: { stable: bigint; gem: bigint };
  allowances: { stable: bigint; gem: bigint };
};

const POLYGON = VAULT_DEPLOYMENTS[137];
const CONFIG = Object.freeze({});
const DISCONNECTED: Account = { status: "disconnected", isConnected: false };
const CONNECTED: Account = {
  status: "connected",
  isConnected: true,
  address: TEST_WALLET,
  chainId: 137,
  connector: { id: "injected", uid: "uid-1" },
};
const QUOTE_WAIT = { timeout: 3000 };

let mockHarness: LifecycleHarness;
let world: VaultWorld;
let account: Account;
let previews: Array<Readonly<{ functionName: string; amountIn: bigint }>>;
const switchChain = jest.fn();
const clients: QueryClient[] = [];

function defaultWorld(): VaultWorld {
  return {
    stable: POLYGON.stable,
    paused: false,
    reserves: { stable: 1_234_567_890_000n, gem: 2_000_000_000_000n },
    maxPerTransaction: 0n,
    maxPerBlock: 0n,
    feeDivisor: 1_000n,
    block: 1_000n,
    balances: { stable: 500_000_000n, gem: 1_000_500_000n },
    allowances: { stable: 10n ** 30n, gem: 10n ** 30n },
  };
}

function quoteFor(amountIn: bigint): SwapQuote {
  const fee = amountIn / world.feeDivisor;
  return { amountOut: amountIn - fee, fee };
}

function answer(d: VaultDeployment, call: Multicall3Call, blockNumber: bigint): Multicall3Result {
  const ok = (returnData: Hex): Multicall3Result => ({ success: true, returnData });
  if (isAddressEqual(call.target, d.multicall3)) {
    const { functionName } = decodeFunctionData({ abi: multicall3Abi, data: call.callData });
    if (functionName === "getChainId") {
      return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: BigInt(d.chainId) }));
    }
    if (functionName === "getBlockNumber") {
      return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: blockNumber }));
    }
  } else if (isAddressEqual(call.target, d.vault)) {
    const decoded = decodeFunctionData({ abi: vaultAbi, data: call.callData });
    const { functionName } = decoded;
    switch (functionName) {
      case "STABLE":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: world.stable }));
      case "GEM":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: d.gem }));
      case "paused":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: world.paused }));
      case "getReserves":
        return ok(
          encodeFunctionResult({ abi: vaultAbi, functionName, result: [world.reserves.stable, world.reserves.gem] })
        );
      case "maxPerTransaction":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: world.maxPerTransaction }));
      case "maxPerBlock":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: world.maxPerBlock }));
      case "tin":
      case "tout":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: 10n ** 18n / world.feeDivisor }));
      case "previewSellGem":
      case "previewBuyGem": {
        const amountIn = decoded.args[0];
        previews.push({ functionName, amountIn });
        const { amountOut, fee } = quoteFor(amountIn);
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: [amountOut, fee] }));
      }
    }
  } else {
    const token = isAddressEqual(call.target, d.stable) ? "stable" : isAddressEqual(call.target, d.gem) ? "gem" : undefined;
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data: call.callData });
    if (token !== undefined) {
      switch (functionName) {
        case "paused":
          return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: false }));
        case "balanceOf":
          return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: world.balances[token] }));
        case "allowance":
          return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: world.allowances[token] }));
      }
    }
  }
  throw new Error(`unexpected sub-call to ${call.target}`);
}

/**
 * The app's source for one chain. It answers both the page read and the preflight snapshot by decoding each
 * sub-call, since the two reads have different layouts; the preflight's wallet provider uses it too, so the two
 * providers always agree.
 */
function chainSource(d: VaultDeployment): ChainSource {
  return {
    getBlockNumber: async () => world.block,
    aggregate3: async (multicall3, calls, blockNumber) => {
      if (!isAddressEqual(multicall3, d.multicall3)) throw new Error(`unexpected multicall3 ${multicall3}`);
      return calls.map((call) => answer(d, call, blockNumber ?? world.block));
    },
    simulateSwap: async ({ amountIn }) => quoteFor(amountIn).amountOut,
    getCode: async () => undefined,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <EusdVaultPage />
    </QueryClientProvider>
  );
}

const amountInput = (symbol: string) => screen.getByRole("textbox", { name: `Amount of ${symbol} to swap` });
const receiveInput = (symbol: string) => screen.getByRole("textbox", { name: `Amount of ${symbol} to receive` });
const balanceLabels = () => screen.getAllByText(/^Balance:/).map((p) => p.textContent);
/** The value next to a stats term ("Fee", "Vault liquidity"). */
function stat(term: string): string | null {
  const index = screen.getAllByRole("term").findIndex((dt) => dt.textContent === term);
  return screen.getAllByRole("definition")[index].textContent;
}

async function waitForBalances() {
  await waitFor(() => expect(balanceLabels()).toEqual(["Balance: 1,000.5", "Balance: 500"]));
}

/** Replaces the page with the content of the first call to a mocked toast method. */
function showToast(method: "success" | "warning", page: RenderResult) {
  page.unmount();
  render(jest.mocked(toast[method]).mock.calls[0][0] as ReactElement);
}

beforeEach(() => {
  world = defaultWorld();
  previews = [];
  account = DISCONNECTED;
  mockHarness = createLifecycleHarness();
  const sources = new Map<VaultChainId, ChainSource>();
  const sourceFor = (chainId: VaultChainId): ChainSource => {
    const source = sources.get(chainId) ?? chainSource(VAULT_DEPLOYMENTS[chainId]);
    sources.set(chainId, source);
    return source;
  };
  mockHarness.appSource = sourceFor;
  mockHarness.openSession = async () => ({ ...mockHarness.session, source: sourceFor(mockHarness.deployment.chainId) });
  // An approval that mines is visible to the next read.
  mockHarness.send = async (tx) => {
    if (tx.fn === "sendApprove") world.allowances[isAddressEqual(tx.token, POLYGON.gem) ? "gem" : "stable"] = tx.amount;
    return TEST_TX_HASH;
  };
  jest.mocked(useAccount).mockImplementation(() => account as unknown as ReturnType<typeof useAccount>);
  jest.mocked(useConfig).mockReturnValue(CONFIG as unknown as ReturnType<typeof useConfig>);
  jest
    .mocked(useSwitchChain)
    .mockReturnValue({ switchChain, isPending: false } as unknown as ReturnType<typeof useSwitchChain>);
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.clearAllMocks();
});

describe("EusdVaultPage", () => {
  it("renders disconnected on Ethereum with the hero, both cards, the connect button and no balances", async () => {
    world.stable = VAULT_DEPLOYMENTS[1].stable;
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "eUSD Vault" })).toBeInTheDocument();
    expect(screen.getByText(/Swap USDC and eUSD 1:1 at the bank's peg-stability vault/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Official Contract Addresses" })).toBeInTheDocument();
    expect(screen.getByText(VAULT_DEPLOYMENTS[1].gem)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ethereum" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
    expect(balanceLabels()).toEqual(["Balance: —", "Balance: —"]);
    expect(stat("Vault liquidity")).toBe("—");

    await waitFor(() => expect(stat("Vault liquidity")).toBe("1,234,567.89 eUSD"));
    expect(balanceLabels()).toEqual(["Balance: —", "Balance: —"]);
    expect(screen.getByText(VAULT_DEPLOYMENTS[1].vault, { selector: "span" })).toBeInTheDocument();
  });

  it("sets white text on the page root, since the app sets no text colour", async () => {
    world.stable = VAULT_DEPLOYMENTS[1].stable;
    renderPage();

    const main = screen.getByRole("main");
    expect(main).toHaveClass("text-white");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "eUSD Vault" }));
    await waitFor(() => expect(stat("Vault liquidity")).toBe("1,234,567.89 eUSD"));
  });

  it("lets a visitor without a wallet pick a network, reverse the direction and see a quote", async () => {
    world.stable = VAULT_DEPLOYMENTS[1].stable;
    renderPage();
    await waitFor(() => expect(stat("Vault liquidity")).toBe("1,234,567.89 eUSD"));

    expect(screen.getByRole("button", { name: "Polygon" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reverse direction, now USDC to eUSD" })).toBeEnabled();
    expect(amountInput("USDC")).toBeEnabled();

    fireEvent.change(amountInput("USDC"), { target: { value: "250" } });
    await waitFor(() => expect(receiveInput("eUSD")).toHaveValue("249.75"), QUOTE_WAIT);
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
    expect(mockHarness.sent).toEqual([]);
  });

  it("shows the quote for a typed amount once typing stops", async () => {
    account = CONNECTED;
    renderPage();
    await waitForBalances();

    fireEvent.change(amountInput("USDC"), { target: { value: "250" } });
    expect(screen.getByRole("button", { name: "Fetching quote..." })).toBeDisabled();
    expect(receiveInput("eUSD")).toHaveValue("");

    await waitFor(() => expect(receiveInput("eUSD")).toHaveValue("249.75"), QUOTE_WAIT);
    expect(stat("Fee")).toBe("0.25 eUSD");
    expect(previews).toContainEqual({ functionName: "previewSellGem", amountIn: 250_000_000n });
  });

  it("swaps the symbols and clears the amount when the direction is reversed", async () => {
    account = CONNECTED;
    renderPage();
    await waitForBalances();
    fireEvent.change(amountInput("USDC"), { target: { value: "12" } });

    fireEvent.click(screen.getByRole("button", { name: "Reverse direction, now USDC to eUSD" }));

    expect(amountInput("eUSD")).toHaveValue("");
    expect(receiveInput("USDC")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Reverse direction, now eUSD to USDC" })).toBeInTheDocument();
    await waitFor(() => expect(balanceLabels()).toEqual(["Balance: 500", "Balance: 1,000.5"]));
    expect(stat("Vault liquidity")).toBe("2,000,000 USDC");
  });

  it("fills the balance with MAX", async () => {
    account = CONNECTED;
    renderPage();
    await waitForBalances();

    fireEvent.click(screen.getByRole("button", { name: "MAX" }));

    expect(amountInput("USDC")).toHaveValue("1000.5");
  });

  it("approves the exact amount through the wallet when the allowance is short", async () => {
    account = CONNECTED;
    world.allowances.gem = 0n;
    const view = renderPage();
    await waitForBalances();

    fireEvent.change(amountInput("USDC"), { target: { value: "250" } });
    const approve = await screen.findByRole("button", { name: "Step 1: Approve USDC" }, QUOTE_WAIT);
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await waitFor(() => expect(mockHarness.log).toContain("sendApprove"));
    expect(mockHarness.sent).toEqual([
      { fn: "sendApprove", token: POLYGON.gem, spender: POLYGON.vault, amount: 250_000_000n },
    ]);
    expect(await screen.findByRole("button", { name: "Step 2: Swap USDC for eUSD" })).toBeEnabled();
    expect(amountInput("USDC")).toHaveValue("250");

    expect(toast.success).toHaveBeenCalledTimes(1);
    showToast("success", view);
    expect(screen.getByText(/Your USDC approval for the vault is confirmed/)).toBeInTheDocument();
  });

  it("swaps with the quote that was shown when the allowance covers the amount", async () => {
    account = CONNECTED;
    const watched: VaultPendingRecord[] = [];
    mockHarness.waitForReceipt = (record) => {
      watched.push(record);
      return Promise.resolve(receiptFor(record));
    };
    const view = renderPage();
    await waitForBalances();

    fireEvent.change(amountInput("USDC"), { target: { value: "250" } });
    await waitFor(() => expect(receiveInput("eUSD")).toHaveValue("249.75"), QUOTE_WAIT);
    const swap = screen.getByRole("button", { name: "Step 2: Swap USDC for eUSD" });
    expect(swap).toBeEnabled();
    fireEvent.click(swap);

    expect(await screen.findByText("You received 249.75 eUSD on Polygon.")).toBeInTheDocument();
    expect(mockHarness.sent).toEqual([
      { fn: "sendSwap", vault: POLYGON.vault, functionName: "sellGem", recipient: TEST_WALLET, amountIn: 250_000_000n },
    ]);
    expect(watched).toHaveLength(1);
    expect(watched[0]).toMatchObject({ kind: "swap", amountIn: 250_000_000n, quotedOut: 249_750_000n, quotedFee: 250_000n });
    expect(amountInput("USDC")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(/You received/)).not.toBeInTheDocument();

    expect(toast.success).toHaveBeenCalledTimes(1);
    showToast("success", view);
    expect(screen.getByText("You received 249.75 eUSD.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      `https://polygonscan.com/tx/${TEST_TX_HASH}`
    );
  });

  it("reports a fee change at the click once and shows the vault's new quote", async () => {
    account = CONNECTED;
    renderPage();
    await waitForBalances();
    fireEvent.change(amountInput("USDC"), { target: { value: "250" } });
    await waitFor(() => expect(receiveInput("eUSD")).toHaveValue("249.75"), QUOTE_WAIT);

    world.feeDivisor = 500n;
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Swap USDC for eUSD" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(mockHarness.sent).toEqual([]);
    // Without the page's refetch the old quote would stay up until the 15 s refresh.
    await waitFor(() => expect(receiveInput("eUSD")).toHaveValue("249.5"));
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("offers a network switch on an unsupported network and reads the selected chain without the wallet", async () => {
    account = { ...CONNECTED, chainId: 10 };
    world.stable = VAULT_DEPLOYMENTS[1].stable;
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Switch to supported network" }));

    expect(switchChain).toHaveBeenCalledWith({ chainId: 1 }, expect.objectContaining({ onError: expect.any(Function) }));
    await waitFor(() => expect(stat("Vault liquidity")).toBe("1,234,567.89 eUSD"));
    expect(balanceLabels()).toEqual(["Balance: —", "Balance: —"]);
  });

  it("disables every action when the vault's identity does not match", async () => {
    account = CONNECTED;
    world.stable = getAddress(`0x${"99".repeat(20)}`);
    renderPage();

    expect(await screen.findByText("Security verification failed: vault contract identity mismatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Security verification unavailable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
    expect(balanceLabels()).toEqual(["Balance: —", "Balance: —"]);
    expect(stat("Vault liquidity")).toBe("—");
  });

  it("locks the form on a pending record found at mount and reads for its direction and amount", async () => {
    account = CONNECTED;
    const record = buildPendingSwapRecord({
      direction: "eusdToUsdc",
      amountIn: 12_500_000n,
      quotedOut: 12_487_500n,
      quotedFee: 12_500n,
    });
    writePendingRecord(mockHarness.storage, record, undefined, mockHarness.clock.now());
    mockHarness.waitForReceipt = () => new Promise(() => undefined);
    renderPage();

    const input = await screen.findByRole("textbox", { name: "Amount of eUSD to swap" });
    expect(input).toHaveValue("12.5");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reverse direction, now eUSD to USDC" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Polygon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Swap(ping| pending)\.\.\.$/ })).toBeDisabled();

    await waitFor(() => expect(receiveInput("USDC")).toHaveValue("12.4875"), QUOTE_WAIT);
    expect(previews).toContainEqual({ functionName: "previewBuyGem", amountIn: 12_500_000n });
    expect(previews.some((p) => p.functionName === "previewSellGem")).toBe(false);
    expect(mockHarness.sent).toEqual([]);
  });
});

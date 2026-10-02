import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SwapPage from "./SwapPage";

const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDCE = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const EUSD = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734";
const TAKER = "0x00000000000000000000000000000000000000aa";
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";

const mockParams = { value: new URLSearchParams() };
jest.mock("next/navigation", () => ({ useSearchParams: () => mockParams.value }));

const mockWallet: { address?: string; chainId?: number; isConnected: boolean } = { isConnected: false };
const mockSwitchChainAsync = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockSendTransactionAsync = jest.fn();
jest.mock("wagmi", () => ({
  useAccount: () => ({ address: mockWallet.address, isConnected: mockWallet.isConnected, chain: mockWallet.chainId ? { id: mockWallet.chainId } : undefined }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
  useSendTransaction: () => ({ sendTransactionAsync: mockSendTransactionAsync }),
}));

// One client double for every chain, created inside the factory because the page reads the clients at import.
jest.mock("../../lib/publicClients", () => {
  const client = { readContract: jest.fn(), getBalance: jest.fn(), waitForTransactionReceipt: jest.fn() };
  return { publicClientEthereum: client, publicClientPolygon: client, publicClientBase: client };
});
const mockClient = jest.requireMock("../../lib/publicClients").publicClientPolygon as {
  readContract: jest.Mock;
  getBalance: jest.Mock;
  waitForTransactionReceipt: jest.Mock;
};

const mockNotify = jest.fn();
jest.mock("../../components/eusdVault/vaultToasts", () => ({ notifyVaultSwapConfirmed: (...args: unknown[]) => mockNotify(...args) }));
jest.mock("../../components/layout/CustomConnectButton", () => ({
  CustomConnectButton: () => <button type="button">Connect Wallet</button>,
}));
jest.mock("../../components/eusdVault/VaultNetworkSelector", () => ({
  VaultNetworkSelector: ({ onSelect, selectedChainId }: { onSelect: (id: number) => void; selectedChainId: number }) => (
    <>
      <button type="button" onClick={() => onSelect(8453)}>
        Base network
      </button>
      <output aria-label="Selected network">{selectedChainId}</output>
    </>
  ),
}));

const quote = (overrides: Record<string, unknown> = {}) => ({
  liquidityAvailable: true,
  sellAmount: "5000000",
  buyAmount: "2150000000000000000000",
  minBuyAmount: "2139250000000000000000",
  allowance: null,
  balanceShort: false,
  gas: "210000",
  gasPrice: "1",
  sources: ["Uniswap_V4"],
  transaction: { to: ALLOWANCE_HOLDER, data: "0xabcd", value: "0", gas: "210000" },
  ...overrides,
});

const mockFetch = jest.fn();
// jsdom has no Response, so the route's answers are plain objects with the fields fetchQuote reads.
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC, buy: TEL, amount: "5" });
  Object.assign(mockWallet, { address: TAKER, chainId: 137, isConnected: true });
  for (const mock of [mockSwitchChainAsync, mockWriteContractAsync, mockSendTransactionAsync, mockNotify, mockFetch, ...Object.values(mockClient)]) mock.mockReset();
  mockClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === "balanceOf" ? 100_000_000n : functionName === "getReserves" ? [0n, 0n] : undefined));
  mockClient.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mockFetch.mockImplementation(async () => json(quote()));
  global.fetch = mockFetch as unknown as typeof fetch;
  window.localStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

const renderPage = () => render(<SwapPage />);

describe("SwapPage", () => {
  it("prefills from the query string and shows the firm quote for the connected wallet", async () => {
    renderPage();
    expect(await screen.findByText("2,150")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to sell")).toHaveValue("5");
    expect(mockFetch.mock.calls[0][0]).toBe(`/api/swap/quote?chain=polygon&sellToken=${USDC}&buyToken=${TEL}&sellAmount=5000000&slippageBps=50&taker=${TAKER}`);
    expect(screen.getByText("Minimum received")).toBeInTheDocument();
    expect(screen.getByText("2,139")).toBeInTheDocument();
    expect(screen.getByText("Uniswap V4")).toBeInTheDocument();
    expect(screen.getByText("None on this pair")).toBeInTheDocument();
  });

  it("states 0x's fee, shows it on a quote that carries one, and links the same swap on Uniswap", async () => {
    mockFetch.mockResolvedValue(json(quote({ zeroExFee: { amount: "7500", token: USDC } })));
    renderPage();
    expect(await screen.findByText("0.0075")).toBeInTheDocument();
    expect(screen.getByText(/which charges a 0.15% fee on some pairs. TELx adds no fee of its own./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Make this swap on Uniswap" });
    expect(link).toHaveAttribute("href", `https://app.uniswap.org/swap?chain=polygon&inputCurrency=${USDC}&outputCurrency=${TEL}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("draws each token picker as logo, symbol, a gap and the chevron, over a transparent native select", async () => {
    renderPage();
    await screen.findByText("2,150");
    for (const label of ["Token to sell", "Token to buy"]) {
      const select = screen.getByLabelText(label);
      expect(select.tagName).toBe("SELECT");
      expect(select).toHaveClass("absolute", "inset-0", "opacity-0");
      const face = screen.getByTestId(`${select.id}-face`);
      expect(face).toHaveAttribute("aria-hidden", "true");
      expect(face).toHaveClass("gap-2", "pr-3");
      expect(screen.getByTestId(`${select.id}-symbol`)).toHaveTextContent(label === "Token to sell" ? "USDC" : "TEL");
      expect(screen.getByTestId(`${select.id}-symbol`)).toHaveClass("truncate");
      expect(screen.getByTestId(`${select.id}-chevron`)).toHaveClass("ml-1", "shrink-0");
      // The logo, the symbol and the chevron come in that order.
      const order = [within(face).getByTestId(label === "Token to sell" ? "token-icon-USDC" : "token-icon-TEL"), screen.getByTestId(`${select.id}-symbol`), screen.getByTestId(`${select.id}-chevron`)];
      expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("rounds the balance down, and MAX still fills the exact balance", async () => {
    const user = userEvent.setup();
    mockClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === "balanceOf" ? 1_233_600_000n : undefined));
    renderPage();
    expect(await screen.findByText(/Balance 1,233/)).toBeInTheDocument();
    expect(screen.queryByText(/Balance 1,234/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(screen.getByLabelText("Amount to sell")).toHaveValue("1233.6");
  });

  it("says the sell and buy assets must differ, without asking for a quote", async () => {
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: TEL, buy: TEL, amount: "5" });
    renderPage();
    expect(await screen.findByText("The sell asset and buy asset must be different.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick two different assets" })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("slippage", () => {
    const lastSlippage = () => new URL(`https://x${mockFetch.mock.calls.at(-1)![0]}`).searchParams.get("slippageBps");

    it("takes a custom value, remembers it, and warns above 2%", async () => {
      const user = userEvent.setup();
      const { unmount } = renderPage();
      await screen.findByText("2,150");
      await user.click(screen.getByRole("button", { name: "Custom" }));
      const input = screen.getByLabelText("Custom slippage percentage");
      await user.clear(input);
      await user.type(input, "0.75");
      await waitFor(() => expect(lastSlippage()).toBe("75"));
      expect(screen.queryByText(/High slippage/)).not.toBeInTheDocument();

      await user.clear(input);
      await user.type(input, "3");
      await waitFor(() => expect(lastSlippage()).toBe("300"));
      expect(screen.getByText("High slippage: this swap can fill at up to 3% less than quoted.")).toBeInTheDocument();

      unmount();
      mockFetch.mockClear();
      renderPage();
      await waitFor(() => expect(screen.getByLabelText("Custom slippage percentage")).toHaveValue("3"));
      await waitFor(() => expect(lastSlippage()).toBe("300"));
    });

    it("refuses a value out of range and keeps the last valid one", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("2,150");
      await user.click(screen.getByRole("button", { name: "Custom" }));
      const input = screen.getByLabelText("Custom slippage percentage");
      fireEvent.change(input, { target: { value: "60" } });
      expect(screen.getByText("Slippage can't be more than 50%. The swap uses 0.5% until then.")).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(input, { target: { value: "0" } });
      expect(screen.getByText("Slippage must be at least 0.01%. The swap uses 0.5% until then.")).toBeInTheDocument();
      expect(lastSlippage()).toBe("50");
    });

    it("goes back to a preset and remembers that too", async () => {
      const user = userEvent.setup();
      const { unmount } = renderPage();
      await screen.findByText("2,150");
      await user.click(screen.getByRole("button", { name: "1%" }));
      await waitFor(() => expect(lastSlippage()).toBe("100"));
      unmount();
      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "true"));
      expect(screen.queryByLabelText("Custom slippage percentage")).not.toBeInTheDocument();
    });
  });

  it("asks for an indicative price and offers to connect without a wallet", async () => {
    Object.assign(mockWallet, { address: undefined, chainId: undefined, isConnected: false });
    renderPage();
    expect(await screen.findByText("2,150")).toBeInTheDocument();
    expect(mockFetch.mock.calls[0][0]).not.toMatch(/taker/);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
  });

  it("approves the exact amount to AllowanceHolder on the selected chain, then quotes again", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementationOnce(async () => json(quote({ allowance: { spender: ALLOWANCE_HOLDER, actual: "0" } })));
    mockWriteContractAsync.mockResolvedValue(HASH);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Approve USDC" }));
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137, address: USDC, functionName: "approve", args: [ALLOWANCE_HOLDER, 5_000_000n] }));
    expect(mockClient.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, confirmations: 1 }));
    expect(await screen.findByRole("button", { name: "Swap" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  describe("after an approval confirms", () => {
    // 0x reads allowances from its own node, so its quotes can keep reporting the old allowance for a few blocks.
    const lagging = () => json(quote({ allowance: { spender: ALLOWANCE_HOLDER, actual: "0" } }));

    beforeEach(() => {
      mockFetch.mockImplementation(async () => lagging());
      mockWriteContractAsync.mockResolvedValue(HASH);
    });

    const approveUsdc = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Approve USDC" }));
      return screen.findByRole("button", { name: "Swap" });
    };

    it("shows Swap at once, before the quote refresh resolves", async () => {
      const user = userEvent.setup();
      mockFetch.mockImplementationOnce(async () => lagging()).mockImplementationOnce(() => new Promise(() => {}));
      renderPage();
      expect(await approveUsdc(user)).toBeEnabled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps Swap while a refreshed quote still reports the old allowance", async () => {
      const user = userEvent.setup();
      renderPage();
      await approveUsdc(user);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: "Swap" })).toBeInTheDocument();
    });

    it("asks for approval again after the sell token changes", async () => {
      const user = userEvent.setup();
      renderPage();
      await approveUsdc(user);
      await user.selectOptions(screen.getByLabelText("Token to sell"), USDCE);
      expect(await screen.findByRole("button", { name: "Approve USDC.e" })).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText("Token to sell"), USDC);
      expect(await screen.findByRole("button", { name: "Approve USDC" })).toBeInTheDocument();
    });

    it("asks for approval again after the account changes", async () => {
      const user = userEvent.setup();
      const { rerender } = renderPage();
      await approveUsdc(user);
      mockWallet.address = "0x00000000000000000000000000000000000000bb";
      rerender(<SwapPage />);
      expect(await screen.findByRole("button", { name: "Approve USDC" })).toBeInTheDocument();
    });

    it("still refreshes a stale quote when Swap is clicked", async () => {
      const user = userEvent.setup();
      renderPage();
      const button = await approveUsdc(user);
      jest.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
      await user.click(button);
      expect(await screen.findByText(/The quote was out of date, so it was refreshed/)).toBeInTheDocument();
      expect(mockSendTransactionAsync).not.toHaveBeenCalled();
    });

    it("leaves the swap's own confirmations unchanged", async () => {
      const user = userEvent.setup();
      mockSendTransactionAsync.mockResolvedValue(HASH);
      renderPage();
      await user.click(await approveUsdc(user));
      await screen.findByText(/Swap confirmed/);
      expect(mockClient.waitForTransactionReceipt).toHaveBeenLastCalledWith(expect.objectContaining({ confirmations: 3 }));
    });
  });

  it("sends the quoted transaction, waits for it on the chain, and confirms it", async () => {
    const user = userEvent.setup();
    mockSendTransactionAsync.mockResolvedValue(HASH);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Swap" }));
    expect(mockSendTransactionAsync).toHaveBeenCalledWith({ chainId: 137, to: ALLOWANCE_HOLDER, data: "0xabcd", value: 0n });
    expect(await screen.findByText("Swap confirmed: about 2,150 TEL.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", `https://polygonscan.com/tx/${HASH}`);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ symbolOut: "TEL", href: `https://polygonscan.com/tx/${HASH}` }));
  });

  it("says so when the swap fails on chain", async () => {
    const user = userEvent.setup();
    mockSendTransactionAsync.mockResolvedValue(HASH);
    mockClient.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Swap" }));
    expect(await screen.findByText(/The swap failed on chain/)).toBeInTheDocument();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("refreshes a quote past its life instead of sending it", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "Swap" });
    const later = Date.now() + 31_000;
    jest.spyOn(Date, "now").mockReturnValue(later);
    await user.click(button);
    expect(await screen.findByText(/The quote was out of date, so it was refreshed/)).toBeInTheDocument();
    expect(mockSendTransactionAsync).not.toHaveBeenCalled();
  });

  it("asks a wallet on another network to switch first", async () => {
    const user = userEvent.setup();
    mockWallet.chainId = 1;
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Switch to Polygon" }));
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
  });

  it("opens on the wallet's chain when the link names none", async () => {
    mockParams.value = new URLSearchParams();
    mockWallet.chainId = 8453;
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Selected network")).toHaveTextContent("8453"));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it("keeps the chain the link names on arrival, then follows the wallet when it switches", async () => {
    mockWallet.chainId = 8453;
    const { rerender } = renderPage();
    await screen.findByText("2,150");
    expect(screen.getByLabelText("Selected network")).toHaveTextContent("137");
    mockWallet.chainId = 1;
    rerender(<SwapPage />);
    await waitFor(() => expect(screen.getByLabelText("Selected network")).toHaveTextContent(/^1$/));
  });

  it("asks the wallet to switch when a chain is picked on the page, and keeps the pick if the wallet declines", async () => {
    const user = userEvent.setup();
    mockSwitchChainAsync.mockRejectedValue(new Error("User rejected"));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Base network" }));
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 8453 });
    expect(screen.getByLabelText("Selected network")).toHaveTextContent("8453");
    expect(await screen.findByRole("button", { name: "Switch to Base" })).toBeInTheDocument();
  });

  it("does not offer a swap the wallet can't fund", async () => {
    mockClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === "balanceOf" ? 1_000_000n : undefined));
    renderPage();
    expect(await screen.findByRole("button", { name: "Not enough USDC" })).toBeDisabled();
  });

  it("points eUSD and USDC to the vault while it holds enough of the token bought", async () => {
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC, buy: EUSD, amount: "5" });
    mockClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "getReserves" ? [10_000_000n, 0n] : functionName === "balanceOf" ? 100_000_000n : undefined,
    );
    renderPage();
    expect(await screen.findByRole("link", { name: "eUSD vault" })).toHaveAttribute("href", "/eusd-vault");
  });

  it("does not point to the vault when it can't cover the amount", async () => {
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC, buy: EUSD, amount: "5" });
    mockFetch.mockImplementation(async () => json(quote({ buyAmount: "4990000", minBuyAmount: "4965000" })));
    renderPage();
    await screen.findByText("4.99");
    expect(screen.queryByRole("link", { name: "eUSD vault" })).not.toBeInTheDocument();
  });

  it("explains when swaps aren't configured, and when there's no route", async () => {
    mockFetch.mockImplementation(async () => json({ error: "Swaps aren't available yet." }, 503));
    const { unmount } = renderPage();
    expect(await screen.findByText("Swaps aren't available yet.")).toBeInTheDocument();
    unmount();
    mockFetch.mockImplementation(async () => json({ liquidityAvailable: false }));
    renderPage();
    expect(await screen.findByText(/no route for this swap/)).toBeInTheDocument();
  });

  it("shows each listed token's logo beside its picker and in the quote summary", async () => {
    renderPage();
    await screen.findByText("Minimum received");
    expect(screen.getAllByTestId("token-icon-USDC")[0]).toHaveAttribute("src", expect.stringContaining("usdc.png"));
    // The buy picker, the rate and the minimum received each show TEL's logo.
    expect(screen.getAllByTestId("token-icon-TEL")).toHaveLength(3);
  });

  it("shows a token added by address by its symbol alone", async () => {
    const CUSTOM = "0x00000000000000000000000000000000000000c0";
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC, buy: CUSTOM, amount: "5" });
    mockClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "symbol" ? "CSTM" : functionName === "decimals" ? 18 : functionName === "balanceOf" ? 100_000_000n : undefined,
    );
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("CSTM"));
    expect(screen.queryByTestId("token-icon-CSTM")).not.toBeInTheDocument();
    expect(screen.getByTestId("token-icon-USDC")).toBeInTheDocument();
  });

  describe("custom tokens", () => {
    const CUSTOM = "0x00000000000000000000000000000000000000c0";
    const OTHER = "0x00000000000000000000000000000000000000c1";
    const symbols: Record<string, string> = { [CUSTOM.toLowerCase()]: "CSTM", [OTHER.toLowerCase()]: "OTHR" };

    beforeEach(() => {
      mockClient.readContract.mockImplementation(async ({ functionName, address }: { functionName: string; address: string }) =>
        functionName === "symbol" ? symbols[address.toLowerCase()] : functionName === "decimals" ? 18 : functionName === "balanceOf" ? 100_000_000n : undefined,
      );
    });

    it("removes one, moving the picker that held it back to the default", async () => {
      const user = userEvent.setup();
      mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC, buy: CUSTOM, amount: "5" });
      renderPage();
      await waitFor(() => expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("CSTM"));
      await user.click(screen.getByRole("button", { name: "Remove CSTM" }));
      await waitFor(() => expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("TEL"));
      expect(screen.queryByRole("option", { name: "CSTM" })).not.toBeInTheDocument();
      expect(screen.getByText("Token removed from the lists.")).toBeInTheDocument();
    });

    it("clears them all, keeping the two pickers on different tokens", async () => {
      const user = userEvent.setup();
      mockParams.value = new URLSearchParams({ chain: "polygon", sell: CUSTOM, buy: OTHER, amount: "5" });
      renderPage();
      await waitFor(() => expect(screen.getByLabelText("Token to sell")).toHaveDisplayValue("CSTM"));
      await waitFor(() => expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("OTHR"));
      await user.click(screen.getByRole("button", { name: "Clear custom assets" }));
      await waitFor(() => expect(screen.getByLabelText("Token to sell")).toHaveDisplayValue("USDC"));
      expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("TEL");
      expect(screen.queryByRole("group", { name: "Custom tokens on Polygon" })).not.toBeInTheDocument();
      expect(screen.getByText("Custom tokens cleared.")).toBeInTheDocument();
    });

    it("offers no removal for listed tokens", async () => {
      renderPage();
      await screen.findByText("2,150");
      expect(screen.queryByRole("button", { name: "Clear custom assets" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    });
  });

  it("matches a prefilled token whatever the address's letter case", async () => {
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDC.toLowerCase(), buy: TEL.toUpperCase().replace("0X", "0x"), amount: "5" });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Token to sell")).toHaveDisplayValue("USDC"));
    expect(screen.getByLabelText("Token to buy")).toHaveDisplayValue("TEL");
  });

  it("lists USDC.e on Polygon for LPs from the old pools", async () => {
    mockParams.value = new URLSearchParams({ chain: "polygon", sell: USDCE, buy: USDC, amount: "5" });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Token to sell")).toHaveDisplayValue("USDC.e"));
  });
});

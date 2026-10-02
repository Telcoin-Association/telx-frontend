import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddTokenToWallet from "./AddTokenToWallet";
import { WATCHABLE_TOKENS, watchableTokenAt } from "../../lib/walletTokens";

const mockWatchAsset = jest.fn();
const mockReset = jest.fn();
const mockSwitchChainAsync = jest.fn();
const mockState: {
  account: { isConnected: boolean; chain?: { id: number; name: string } };
  watch: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown };
} = {
  account: { isConnected: true, chain: { id: 137, name: "Polygon" } },
  watch: { isPending: false, isSuccess: false, isError: false, error: null },
};

jest.mock("wagmi", () => ({
  useAccount: () => mockState.account,
  useWatchAsset: () => ({ watchAsset: mockWatchAsset, reset: mockReset, ...mockState.watch }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
}));

beforeEach(() => {
  mockWatchAsset.mockReset();
  mockReset.mockReset();
  mockSwitchChainAsync.mockReset();
  mockSwitchChainAsync.mockResolvedValue(undefined);
  mockState.account = { isConnected: true, chain: { id: 137, name: "Polygon" } };
  mockState.watch = { isPending: false, isSuccess: false, isError: false, error: null };
});

describe("AddTokenToWallet", () => {
  it("asks the wallet to track the token with its address, decimals and a PNG logo", async () => {
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.TEL} />);
    await userEvent.click(screen.getByRole("button", { name: "Add TEL to your wallet on Polygon" }));
    expect(mockWatchAsset).toHaveBeenCalledWith({
      type: "ERC20",
      options: {
        address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731",
        symbol: "TEL",
        decimals: 18,
        image: `${window.location.origin}/coins/tel.png`,
      },
    });
  });

  it("is hidden without a connected wallet", () => {
    mockState.account = { isConnected: false };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.eUSD} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says where it was added", () => {
    mockState.watch = { ...mockState.watch, isSuccess: true };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.eUSD} />);
    expect(screen.getByText("eUSD added on Polygon.")).toBeInTheDocument();
  });

  it("says nothing when the prompt is declined", () => {
    mockState.watch = { ...mockState.watch, isError: true, error: Object.assign(new Error("rejected"), { code: 4001 }) };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.TEL} />);
    expect(screen.queryByText(/can't add tokens/)).not.toBeInTheDocument();
  });

  it("points at the address when the wallet can't add tokens this way", () => {
    mockState.watch = { ...mockState.watch, isError: true, error: new Error("Method not supported") };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.TEL} />);
    expect(screen.getByText("Your wallet can't add tokens this way. Copy the address and add it manually.")).toBeInTheDocument();
  });

  it("clears an outcome when the wallet changes network", () => {
    const { rerender } = render(<AddTokenToWallet token={WATCHABLE_TOKENS.TEL} />);
    expect(mockReset).not.toHaveBeenCalled();
    mockState.account = { isConnected: true, chain: { id: 8453, name: "Base" } };
    rerender(<AddTokenToWallet token={WATCHABLE_TOKENS.TEL} />);
    expect(mockReset).toHaveBeenCalledTimes(1);
  });
});

describe("AddTokenToWallet for a token on one chain", () => {
  it("switches a wallet on another chain to Polygon first, then adds WETH", async () => {
    mockState.account = { isConnected: true, chain: { id: 8453, name: "Base" } };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.WETH_POLYGON} />);
    await userEvent.click(screen.getByRole("button", { name: "Add WETH to your wallet on Polygon" }));
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
    expect(mockWatchAsset).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ symbol: "WETH", decimals: 18 }) }));
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWatchAsset.mock.invocationCallOrder[0]);
  });

  it("adds eMXN without a switch when the wallet is already on Polygon", async () => {
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.EMXN_POLYGON} />);
    await userEvent.click(screen.getByRole("button", { name: "Add eMXN to your wallet on Polygon" }));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
    expect(mockWatchAsset).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ symbol: "eMXN", decimals: 6 }) }));
  });

  it("adds nothing and says why when the switch is declined", async () => {
    mockState.account = { isConnected: true, chain: { id: 1, name: "Ethereum" } };
    mockSwitchChainAsync.mockRejectedValue(Object.assign(new Error("rejected"), { code: 4001 }));
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.WETH_POLYGON} />);
    await userEvent.click(screen.getByRole("button", { name: "Add WETH to your wallet on Polygon" }));
    expect(await screen.findByText("Switch your wallet to Polygon to add WETH.")).toBeInTheDocument();
    expect(mockWatchAsset).not.toHaveBeenCalled();
  });

  it("never switches for a token valid on every chain", async () => {
    mockState.account = { isConnected: true, chain: { id: 8453, name: "Base" } };
    render(<AddTokenToWallet token={WATCHABLE_TOKENS.eUSD} />);
    await userEvent.click(screen.getByRole("button", { name: "Add eUSD to your wallet on Base" }));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
    expect(mockWatchAsset).toHaveBeenCalledTimes(1);
  });
});

describe("watchableTokenAt", () => {
  it("finds TEL3 and eUSD in any letter case, and nothing else", () => {
    expect(watchableTokenAt("0x7e13b43065380acdec1c2d138c579cbbbafa0731")?.symbol).toBe("TEL");
    expect(watchableTokenAt("0x14913815BCFDE78BAEAD2111F463D038AC9C2949")?.symbol).toBe("eUSD");
    expect(watchableTokenAt("0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32")).toBeNull(); // legacy TEL
    expect(watchableTokenAt(null)).toBeNull();
  });

  it("matches WETH and eMXN on Polygon only", () => {
    expect(watchableTokenAt("0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", "polygon")?.symbol).toBe("WETH");
    expect(watchableTokenAt("0x68727e573D21a49c767c3c86A92D9F24bd933c99", "polygon")?.symbol).toBe("eMXN");
    expect(watchableTokenAt("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "base")).toBeNull();
    expect(watchableTokenAt("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619")).toBeNull();
    expect(watchableTokenAt("0x14913815bCFDE78BAeAd2111F463D038Ac9C2949", "base")?.symbol).toBe("eUSD");
  });
});

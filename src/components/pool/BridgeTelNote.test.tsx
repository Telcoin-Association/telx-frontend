import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import BridgeTelNote from "./BridgeTelNote";

const mockAccount: { address: string | undefined } = { address: "0x00000000000000000000000000000000000000aa" };
const mockBalances: { value: Record<string, bigint> } = { value: {} };
const mockUseTokenBalances = jest.fn();
jest.mock("wagmi", () => ({ useAccount: () => mockAccount }));
jest.mock("../../hooks/useNow", () => ({ useNow: () => Date.UTC(2026, 9, 1, 12) }));
jest.mock("../../hooks/useTokenBalances", () => ({
  useTokenBalances: (...args: unknown[]) => {
    mockUseTokenBalances(...args);
    return { balances: args[0] ? mockBalances.value : {}, loading: false };
  },
}));

const basePool = { protocol: "uniswap", blockchain: "base", rewardsStatus: "LIVE" };

beforeEach(() => {
  mockAccount.address = "0x00000000000000000000000000000000000000aa";
  mockBalances.value = { base: 0n, polygon: 5n * 10n ** 18n, ethereum: 0n };
  mockUseTokenBalances.mockReset();
});

describe("BridgeTelNote", () => {
  it("points a wallet with TEL3 only on other chains to the official bridge", () => {
    render(<BridgeTelNote pool={basePool} />);
    expect(screen.getByText(/This pool is on Base, and your TEL3 is on Polygon\./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Bridge TEL3 to Base" });
    expect(link).toHaveAttribute("href", "https://tel3.telcoin.network/bridge");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("on tel3.telcoin.network")).toBeInTheDocument();
  });

  it("shows for a scheduled campaign too", () => {
    render(<BridgeTelNote pool={{ ...basePool, rewardsStatus: "SOON" }} />);
    expect(screen.getByRole("link", { name: "Bridge TEL3 to Base" })).toBeInTheDocument();
  });

  it("stays hidden when the wallet already holds TEL3 on the pool's chain, or nowhere else", () => {
    mockBalances.value = { base: 1n, polygon: 5n };
    const { unmount } = render(<BridgeTelNote pool={basePool} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();
    mockBalances.value = { base: 0n, polygon: 0n, ethereum: 0n };
    render(<BridgeTelNote pool={basePool} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stays hidden when the pool-chain balance couldn't be read", () => {
    mockBalances.value = { polygon: 5n }; // the Base read failed
    render(<BridgeTelNote pool={basePool} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reads nothing and shows nothing without a campaign, for a legacy pool, or without a wallet", () => {
    render(<BridgeTelNote pool={{ ...basePool, rewardsStatus: "PAST" }} />);
    render(<BridgeTelNote pool={{ protocol: "balancer", blockchain: "polygon" }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(mockUseTokenBalances.mock.calls.every(([owner]) => owner === undefined)).toBe(true);
    mockAccount.address = undefined;
    render(<BridgeTelNote pool={basePool} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

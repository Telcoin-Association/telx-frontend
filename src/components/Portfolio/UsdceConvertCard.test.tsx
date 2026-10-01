import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import UsdceConvertCard, { usdceSwapHref } from "./UsdceConvertCard";

const USDCE = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const mockBalances: { value: Record<string, bigint>; tokens?: Record<string, string> } = { value: {} };
jest.mock("wagmi", () => ({ useAccount: () => ({ address: "0x00000000000000000000000000000000000000aa" }) }));
jest.mock("../../hooks/useTokenBalances", () => ({
  useTokenBalances: (_owner: string, tokens: Record<string, string>) => {
    mockBalances.tokens = tokens;
    return { balances: mockBalances.value, loading: false };
  },
}));

beforeEach(() => {
  mockBalances.value = {};
});

describe("UsdceConvertCard", () => {
  it("reads USDC.e on Polygon only", () => {
    render(<UsdceConvertCard />);
    expect(mockBalances.tokens).toEqual({ polygon: USDCE });
  });

  it("links a USDC.e holder to /swap, prefilled to convert all of it to native USDC", () => {
    mockBalances.value = { polygon: 1_234_567_891n }; // 1,234.567891 USDC.e
    render(<UsdceConvertCard />);
    const href = `/swap?chain=polygon&sell=${USDCE}&buy=${USDC}&amount=1234.567891`;
    expect(screen.getByText(/You hold 1,234.57 USDC.e on Polygon/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Convert 1,234.57 USDC.e to USDC" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "Convert to USDC for eUSD" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "eUSD vault" })).toHaveAttribute("href", "/eusd-vault");
  });

  it("stays hidden for dust, an empty wallet or an unread balance", () => {
    for (const balances of [{ polygon: 9_999n }, { polygon: 0n }, {}] as Record<string, bigint>[]) {
      mockBalances.value = balances;
      const { container, unmount } = render(<UsdceConvertCard />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("builds the swap link from a whole-token amount", () => {
    expect(usdceSwapHref("5")).toBe(`/swap?chain=polygon&sell=${USDCE}&buy=${USDC}&amount=5`);
  });
});

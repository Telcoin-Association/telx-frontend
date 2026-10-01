import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import LegacyTelUpgradeCard from "./LegacyTelUpgradeCard";

const mockAccount: { address: string | undefined } = { address: "0x00000000000000000000000000000000000000aa" };
const mockBalances: { value: Record<string, bigint> } = { value: {} };
jest.mock("wagmi", () => ({ useAccount: () => mockAccount }));
jest.mock("../../hooks/useTokenBalances", () => ({ useTokenBalances: () => ({ balances: mockBalances.value, loading: false }) }));

beforeEach(() => {
  mockAccount.address = "0x00000000000000000000000000000000000000aa";
  mockBalances.value = {};
});

describe("LegacyTelUpgradeCard", () => {
  it("tells a wallet holding legacy TEL to upgrade it, linking to the official upgrade page", () => {
    mockBalances.value = { polygon: 150_000n, base: 25_050n }; // 1,500 and 250.50 legacy TEL at 2 decimals
    render(<LegacyTelUpgradeCard legacyClaimableTel={null} />);
    expect(screen.getByText("You hold 1,750.5 legacy TEL. Upgrade it to TEL3 on the official upgrade site.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Upgrade on tel3.telcoin.network" });
    expect(link).toHaveAttribute("href", "https://tel3.telcoin.network/upgrade");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("points a wallet with legacy TEL only to claim at the upgrade site, for after claiming", () => {
    render(<LegacyTelUpgradeCard legacyClaimableTel={12} />);
    expect(screen.getByText("You have 12 legacy TEL to claim from old pools. Once claimed, upgrade it to TEL3 on the official upgrade site.")).toBeInTheDocument();
  });

  it("mentions legacy TEL still to claim when the wallet also holds some", () => {
    mockBalances.value = { ethereum: 1_000n };
    render(<LegacyTelUpgradeCard legacyClaimableTel={12} />);
    expect(screen.getByText(/You hold 10 legacy TEL/)).toBeInTheDocument();
    expect(screen.getByText(/The 12 legacy TEL still to claim/)).toBeInTheDocument();
  });

  it("is hidden when the wallet holds none and has none to claim, or when its reads failed", () => {
    mockBalances.value = { polygon: 0n };
    const { unmount } = render(<LegacyTelUpgradeCard legacyClaimableTel={null} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();
    mockBalances.value = {}; // every chain's read failed
    render(<LegacyTelUpgradeCard legacyClaimableTel={0} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

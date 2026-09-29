import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import PoolVolume from "./PoolVolume";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);

function renderVolume(fields: Record<string, unknown>) {
  const contractData = { protocol: "uniswap", dailyVolumeUSD: null, ...fields } as unknown as ProtocolsContractData;
  return render(<PoolVolume contractData={contractData} />);
}


// The tooltip trigger whose visible text starts with `text`: the element that carries aria-describedby.
const describedTrigger = (text: string) =>
  screen.getByText((_, el) => !!el?.hasAttribute("aria-describedby") && !!el.textContent?.startsWith(text));

describe("PoolVolume", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("renders zero as an amount with the no-swaps note as its hover text", () => {
    renderVolume({ dailyVolumeUSD: 0 });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("No swaps in the last 24h");
    expect(describedTrigger("$0.00")).toHaveAccessibleDescription("No swaps in the last 24h");
    // The note is a tooltip on the amount, not a second visible line.
    expect(screen.getByText("No swaps in the last 24h")).toHaveClass("opacity-0");
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("names the last swap date when zero volume has one", () => {
    const lastSwapAt = Date.UTC(2026, 8, 20, 12) / 1000;
    renderVolume({ dailyVolumeUSD: 0, lastSwapAt });
    const expected = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(lastSwapAt * 1000));
    expect(screen.getByRole("tooltip")).toHaveTextContent(`No swaps since ${expected}`);
    expect(describedTrigger("$0.00")).toHaveAccessibleDescription(`No swaps since ${expected}`);
  });

  it("adds the year when the last swap was in an earlier year", () => {
    renderVolume({ dailyVolumeUSD: 0, lastSwapAt: Date.UTC(2025, 2, 3, 12) / 1000 });
    expect(screen.getByText(/^No swaps since /)).toHaveTextContent(/2025/);
  });

  it("renders null and undefined as Unavailable", () => {
    const { unmount } = renderVolume({ dailyVolumeUSD: null });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    unmount();
    renderVolume({ dailyVolumeUSD: undefined });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No swaps/)).not.toBeInTheDocument();
  });

  it("formats a positive amount without a note", () => {
    renderVolume({ dailyVolumeUSD: 1234.5, lastSwapAt: NOW / 1000 });
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.queryByText(/No swaps/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders No historical data for DFX pools", () => {
    renderVolume({ protocol: "dfx", dailyVolumeUSD: null });
    expect(screen.getByText("No historical data")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { VaultTokenPanel } from "./VaultTokenPanel";

const iconSource = (alt: string) => decodeURIComponent(screen.getByRole("img", { name: alt }).getAttribute("src") ?? "");

describe("VaultTokenPanel", () => {
  it("shows the label, symbol, balance and amount area", () => {
    render(
      <VaultTokenPanel label="From" symbol="USDC" balanceLabel="1,234.5">
        <span>amount area</span>
      </VaultTokenPanel>,
    );
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("Balance: 1,234.5")).toBeInTheDocument();
    expect(screen.getByText("amount area")).toBeInTheDocument();
  });

  it("shows a dash without a balance", () => {
    render(<VaultTokenPanel label="To" symbol="eUSD" />);
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(screen.getByText("Balance: —")).toBeInTheDocument();
  });

  it("shows a zero balance as zero, not as a dash", () => {
    render(<VaultTokenPanel label="To" symbol="eUSD" balanceLabel="0" />);
    expect(screen.getByText("Balance: 0")).toBeInTheDocument();
  });

  it("uses the USDC icon for USDC", () => {
    render(<VaultTokenPanel label="From" symbol="USDC" />);
    const img = screen.getByRole("img", { name: "USDC" });
    expect(img).toHaveAttribute("width", "32");
    expect(img).toHaveAttribute("height", "32");
    expect(iconSource("USDC")).toContain("/coins/usdc.png");
  });

  it("uses the eUSD icon for eUSD", () => {
    render(<VaultTokenPanel label="To" symbol="eUSD" />);
    expect(iconSource("eUSD")).toContain("/coins/eUSD.png");
  });
});

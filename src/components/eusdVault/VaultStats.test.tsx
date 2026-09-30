import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { VaultStats } from "./VaultStats";

const VAULT = "0xc72178D412256a6Dc5f04D749859b4cd95076d61";

describe("VaultStats", () => {
  it("shows the fee and the vault liquidity in the output token", () => {
    render(<VaultStats feeLabel="0 eUSD" liquidityLabel="1,250,000" symbolOut="eUSD" />);
    expect(screen.getByText("Fee")).toBeInTheDocument();
    expect(screen.getByText("0 eUSD")).toBeInTheDocument();
    expect(screen.getByText("Vault liquidity")).toBeInTheDocument();
    expect(screen.getByText("1,250,000 eUSD")).toBeInTheDocument();
  });

  it("uses the output symbol it is given", () => {
    render(<VaultStats feeLabel="0.5 USDC" liquidityLabel="42" symbolOut="USDC" />);
    expect(screen.getByText("42 USDC")).toBeInTheDocument();
  });

  it("shows dashes while the fee and liquidity are unknown", () => {
    render(<VaultStats symbolOut="USDC" />);
    const [fee, liquidity] = screen.getAllByRole("definition");
    expect(fee).toHaveTextContent(/^—$/);
    expect(liquidity).toHaveTextContent(/^—$/);
    expect(screen.queryByText(/USDC/)).not.toBeInTheDocument();
  });

  it("shows a zero liquidity as zero, not as a dash", () => {
    render(<VaultStats liquidityLabel="0" symbolOut="USDC" />);
    expect(screen.getByText("0 USDC")).toBeInTheDocument();
  });

  it("shows the full approval spender in monospace when given", () => {
    render(<VaultStats feeLabel="0 eUSD" liquidityLabel="1" symbolOut="eUSD" spender={VAULT} />);
    expect(screen.getByText(/^Approval spender:/)).toHaveTextContent(`Approval spender: ${VAULT}`);
    expect(screen.getByText(VAULT)).toHaveClass("font-mono");
  });

  it("colours the spender address itself and keeps it out of a <p>, where the global p span rule turns it link blue", () => {
    render(<VaultStats feeLabel="0 eUSD" liquidityLabel="1" symbolOut="eUSD" spender={VAULT} />);
    expect(screen.getByText(VAULT)).toHaveClass("text-white/90");
    expect(screen.getByText(/^Approval spender:/).tagName).toBe("DIV");
  });

  it("leaves out the approval spender without one", () => {
    render(<VaultStats feeLabel="0 eUSD" liquidityLabel="1" symbolOut="eUSD" />);
    expect(screen.queryByText(/Approval spender/)).not.toBeInTheDocument();
  });
});

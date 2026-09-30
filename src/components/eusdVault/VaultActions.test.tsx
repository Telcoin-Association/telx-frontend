import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VaultView } from "@/web3/eusdVault/types";
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";
import { VaultActions } from "./VaultActions";

jest.mock("../layout/CustomConnectButton", () => ({
  CustomConnectButton: () => (
    <button type="button" data-testid="connect-button">
      Connect
    </button>
  ),
}));

const handlers = () => ({
  onApprove: jest.fn(),
  onSwap: jest.fn(),
  onSwitchNetwork: jest.fn(),
  onDismiss: jest.fn(),
  onRefresh: jest.fn(),
  onDone: jest.fn(),
});

type Handlers = ReturnType<typeof handlers>;

const APPROVE: VaultView = {
  primary: { kind: "approve", label: "Step 1: Approve USDC", disabled: false, action: "approve" },
  showStepOneComplete: false,
  secondary: [],
  lockForm: false,
};

function setup(view: VaultView) {
  const h = handlers();
  render(<VaultActions view={view} {...h} />);
  return h;
}

function expectOnlyCalled(h: Handlers, name: keyof Handlers) {
  for (const [key, fn] of Object.entries(h)) {
    expect(fn).toHaveBeenCalledTimes(key === name ? 1 : 0);
  }
}

describe("VaultActions", () => {
  it("renders the connect button in place of the step buttons when no wallet is connected", () => {
    setup({
      ...APPROVE,
      primary: { kind: "connect", label: "Connect Wallet", disabled: false, action: "connect" },
    });
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument();
    expect(screen.queryByText("Step 1 complete")).not.toBeInTheDocument();
  });

  it.each([
    ["approve", "Step 1: Approve USDC", "onApprove"],
    ["swap", "Step 2: Swap USDC for eUSD", "onSwap"],
    ["switch-network", "Switch to supported network", "onSwitchNetwork"],
  ] as const)("calls only the %s handler from the primary button", async (action, label, handler) => {
    const h = setup({ ...APPROVE, primary: { kind: action, label, disabled: false, action } });
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expectOnlyCalled(h, handler);
  });

  it("calls no handler from a primary button without an action", async () => {
    const h = setup({ ...APPROVE, primary: { kind: "enter-amount", label: "Enter an amount", disabled: false } });
    await userEvent.click(screen.getByRole("button", { name: "Enter an amount" }));
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it("never calls a handler from a disabled primary, even on a double click", async () => {
    const h = setup({ ...APPROVE, primary: { kind: "approve", label: "Step 1: Approve USDC", disabled: true, action: "approve" } });
    const button = screen.getByRole("button", { name: "Step 1: Approve USDC" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("cursor-not-allowed");
    await userEvent.click(button);
    await userEvent.dblClick(button);
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it("shows a busy primary's label on a disabled button", () => {
    setup({ ...APPROVE, primary: { kind: "busy", label: "Swapping...", disabled: true } });
    expect(screen.getByRole("button", { name: "Swapping..." })).toBeDisabled();
  });

  it("shows the Step 1 complete indicator above the swap button when asked", () => {
    setup({
      ...APPROVE,
      primary: { kind: "swap", label: "Step 2: Swap USDC for eUSD", disabled: false, action: "swap" },
      showStepOneComplete: true,
    });
    expect(screen.getByText("Step 1 complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Step 2: Swap USDC for eUSD" })).toBeEnabled();
  });

  it("hides the Step 1 complete indicator otherwise", () => {
    setup(APPROVE);
    expect(screen.queryByText("Step 1 complete")).not.toBeInTheDocument();
  });

  it("renders the success card in place of the step buttons, without fee, quote or link lines when they are absent", () => {
    setup({
      ...APPROVE,
      primary: { kind: "success", label: "Swap complete", disabled: true },
      success: { amountOutLabel: "99.95", symbolOut: "eUSD", chainName: "Polygon" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("You received 99.95 eUSD on Polygon.");
    expect(screen.queryByText(/Vault fee/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quoted amount/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("adds the fee, the quoted amount and the transaction link to the success card when they are set", () => {
    setup({
      ...APPROVE,
      primary: { kind: "success", label: "Swap complete", disabled: true },
      success: {
        amountOutLabel: "99.9",
        symbolOut: "USDC",
        feeLabel: "0.1",
        quotedOutLabel: "99.95",
        chainName: "Base",
        href: "https://basescan.org/tx/0xabc",
      },
    });
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("You received 99.9 USDC on Base.");
    expect(card).toHaveTextContent("Vault fee: 0.1 USDC");
    expect(card).toHaveTextContent("Quoted amount: 99.95 USDC");
    const link = screen.getByRole("link", { name: "View transaction" });
    expect(link).toHaveAttribute("href", "https://basescan.org/tx/0xabc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([
    ["dismiss", "Dismiss", "onDismiss"],
    ["refresh", "Refresh", "onRefresh"],
    ["done", "Done", "onDone"],
  ] as const)("renders a %s secondary button that calls only its handler", async (kind, label, handler) => {
    const h = setup({ ...APPROVE, primary: { ...APPROVE.primary, disabled: true }, secondary: [{ kind, label }] });
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expectOnlyCalled(h, handler);
  });

  it("shows the keyboard focus outline on the primary and the secondary buttons", () => {
    setup({ ...APPROVE, secondary: [{ kind: "dismiss", label: "Dismiss" }] });
    for (const name of ["Step 1: Approve USDC", "Dismiss"]) {
      expect(screen.getByRole("button", { name })).toHaveClass(...FOCUS_OUTLINE_CLASS.split(" "));
    }
  });

  it("renders an explorer secondary as a link in a new tab", () => {
    setup({
      ...APPROVE,
      secondary: [{ kind: "explorer", label: "View on explorer", href: "https://etherscan.io/tx/0xdef" }],
    });
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", "https://etherscan.io/tx/0xdef");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("skips an explorer secondary without an href", () => {
    setup({ ...APPROVE, secondary: [{ kind: "explorer", label: "View on explorer" }, { kind: "dismiss", label: "Dismiss" }] });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("View on explorer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("renders the notice when the view has one", () => {
    setup({ ...APPROVE, notice: { tone: "error", message: "The transaction could not be completed." } });
    expect(screen.getByRole("alert")).toHaveTextContent("The transaction could not be completed.");
  });

  it("renders no notice when the view has none", () => {
    setup(APPROVE);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

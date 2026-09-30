import React, { useState } from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VAULT_CHAIN_IDS, VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import type { SwapDirection, VaultView } from "@/web3/eusdVault/types";
import { VaultSwapCard, type VaultSwapCardProps } from "./VaultSwapCard";

jest.mock("../layout/CustomConnectButton", () => ({
  CustomConnectButton: () => (
    <button type="button" data-testid="connect-button">
      Connect
    </button>
  ),
}));

const SPENDER = VAULT_DEPLOYMENTS[137].vault;

const APPROVE: VaultView = {
  primary: { kind: "approve", label: "Step 1: Approve USDC", disabled: false, action: "approve" },
  showStepOneComplete: false,
  secondary: [],
  lockForm: false,
};

const SWAP: VaultView = {
  ...APPROVE,
  primary: { kind: "swap", label: "Step 2: Swap USDC for eUSD", disabled: false, action: "swap" },
  showStepOneComplete: true,
};

const LOCKED: VaultView = {
  ...APPROVE,
  primary: { kind: "busy", label: "Swapping...", disabled: true },
  lockForm: true,
};

const callbacks = () => ({
  onSelectChain: jest.fn(),
  onDirectionChange: jest.fn(),
  onAmountChange: jest.fn(),
  onMax: jest.fn(),
  onApprove: jest.fn(),
  onSwap: jest.fn(),
  onSwitchNetwork: jest.fn(),
  onDismiss: jest.fn(),
  onRefresh: jest.fn(),
  onDone: jest.fn(),
});

type Callbacks = ReturnType<typeof callbacks>;

function baseProps(cb: Callbacks): VaultSwapCardProps {
  return {
    chainIds: VAULT_CHAIN_IDS,
    selectedChainId: 137,
    direction: "usdcToEusd",
    amountText: "",
    spender: SPENDER,
    view: APPROVE,
    ...cb,
  };
}

function setup(overrides: Partial<VaultSwapCardProps> = {}) {
  const cb = callbacks();
  const utils = render(<VaultSwapCard {...baseProps(cb)} {...overrides} />);
  return { cb, ...utils };
}

/** Behaves like the page: owns the direction and amount text, and clears the amount when the direction changes. */
function PageHarness({ cb }: Readonly<{ cb: Callbacks }>) {
  const [direction, setDirection] = useState<SwapDirection>("usdcToEusd");
  const [amountText, setAmountText] = useState("");
  return (
    <VaultSwapCard
      {...baseProps(cb)}
      direction={direction}
      amountText={amountText}
      onAmountChange={(text) => {
        cb.onAmountChange(text);
        setAmountText(text);
      }}
      onDirectionChange={(next) => {
        cb.onDirectionChange(next);
        setDirection(next);
        setAmountText("");
      }}
    />
  );
}

const amountInput = () => screen.getByRole("textbox", { name: /to swap$/ });
const quoteOutput = () => screen.getByRole("textbox", { name: /to receive$/ });
const maxButton = () => screen.getByRole("button", { name: "MAX" });
const toggle = () => screen.getByRole("button", { name: /^Reverse direction/ });
const networkButtons = () => within(screen.getByRole("group", { name: "Network" })).getAllByRole("button");
const panelLabel = (label: "From" | "To") => screen.getByText(label, { selector: "p" });
const iconSource = (img: HTMLElement) => decodeURIComponent(img.getAttribute("src") ?? "");

/** The panels have no landmark, so placement is checked by document order. */
function expectInOrder(...elements: HTMLElement[]) {
  for (let i = 1; i < elements.length; i++) {
    expect(elements[i - 1].compareDocumentPosition(elements[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

function expectNoCalls(cb: Callbacks) {
  for (const fn of Object.values(cb)) expect(fn).not.toHaveBeenCalled();
}

function expectOnlyCalled(cb: Callbacks, name: keyof Callbacks) {
  for (const [key, fn] of Object.entries(cb)) expect(fn).toHaveBeenCalledTimes(key === name ? 1 : 0);
}

describe("VaultSwapCard", () => {
  it("lays out the network row, From panel, toggle, To panel, stats and actions in order", () => {
    setup({ view: { ...APPROVE, notice: { tone: "info", message: "A notice." } } });
    expectInOrder(
      screen.getByText("Network:"),
      screen.getByRole("button", { name: "Polygon" }),
      panelLabel("From"),
      screen.getByText("USDC"),
      screen.getByRole("textbox", { name: "Amount of USDC to swap" }),
      maxButton(),
      toggle(),
      panelLabel("To"),
      screen.getByText("eUSD"),
      screen.getByRole("textbox", { name: "Amount of eUSD to receive" }),
      screen.getByText("Fee"),
      screen.getByText("Vault liquidity"),
      screen.getByText("Approval spender:"),
      screen.getByRole("status"),
      screen.getByRole("button", { name: "Step 1: Approve USDC" }),
    );
  });

  it("marks the selected chain and calls onSelectChain with another one", async () => {
    const user = userEvent.setup();
    const { cb } = setup();
    expect(screen.getByRole("button", { name: "Polygon" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Base" }));
    expectOnlyCalled(cb, "onSelectChain");
    expect(cb.onSelectChain).toHaveBeenCalledWith(8453);
  });

  it("shows the page's amount text", () => {
    setup({ amountText: "42.5" });
    expect(amountInput()).toHaveValue("42.5");
  });

  it("calls onAmountChange with sanitised text while typing", async () => {
    const user = userEvent.setup();
    const cb = callbacks();
    render(<PageHarness cb={cb} />);
    await user.type(amountInput(), "1,234.5a");
    expect(cb.onAmountChange).toHaveBeenLastCalledWith("1.234.5");
    for (const [text] of cb.onAmountChange.mock.calls) expect(text).toMatch(/^[0-9.]*$/);
    expect(amountInput()).toHaveValue("1.234.5");
  });

  it("sanitises pasted text before handing it to the page", async () => {
    const user = userEvent.setup();
    const { cb } = setup();
    await user.click(amountInput());
    await user.paste("1,000.25 USDC");
    expectOnlyCalled(cb, "onAmountChange");
    expect(cb.onAmountChange).toHaveBeenCalledWith("1,000.25");
  });

  it("marks an invalid amount", () => {
    setup({ amountText: "1.1234567", amountInvalid: true });
    expect(amountInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("calls onMax from the MAX button", async () => {
    const user = userEvent.setup();
    const { cb } = setup();
    await user.click(maxButton());
    expectOnlyCalled(cb, "onMax");
  });

  it("disables only MAX when maxDisabled", async () => {
    const user = userEvent.setup();
    const { cb } = setup({ maxDisabled: true });
    expect(maxButton()).toBeDisabled();
    expect(amountInput()).toBeEnabled();
    expect(toggle()).toBeEnabled();
    await user.click(maxButton());
    expectNoCalls(cb);
  });

  it.each([
    ["usdcToEusd", "eusdToUsdc"],
    ["eusdToUsdc", "usdcToEusd"],
  ] as const)("calls onDirectionChange from %s with %s", async (from, to) => {
    const user = userEvent.setup();
    const { cb } = setup({ direction: from });
    await user.click(toggle());
    expectOnlyCalled(cb, "onDirectionChange");
    expect(cb.onDirectionChange).toHaveBeenCalledWith(to);
  });

  it("ends with an empty amount when the page resets it on a direction change", async () => {
    const user = userEvent.setup();
    const cb = callbacks();
    render(<PageHarness cb={cb} />);
    await user.type(amountInput(), "12.5");
    expect(amountInput()).toHaveValue("12.5");
    await user.click(toggle());
    expect(cb.onDirectionChange).toHaveBeenCalledWith("eusdToUsdc");
    expect(screen.getByRole("textbox", { name: "Amount of eUSD to swap" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Amount of USDC to receive" })).toBeInTheDocument();
  });

  it.each([
    ["usdcToEusd", "USDC", "eUSD", "/coins/usdc.png", "/coins/eUSD.png"],
    ["eusdToUsdc", "eUSD", "USDC", "/coins/eUSD.png", "/coins/usdc.png"],
  ] as const)("shows %s as From %s and To %s with their icons", (direction, symbolIn, symbolOut, iconIn, iconOut) => {
    setup({ direction, liquidityLabel: "500" });
    expectInOrder(panelLabel("From"), screen.getByText(symbolIn), panelLabel("To"), screen.getByText(symbolOut));
    // The chain logos are hidden from the accessibility tree, so these are the two token icons in order.
    const icons = screen.getAllByRole("img");
    expect(icons).toHaveLength(2);
    expect(icons[0]).toHaveAccessibleName(symbolIn);
    expect(iconSource(icons[0])).toContain(iconIn);
    expect(icons[1]).toHaveAccessibleName(symbolOut);
    expect(iconSource(icons[1])).toContain(iconOut);
    expect(amountInput()).toHaveAccessibleName(`Amount of ${symbolIn} to swap`);
    expect(quoteOutput()).toHaveAccessibleName(`Amount of ${symbolOut} to receive`);
    expect(screen.getByText(`500 ${symbolOut}`)).toBeInTheDocument();
  });

  it("shows a dash for balances that are not known", () => {
    setup();
    expect(screen.getAllByText("Balance: —")).toHaveLength(2);
  });

  it("shows each balance in its own panel", () => {
    setup({ balanceInLabel: "1,000", balanceOutLabel: "0" });
    expect(screen.queryByText("Balance: —")).not.toBeInTheDocument();
    expectInOrder(panelLabel("From"), screen.getByText("Balance: 1,000"), panelLabel("To"), screen.getByText("Balance: 0"));
  });

  it("shows the quoted output as read-only text", () => {
    setup({ amountOutLabel: "99.95", feeLabel: "0.05 eUSD" });
    expect(quoteOutput()).toHaveValue("99.95");
    expect(quoteOutput()).toHaveAttribute("readonly");
    expect(screen.getByText("0.05 eUSD")).toBeInTheDocument();
  });

  it("sizes the quoted output down below sm and ends a long one with an ellipsis", () => {
    setup({ amountOutLabel: "123,456.123456" });
    expect(quoteOutput()).toHaveClass("min-w-0", "text-2xl", "sm:text-3xl", "text-ellipsis");
    expect(quoteOutput()).not.toHaveClass("text-3xl");
  });

  it("shows a placeholder until there is a quote", () => {
    setup();
    expect(quoteOutput()).toHaveValue("");
    expect(quoteOutput()).toHaveAttribute("placeholder", "0.0");
    // Fee and vault liquidity.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("disables the selector, toggle, input and MAX while the form is locked and fires no callbacks", async () => {
    const user = userEvent.setup();
    const { cb } = setup({ view: LOCKED, amountText: "10" });
    for (const button of networkButtons()) expect(button).toBeDisabled();
    expect(toggle()).toBeDisabled();
    expect(amountInput()).toBeDisabled();
    expect(maxButton()).toBeDisabled();
    for (const button of networkButtons()) await user.click(button);
    await user.click(toggle());
    await user.type(amountInput(), "5");
    await user.click(maxButton());
    await user.click(screen.getByRole("button", { name: "Swapping..." }));
    expectNoCalls(cb);
    expect(amountInput()).toHaveValue("10");
  });

  it("disables only the network selector when networkDisabled", () => {
    setup({ networkDisabled: true });
    for (const button of networkButtons()) expect(button).toBeDisabled();
    expect(toggle()).toBeEnabled();
    expect(amountInput()).toBeEnabled();
    expect(maxButton()).toBeEnabled();
  });

  it("shows the override's direction and amount instead of the page's", async () => {
    const user = userEvent.setup();
    const { cb } = setup({
      direction: "usdcToEusd",
      amountText: "5",
      amountInvalid: true,
      view: { ...LOCKED, formOverride: { direction: "eusdToUsdc", amountIn: 1_234_500_000n } },
    });
    expect(screen.getByRole("textbox", { name: "Amount of eUSD to swap" })).toHaveValue("1,234.5");
    expect(amountInput()).not.toHaveAttribute("aria-invalid");
    expect(quoteOutput()).toHaveAccessibleName("Amount of USDC to receive");
    expectInOrder(panelLabel("From"), screen.getByText("eUSD"), panelLabel("To"), screen.getByText("USDC"));
    expect(toggle()).toHaveAccessibleName("Reverse direction, now eUSD to USDC");
    await user.click(toggle());
    await user.type(amountInput(), "1");
    expectNoCalls(cb);
  });

  it("locks the form whenever an override is shown", () => {
    setup({ view: { ...APPROVE, formOverride: { direction: "usdcToEusd", amountIn: 1_000_000n } } });
    expect(amountInput()).toHaveValue("1");
    expect(amountInput()).toBeDisabled();
    expect(maxButton()).toBeDisabled();
    expect(toggle()).toBeDisabled();
    for (const button of networkButtons()) expect(button).toBeDisabled();
  });

  it.each([
    ["onApprove", APPROVE, "Step 1: Approve USDC"],
    ["onSwap", SWAP, "Step 2: Swap USDC for eUSD"],
  ] as const)("calls only %s, once, from the primary button", async (handler, view, label) => {
    const user = userEvent.setup();
    const { cb } = setup({ view });
    await user.click(screen.getByRole("button", { name: label }));
    expectOnlyCalled(cb, handler);
  });

  it("shows the Step 1 complete indicator with the swap step", () => {
    setup({ view: SWAP });
    expect(screen.getByText("Step 1 complete")).toBeInTheDocument();
  });

  it("calls nothing from a disabled primary", async () => {
    const user = userEvent.setup();
    const { cb } = setup({ view: { ...APPROVE, primary: { ...APPROVE.primary, disabled: true } } });
    const button = screen.getByRole("button", { name: "Step 1: Approve USDC" });
    expect(button).toBeDisabled();
    await user.click(button);
    await user.dblClick(button);
    expectNoCalls(cb);
  });

  it.each([
    ["error", "alert"],
    ["warning", "status"],
    ["info", "status"],
    ["success", "status"],
  ] as const)("renders the %s notice with the %s role", (tone, role) => {
    const message = `A ${tone} notice.`;
    setup({ view: { ...APPROVE, notice: { tone, message } } });
    expect(screen.getByRole(role)).toHaveTextContent(message);
  });

  it("renders no notice without one", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("hides the step buttons behind the success card", async () => {
    const user = userEvent.setup();
    const { cb } = setup({
      view: {
        primary: { kind: "success", label: "Swap complete", disabled: true },
        showStepOneComplete: true,
        success: { amountOutLabel: "99.95", symbolOut: "eUSD", chainName: "Polygon" },
        secondary: [{ kind: "done", label: "Done" }],
        lockForm: true,
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("You received 99.95 eUSD on Polygon.");
    expect(screen.queryByRole("button", { name: "Swap complete" })).not.toBeInTheDocument();
    expect(screen.queryByText("Step 1 complete")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expectOnlyCalled(cb, "onDone");
  });

  it("renders the connect button when no wallet is connected", () => {
    setup({ view: { ...APPROVE, primary: { kind: "connect", label: "Connect Wallet", disabled: false, action: "connect" } } });
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Balance: —")).toHaveLength(2);
  });

  it("shows the approval spender address in full", () => {
    setup();
    expect(SPENDER).toHaveLength(42);
    expect(screen.getByText(SPENDER)).toBeInTheDocument();
    expect(screen.getByText("Approval spender:")).toHaveTextContent(`Approval spender: ${SPENDER}`);
  });
});

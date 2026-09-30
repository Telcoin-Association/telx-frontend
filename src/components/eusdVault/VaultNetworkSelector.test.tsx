import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VAULT_CHAIN_IDS } from "@/web3/eusdVault/deployments";
import { VaultNetworkSelector } from "./VaultNetworkSelector";

describe("VaultNetworkSelector", () => {
  it("shows a button with a logo and name for each chain in display order", () => {
    render(<VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={1} onSelect={jest.fn()} />);
    expect(screen.getByText("Network:")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Ethereum", "Polygon", "Base"]);
    for (const button of buttons) expect(button).toHaveAttribute("type", "button");
    // The logos are decorative: hidden from the accessibility tree so each button's name is just the chain.
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getAllByRole("img", { hidden: true }).map((img) => img.getAttribute("alt"))).toEqual([
      "ethereum",
      "polygon",
      "base",
    ]);
  });

  it("marks only the selected chain as pressed", () => {
    render(<VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={137} onSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Polygon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Ethereum" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Base" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSelect with the chain id of another chain", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={1} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Base" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(8453);
    await user.click(screen.getByRole("button", { name: "Polygon" }));
    expect(onSelect).toHaveBeenLastCalledWith(137);
  });

  it("ignores a click on the selected chain", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={8453} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Base" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables every chain and blocks onSelect while disabled", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={1} onSelect={onSelect} disabled />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Polygon" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders only the chains it is given", () => {
    render(<VaultNetworkSelector chainIds={[137]} selectedChainId={137} onSelect={jest.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Polygon"]);
  });
});

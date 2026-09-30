import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";
import { VaultAddressesCard } from "./VaultAddressesCard";

const CHAINS = [
  { chainId: 1, chainName: "Ethereum", explorer: "https://etherscan.io" },
  { chainId: 137, chainName: "Polygon", explorer: "https://polygonscan.com" },
  { chainId: 8453, chainName: "Base", explorer: "https://basescan.org" },
] as const;

describe("VaultAddressesCard", () => {
  it.each(CHAINS)("lists the vault, eUSD and USDC on $chainName with links to its explorer", ({ chainId, chainName, explorer }) => {
    const deployment = VAULT_DEPLOYMENTS[chainId];
    render(<VaultAddressesCard deployment={deployment} />);

    expect(screen.getByRole("heading", { name: "Official Contract Addresses" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const expected = [
      { title: "Vault contract", address: deployment.vault, link: "View the vault contract on the explorer" },
      { title: "eUSD", address: deployment.stable, link: "View the eUSD token contract on the explorer" },
      { title: "USDC", address: deployment.gem, link: "View the USDC token contract on the explorer" },
    ];
    expected.forEach((item, i) => {
      const row = within(rows[i]);
      expect(row.getByText(item.title)).toBeInTheDocument();
      expect(row.getByText(chainName)).toBeInTheDocument();
      expect(row.getByText(item.address)).toBeInTheDocument();
      const link = row.getByRole("link", { name: item.link });
      expect(link).toHaveAttribute("href", `${explorer}/address/${item.address}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("shows the security warning for this page", () => {
    render(<VaultAddressesCard deployment={VAULT_DEPLOYMENTS[137]} />);
    expect(screen.getByText(/TELx will never ask for your recovery phrase/)).toHaveTextContent("Only approve the vault contract shown here");
  });

  it("toggles the address list on small screens", async () => {
    render(<VaultAddressesCard deployment={VAULT_DEPLOYMENTS[8453]} />);
    const toggle = screen.getByRole("button", { name: "Toggle contract addresses" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the keyboard focus outline on the list toggle", () => {
    render(<VaultAddressesCard deployment={VAULT_DEPLOYMENTS[137]} />);
    expect(screen.getByRole("button", { name: "Toggle contract addresses" })).toHaveClass(...FOCUS_OUTLINE_CLASS.split(" "));
  });
});

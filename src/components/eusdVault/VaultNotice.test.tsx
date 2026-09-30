import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { VaultNotice } from "./VaultNotice";

const TONES = [
  { tone: "info", role: "status", className: "text-white/70" },
  { tone: "warning", role: "status", className: "text-status-inProgress" },
  { tone: "error", role: "alert", className: "text-red-300" },
  { tone: "success", role: "status", className: "text-status-complete" },
] as const;

describe("VaultNotice", () => {
  it.each(TONES)("renders a $tone notice with role $role and its tone's colour", ({ tone, role, className }) => {
    render(<VaultNotice notice={{ tone, message: "Something to know." }} />);
    const notice = screen.getByRole(role);
    expect(notice).toHaveTextContent("Something to know.");
    expect(notice).toHaveClass(className);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each(TONES)("shows the link of a $tone notice in a new tab", ({ tone, role }) => {
    render(
      <VaultNotice
        notice={{ tone, message: "Your approval was confirmed.", href: "https://polygonscan.com/tx/0xabc", hrefLabel: "View approval" }}
      />,
    );
    const link = screen.getByRole("link", { name: "View approval" });
    expect(screen.getByRole(role)).toContainElement(link);
    expect(link).toHaveAttribute("href", "https://polygonscan.com/tx/0xabc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("labels a link without a label as the explorer", () => {
    render(<VaultNotice notice={{ tone: "info", message: "Waiting for the network.", href: "https://basescan.org/tx/0xdef" }} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute("href", "https://basescan.org/tx/0xdef");
  });
});

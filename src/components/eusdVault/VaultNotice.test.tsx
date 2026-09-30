import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { VaultNotice } from "./VaultNotice";

const TONES = [
  { tone: "info", className: "text-white/70" },
  { tone: "warning", className: "text-status-inProgress" },
  { tone: "error", className: "text-red-300" },
  { tone: "success", className: "text-status-complete" },
] as const;

describe("VaultNotice", () => {
  it.each(TONES)("renders a $tone notice in its tone's colour", ({ tone, className }) => {
    render(<VaultNotice notice={{ tone, message: "Something to know." }} />);
    expect(screen.getByText("Something to know.")).toHaveClass(className);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders an error as an alert", () => {
    render(<VaultNotice notice={{ tone: "error", message: "The transaction could not be completed." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The transaction could not be completed.");
  });

  it.each(["info", "warning", "success"] as const)(
    "gives a %s notice no live role of its own, so the status region around it announces it once",
    (tone) => {
      render(<VaultNotice notice={{ tone, message: "Something to know." }} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(TONES)("shows the link of a $tone notice in a new tab", ({ tone }) => {
    render(
      <VaultNotice
        notice={{ tone, message: "Your approval was confirmed.", href: "https://polygonscan.com/tx/0xabc", hrefLabel: "View approval" }}
      />,
    );
    const link = screen.getByRole("link", { name: "View approval" });
    expect(screen.getByText("Your approval was confirmed.", { exact: false })).toContainElement(link);
    expect(link).toHaveAttribute("href", "https://polygonscan.com/tx/0xabc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("labels a link without a label as the explorer", () => {
    render(<VaultNotice notice={{ tone: "info", message: "Waiting for the network.", href: "https://basescan.org/tx/0xdef" }} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute("href", "https://basescan.org/tx/0xdef");
  });
});

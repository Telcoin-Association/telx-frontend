import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { VaultCard } from "./VaultCard";

describe("VaultCard", () => {
  it("renders its children without a heading when no title is given", () => {
    render(
      <VaultCard>
        <p>Card body</p>
      </VaultCard>,
    );
    expect(screen.getByText("Card body")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("names the card by its title heading", () => {
    render(
      <VaultCard title="Swap">
        <p>Card body</p>
      </VaultCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Swap" })).not.toHaveClass("sr-only");
    expect(screen.getByRole("region", { name: "Swap" })).toHaveTextContent("Card body");
  });

  it("keeps a hidden title as the card's name and heading for screen readers", () => {
    render(
      <VaultCard title="Swap" titleHidden>
        <p>Card body</p>
      </VaultCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Swap" })).toHaveClass("sr-only");
    expect(screen.getByRole("region", { name: "Swap" })).toHaveTextContent("Card body");
  });

  it("sets white text on the frame, since the app sets no text colour and the panel is dark", () => {
    render(
      <VaultCard title="Swap">
        <p>Card body</p>
      </VaultCard>,
    );
    expect(screen.getByRole("region", { name: "Swap" })).toHaveClass("text-white");
  });

  it("keeps the portal's frame classes and adds the className to the frame", () => {
    render(
      <VaultCard title="Swap" className="lg:w-[55%]">
        <p>Card body</p>
      </VaultCard>,
    );
    expect(screen.getByRole("region", { name: "Swap" })).toHaveClass("lg:w-[55%]", "p-px", "rounded-xl", "from-white/32");
  });
});

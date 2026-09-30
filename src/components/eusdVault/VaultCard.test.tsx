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
    expect(screen.getByRole("heading", { level: 2, name: "Swap" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Swap" })).toHaveTextContent("Card body");
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

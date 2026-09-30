import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import Footer from "./Footer";

// next/jest maps SVGs to a plain object, which cannot render as a component.
jest.mock(
  "../../../public/telx-logo-white.svg",
  () =>
    function TELxLogo() {
      return null;
    },
);
jest.mock(
  "../../../public/logos/telcoin-association-white.svg",
  () =>
    function TALogo() {
      return null;
    },
);

describe("Footer", () => {
  it("links eUSD Vault right after Portfolio in the TELx column", () => {
    render(<Footer />);
    const [telxColumn] = screen.getAllByRole("list");

    expect(within(telxColumn).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Pools",
      "Portfolio",
      "eUSD Vault",
      "About",
      "Search",
    ]);
    expect(within(telxColumn).getByRole("link", { name: "eUSD Vault" })).toHaveAttribute("href", "/eusd-vault");
  });
});

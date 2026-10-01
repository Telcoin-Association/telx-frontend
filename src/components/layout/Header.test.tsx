import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { SkrimProvider } from "@/components/providers/SkrimProvider";
import Header from "./Header";

jest.mock("./CustomConnectButton", () => ({ CustomConnectButton: () => null }));
jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));
// The skrim that hosts the mobile drawer imports wagmi's deepEqual.
jest.mock("wagmi", () => ({ deepEqual: (a: unknown, b: unknown) => a === b }));
// next/jest maps SVGs to a plain object, which cannot render as a component.
jest.mock(
  "../../../public/telx-logo-white.svg",
  () =>
    function TELxLogo() {
      return null;
    },
);

const pathname = usePathname as jest.Mock;
const menuNames = (list: HTMLElement) => within(list).getAllByRole("link").map((link) => link.textContent);

// Resolves once the skrim's dynamic import has settled.
function mountHeaderNav() {
  render(
    <SkrimProvider>
      <Header mobileNavOpen={false} path="/" setWalletIsOpen={jest.fn()} toggleMobileNavOpen={jest.fn()} walletIsOpen={false} />
    </SkrimProvider>,
  );
  return screen.findByRole("navigation");
}

describe("Header navigation", () => {
  const desktopWidth = window.innerWidth;

  beforeEach(() => pathname.mockReturnValue("/"));
  afterEach(() => {
    window.innerWidth = desktopWidth;
  });

  it("links eUSD Vault right after Portfolio in the desktop navigation", async () => {
    const [menu] = within(await mountHeaderNav()).getAllByRole("list");

    expect(menuNames(menu)).toEqual(["Pools", "Portfolio", "eUSD Vault", "Analytics", "About"]);
    expect(within(menu).getByRole("link", { name: "eUSD Vault" })).toHaveAttribute("href", "/eusd-vault");
  });

  it("links eUSD Vault right after Portfolio in the mobile drawer", async () => {
    window.innerWidth = 375;
    const nav = await mountHeaderNav();
    expect(screen.queryByTestId("cross-icon")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("menu-icon"));
    await screen.findByTestId("cross-icon");
    const [menu] = screen.getAllByRole("list").filter((list) => !nav.contains(list));

    expect(menuNames(menu)).toEqual(["Pools", "Portfolio", "eUSD Vault", "Analytics", "About"]);
    expect(within(menu).getByRole("link", { name: "eUSD Vault" })).toHaveAttribute("href", "/eusd-vault");
  });

  it("marks eUSD Vault as the active entry on the vault page", async () => {
    pathname.mockReturnValue("/eusd-vault");
    const menu = within(await mountHeaderNav());

    expect(menu.getByRole("link", { name: "eUSD Vault" })).toHaveClass("font-bold");
    expect(menu.getByRole("link", { name: "Portfolio" })).not.toHaveClass("font-bold");
  });
});

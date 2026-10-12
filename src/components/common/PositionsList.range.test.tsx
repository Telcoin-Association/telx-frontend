import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import type { Position } from "@/lib/positions";
import PositionsList from "./PositionsList";

jest.mock("./PositionHistory", () => function MockPositionHistory() {
  return null;
});
// The add and remove panels read the wallet; these tests only look at the row's badges.
jest.mock("./IncreaseLiquidityPanel", () => function MockIncreaseLiquidityPanel() {
  return null;
});
jest.mock("./RemoveLiquidityPanel", () => function MockRemoveLiquidityPanel() {
  return null;
});

// Positions in the native ETH/TEL pool (currency0 is the zero address) as GET /api/positions returned them on Base,
// with the pool price at tick 141772.
const BASE_SQRT_PRICE = "94900438050224050868954912814733";
const nativeEthPosition = (tokenId: string, tickLower: number, tickUpper: number, amount0: string, amount1: string): Position => ({
  tokenId,
  isSubscribed: true,
  tickLower,
  tickUpper,
  liquidity: "16177207613825389662254",
  amounts: { amount0, amount1, sqrtPriceX96: BASE_SQRT_PRICE },
  price: { price1Per0: 1434753.4135623854, price0Per1: 6.97e-7 },
});
const OUT_OF_RANGE = nativeEthPosition("3124164", 140640, 141120, "0", "444755.053287434791426251");
const IN_RANGE = nativeEthPosition("3129355", 141420, 142200, "0.192710328729332205", "227970.688493499632889235");
const FULL_RANGE = nativeEthPosition("3095754", -887220, 887220, "0.442278714145383942", "634560.894866072078469572");
const ASSETS = [
  { ticker: "ETH", address: null },
  { ticker: "TEL", address: "0x09be1692ca16e06f536f0038ff11d1da8524adb1" },
];

const renderList = (positions: Position[]) =>
  render(
    <PositionsList
      positions={positions}
      assets={ASSETS}
      rates={{ WETH: { USD: "2500" }, TEL: { USD: "0.0017" } }}
      pending={null}
      results={{}}
      onSubscribe={jest.fn()}
      onUnsubscribe={jest.fn()}
    />,
  );

const row = (tokenId: string) => screen.getByRole("listitem", { name: new RegExp(`^Position ${tokenId},`) });

describe("PositionsList range badge in a native ETH pool", () => {
  it("marks each open position In range or Out of range", () => {
    renderList([OUT_OF_RANGE, IN_RANGE, FULL_RANGE]);
    expect(within(row("3124164")).getByTestId("position-badges")).toHaveTextContent("Out of range");
    expect(within(row("3129355")).getByTestId("position-badges")).toHaveTextContent("In range");
    expect(within(row("3095754")).getByTestId("position-badges")).toHaveTextContent("In range");
    expect(row("3124164")).toHaveAccessibleName("Position 3124164, Subscribed, out of range");
  });

  it("shows the badges at phone widths, outside the collapsed details", () => {
    renderList([OUT_OF_RANGE]);
    const badges = within(row("3124164")).getByTestId("position-badges");
    expect(badges.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    // The range column collapses behind Details on phones; the badge is not inside it.
    expect(within(within(row("3124164")).getByTestId("position-range")).queryByText("Out of range")).not.toBeInTheDocument();
  });

  it("shows no range badge when the pool price is unavailable, or for a closed position", () => {
    renderList([
      { ...IN_RANGE, amounts: { ...IN_RANGE.amounts, sqrtPriceX96: "" } },
      { ...OUT_OF_RANGE, liquidity: "0", isSubscribed: false },
    ]);
    expect(within(row("3129355")).getByTestId("position-badges")).not.toHaveTextContent(/range/);
  });
});

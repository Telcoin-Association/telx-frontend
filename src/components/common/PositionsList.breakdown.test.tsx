import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Position } from "@/lib/positions";
import type { PositionRewardsState } from "@/hooks/usePositionRewards";
import type { UsdRates } from "@/lib/positionView";
import PositionsList from "./PositionsList";

jest.mock("./PositionHistory", () => function MockPositionHistory() {
  return null;
});
// The add and remove panels read the wallet; these tests only look at the row's figures.
jest.mock("./IncreaseLiquidityPanel", () => function MockIncreaseLiquidityPanel() {
  return null;
});
jest.mock("./RemoveLiquidityPanel", () => function MockRemoveLiquidityPanel() {
  return null;
});

const Q96 = (2n ** 96n).toString();
const position = (tokenId: string, fields: Partial<Position> = {}): Position => ({
  tokenId,
  isSubscribed: true,
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amounts: { amount0: "6225", amount1: "3381434", sqrtPriceX96: Q96 },
  price: { price1Per0: 540, price0Per1: 1 / 540 },
  fees: { amount0: "12.5", amount1: "2000" },
  ...fields,
});

// eUSD (0x1491...) sorts before TEL (0x7E13...), so it is currency0.
const ASSETS = [
  { ticker: "eUSD", address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949" },
  { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" },
];
const RATES: UsdRates = { EUSD: { USD: "1" }, TEL: { USD: "0.002" } };
const ready = (positions: Record<string, { reward: number; claimable: number; pending: number; final: boolean }>): PositionRewardsState => ({
  status: "ready",
  rewards: { chain: "polygon", poolId: "0xpool", updatedAt: 1, campaigns: [], unresolved: 0, positions },
});

const renderList = (positions: Position[], { rates = RATES, rewards }: { rates?: UsdRates; rewards?: PositionRewardsState } = {}) =>
  render(
    <PositionsList
      positions={positions}
      assets={ASSETS}
      rates={rates}
      pending={null}
      results={{}}
      onSubscribe={jest.fn()}
      onUnsubscribe={jest.fn()}
      chain="polygon"
      poolId="0xpool"
      onCollect={jest.fn()}
      rewards={rewards}
    />,
  );

const row = (tokenId: string) => screen.getByRole("listitem", { name: new RegExp(`^Position ${tokenId},`) });
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Asserts that `element` reads exactly `lines`, in order. */
const expectLines = (element: HTMLElement, lines: string[]) => expect(element).toHaveTextContent(new RegExp(`^${escape(lines.join(""))}$`));

describe("PositionsList three-line figures", () => {
  it("shows the liquidity total, then each asset's amount with its USD value", () => {
    renderList([position("1")]);
    const liquidity = within(row("1")).getByTestId("liquidity-1");
    expectLines(liquidity, ["$12,987.87", "6,225 eUSD · $6,225.00", "3,381,434 TEL · $6,762.87"]);
    expect(within(liquidity).getByText("$12,987.87")).toHaveClass("text-base", "font-semibold");
    // Each asset line keeps its token icon.
    expect(within(liquidity).getAllByRole("presentation")).toHaveLength(2);
  });

  it("shows the uncollected fees the same way", () => {
    renderList([position("1")]);
    expectLines(within(row("1")).getByTestId("fees-1"), ["$16.50", "12.5 eUSD · $12.50", "2,000 TEL · $4.00"]);
  });

  it("shows TELx rewards as the total earned, then claimable, then accruing", () => {
    renderList([position("1")], { rewards: ready({ "1": { reward: 40_000, claimable: 25_000, pending: 5_000, final: true } }) });
    expect(within(row("1")).getByTestId("pending-tel-1")).toHaveTextContent("40K TEL · $80.00");
    expect(within(row("1")).getByTestId("claimable-tel-1")).toHaveTextContent("25K claimable · $50.00");
    expect(within(row("1")).getByTestId("accruing-tel-1")).toHaveTextContent("5K accruing · $10.00");
    expect(within(row("1")).queryByTestId("provisional-1")).not.toBeInTheDocument();
  });

  it("prices one currency from the other through the pool price when only one has a rate", () => {
    renderList([position("1")], { rates: { TEL: { USD: "0.002" } } });
    // 540 TEL per eUSD at $0.002 prices eUSD at $1.08.
    expectLines(within(row("1")).getByTestId("liquidity-1"), ["$13,485.87", "6,225 eUSD · $6,723.00", "3,381,434 TEL · $6,762.87"]);
  });

  it("leaves out the total when an asset can't be priced, and shows that asset without a USD value", () => {
    renderList([position("1", { price: { price1Per0: 0, price0Per1: 0 } })], { rates: { TEL: { USD: "0.002" } } });
    expectLines(within(row("1")).getByTestId("liquidity-1"), ["6,225 eUSD", "3,381,434 TEL · $6,762.87"]);
    expectLines(within(row("1")).getByTestId("fees-1"), ["12.5 eUSD", "2,000 TEL · $4.00"]);
  });

  it("shows amounts alone when there are no rates at all, and rewards in TEL alone without a TEL rate", () => {
    renderList([position("1")], { rates: {}, rewards: ready({ "1": { reward: 40_000, claimable: 25_000, pending: 5_000, final: false } }) });
    expectLines(within(row("1")).getByTestId("liquidity-1"), ["6,225 eUSD", "3,381,434 TEL"]);
    expect(within(row("1")).getByTestId("pending-tel-1")).toHaveTextContent(/^40K TEL$/);
    expect(within(row("1")).getByTestId("claimable-tel-1")).toHaveTextContent(/^25K claimable$/);
    expect(within(row("1")).getByTestId("accruing-tel-1")).toHaveTextContent(/^5K accruing$/);
    expect(within(row("1")).getByTestId("provisional-1")).toBeInTheDocument();
  });

  it("gives an asset with nothing in it no USD value", () => {
    renderList([position("1", { fees: { amount0: "0", amount1: "2000" } })]);
    expectLines(within(row("1")).getByTestId("fees-1"), ["$4.00", "0 eUSD", "2,000 TEL · $4.00"]);
  });

  it("keeps a closed row to its zero amounts, with no total, no fees and no rewards breakdown", async () => {
    const closed = position("2", { liquidity: "0", isSubscribed: false, fees: undefined, amounts: { amount0: "0", amount1: "0", sqrtPriceX96: Q96 } });
    renderList([closed], { rewards: ready({}) });
    // Closed positions are listed under the Closed filter only.
    fireEvent.click(screen.getByRole("button", { name: /^Closed/ }));
    const closedRow = await screen.findByRole("listitem", { name: /^Position 2,/ });
    expectLines(within(closedRow).getByTestId("liquidity-2"), ["0 eUSD", "0 TEL"]);
    expect(within(closedRow).queryByTestId("position-fees-2")).not.toBeInTheDocument();
    expect(within(closedRow).getByTestId("pending-tel-2")).toHaveTextContent(/^0 TEL$/);
    expect(within(closedRow).queryByTestId("claimable-tel-2")).not.toBeInTheDocument();
  });

  it("shows a single line while the rewards load or when they can't be read", () => {
    const { unmount } = renderList([position("1")], { rewards: { status: "loading" } });
    expect(within(row("1")).getByTestId("position-rewards-1")).toHaveTextContent(/^TELx rewardsLoading…$/);
    expect(within(row("1")).queryByTestId("pending-tel-1")).not.toBeInTheDocument();
    unmount();
    renderList([position("1")], { rewards: { status: "failed" } });
    expect(within(row("1")).getByTestId("position-rewards-1")).toHaveTextContent(/^TELx rewardsUnavailable$/);
  });

  it("keeps the figures behind Details on phones and in their columns from sm and xl", () => {
    renderList([position("1")], { rewards: ready({}) });
    for (const testId of ["position-amounts", "position-fees-1", "position-rewards-1"]) {
      expect(within(row("1")).getByTestId(testId)).toHaveClass("hidden", "sm:flex", "xl:items-center", "sm:self-start", "xl:self-center");
    }
    expect(within(row("1")).getByTestId("position-amounts")).toHaveClass("sm:col-start-1", "sm:row-start-2", "xl:col-start-3");
  });
});

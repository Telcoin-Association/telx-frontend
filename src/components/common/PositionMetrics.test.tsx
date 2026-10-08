import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { RangeIndicator } from "./PositionMetrics";
import { priceAtTick } from "@/lib/v4/range";

const ASSETS = [{ ticker: "WETH", address: null }, { ticker: "TEL", address: null }];
/** sqrtPriceX96 for a pool sitting exactly at `tick`. */
const atTick = (tick: number) => BigInt(Math.round(Math.sqrt(1.0001 ** tick) * 2 ** 96)).toString();
const position = (tickLower: number, tickUpper: number, tick: number) => ({
  tickLower,
  tickUpper,
  amounts: { amount0: "1", amount1: "1", sqrtPriceX96: atTick(tick) },
  price: { price1Per0: 2000, price0Per1: 1 / 2000 },
});

describe("RangeIndicator", () => {
  it("reads Full range, with no bar, for a full-range position", () => {
    render(<RangeIndicator position={position(-887_220, 887_220, 0)} assets={ASSETS} />);
    expect(screen.getByTestId("range-full")).toHaveTextContent("Full range");
    expect(screen.queryByTestId("range-indicator")).not.toBeInTheDocument();
    expect(screen.queryByText(/% WETH/)).not.toBeInTheDocument();
  });

  it("is green in range, with the bounds in the pool's orientation and no token split", () => {
    render(<RangeIndicator position={position(-1000, 1000, 0)} assets={ASSETS} />);
    const indicator = screen.getByTestId("range-indicator");
    expect(indicator).toHaveAttribute("data-state", "in");
    expect(screen.getByRole("img")).toHaveAccessibleName("In range: price at 50% of the range, from 1,810 to 2,210 TEL per WETH");
    expect(screen.getByTestId("range-marker")).toHaveClass("bg-white");
    expect(indicator).toHaveTextContent("1,810TEL per WETH2,210");
    expect(screen.queryByText(/% WETH/)).not.toBeInTheDocument();
  });

  it("turns amber within a tenth of the range's width of an edge", () => {
    render(<RangeIndicator position={position(-1000, 1000, 950)} assets={ASSETS} />);
    expect(screen.getByTestId("range-indicator")).toHaveAttribute("data-state", "near");
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Near the edge of the range: price at 98% of the range/);
    expect(screen.getByTestId("range-marker")).toHaveClass("bg-yellow-300");
  });

  describe("on the eUSD/TEL pool, with bounds at the edge of the tick space", () => {
    const EUSD_TEL = [
      { ticker: "eUSD", address: null },
      { ticker: "TEL", address: null },
    ];
    // TEL at about 546 per eUSD: tick 339,360 with eUSD's 6 decimals against TEL's 18.
    const eusdTel = (tickLower: number, tickUpper: number) => ({
      tickLower,
      tickUpper,
      amounts: { amount0: "1", amount1: "1", sqrtPriceX96: atTick(339_360) },
      price: { price1Per0: priceAtTick(339_360, 6, 18), price0Per1: 1 / priceAtTick(339_360, 6, 18) },
    });

    it("reads ∞ for a maximum at the top tick, with the full minimum in its title", () => {
      render(<RangeIndicator position={eusdTel(206_700, 887_220)} assets={EUSD_TEL} />);
      expect(screen.getByTestId("range-min")).toHaveTextContent(/^0\.000947$/);
      expect(screen.getByTestId("range-min")).toHaveAttribute("title", "0.00094714861");
      expect(screen.getByTestId("range-max")).toHaveTextContent(/^∞$/);
      expect(screen.getByRole("img")).toHaveAccessibleName(/from 0\.000947 to ∞ TEL per eUSD$/);
    });

    it("reads 0 for a minimum at the bottom tick", () => {
      render(<RangeIndicator position={eusdTel(-887_220, 343_140)} assets={EUSD_TEL} />);
      expect(screen.getByTestId("range-min")).toHaveTextContent(/^0$/);
      expect(screen.getByTestId("range-max")).toHaveTextContent(/^797$/);
    });

    it("keeps far bounds short and the label row inside its column", () => {
      render(<RangeIndicator position={eusdTel(-800_000, 800_000)} assets={EUSD_TEL} />);
      expect(screen.getByTestId("range-min").textContent!.length).toBeLessThanOrEqual(10);
      expect(screen.getByTestId("range-max")).toHaveTextContent(/^\d\.\d+e\d+$/);
      expect(screen.getByTestId("range-labels")).toHaveClass("min-w-0", "overflow-hidden");
      for (const label of [screen.getByTestId("range-min"), screen.getByTestId("range-max")]) expect(label).toHaveClass("min-w-0", "truncate");
    });
  });

  it("turns red out of range, with the marker at the edge the price left from", () => {
    render(<RangeIndicator position={position(-1000, 1000, 1500)} assets={ASSETS} />);
    expect(screen.getByTestId("range-indicator")).toHaveAttribute("data-state", "out");
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Out of range: price above the range/);
    expect(screen.getByTestId("range-marker")).toHaveStyle({ left: "100%" });
  });
});

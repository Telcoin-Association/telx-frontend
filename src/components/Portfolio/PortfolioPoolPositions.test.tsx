import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { Position } from "@/lib/positions";
import { PoolPositionsTotal, type PortfolioPool } from "./PortfolioPoolPositions";

jest.mock("../../hooks/usePositionActions", () => ({ usePositionActions: jest.fn() }));

const Q96 = (2n ** 96n).toString();
const position = (tokenId: string, fields: Partial<Position> = {}): Position => ({
  tokenId,
  isSubscribed: false,
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amounts: { amount0: "1", amount1: "1000", sqrtPriceX96: Q96 },
  price: { price1Per0: 1000, price0Per1: 0.001 },
  ...fields,
});

const WETH = { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" };
const TEL = { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" };
const EUSD = { ticker: "eUSD", address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949" };
const EMXN = { ticker: "eMXN", address: "0x68727e573D21a49c767c3c86A92D9F24bd933c99" };
const pool = (assets: PortfolioPool["assets"]): PortfolioPool => ({ poolContractAddress: "0xpool", blockchain: "polygon", assets });
const rates = { WETH: { USD: "3000" }, TEL: { USD: "0.005" } };

describe("PoolPositionsTotal", () => {
  it("sums the pool's open positions and leaves closed ones out", () => {
    render(<PoolPositionsTotal pool={pool([TEL, WETH])} positions={[position("1"), position("2"), position("3", { liquidity: "0" })]} rates={rates} />);
    // Each open position: 1 WETH at $3000 plus 1000 TEL at $0.005.
    expect(screen.getByText("$6,010.00")).toBeInTheDocument();
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
  });

  it("prices a token without a rate from its partner through the pool price", () => {
    // TEL at 3000 / 1000 = $3 per TEL from the WETH rate.
    render(<PoolPositionsTotal pool={pool([TEL, WETH])} positions={[position("1")]} rates={{ WETH: { USD: "3000" } }} />);
    expect(screen.getByText("$6,000.00")).toBeInTheDocument();
  });

  it("says the value is unavailable when no open position can be priced", () => {
    render(<PoolPositionsTotal pool={pool([EUSD, EMXN])} positions={[position("2")]} rates={rates} />);
    expect(screen.getByText("Value unavailable")).toBeInTheDocument();
  });

  it("prices eUSD and eMXN once the market rates carry them", () => {
    render(<PoolPositionsTotal pool={pool([EUSD, EMXN])} positions={[position("1")]} rates={{ EUSD: { USD: "1" }, EMXN: { USD: "0.05" } }} />);
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
    expect(screen.queryByText("Value unavailable")).not.toBeInTheDocument();
  });

  it("marks partial with the reason when only some open positions are priced", () => {
    const pricedAndNot = [position("1"), position("2", { price: { price1Per0: 0, price0Per1: 0 } })];
    render(<PoolPositionsTotal pool={pool([TEL, WETH])} positions={pricedAndNot} rates={{ WETH: { USD: "3000" } }} />);
    expect(screen.getByText("partial")).toHaveAttribute("title", "Excludes 1 position without a price.");
  });

  it("shows nothing for a pool without open positions", () => {
    render(<PoolPositionsTotal pool={pool([TEL, WETH])} positions={[position("1", { liquidity: "0" })]} rates={rates} />);
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Value unavailable")).not.toBeInTheDocument();
  });
});

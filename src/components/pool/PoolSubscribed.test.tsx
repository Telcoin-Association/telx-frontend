import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import PoolSubscribed from "./PoolSubscribed";
import LabelSubscribedLiquidityRow from "../common/LabelSubscribedLiquidityRow";

const pool = (fields: Record<string, unknown>) =>
  ({ protocol: "uniswap", rewardsStatus: "LIVE", subscribedTvlUSD: 61_200, totalLiquidity: 180_000, ...fields }) as unknown as ProtocolsContractData;

describe("PoolSubscribed", () => {
  it("shows the subscribed value and its share of TVL for a live campaign", () => {
    render(<PoolSubscribed contractData={pool({})} />);
    expect(screen.getByText("$61,200.00")).toBeInTheDocument();
    expect(screen.getByText("34% of TVL")).toBeInTheDocument();
  });

  it.each([
    [{ subscribedTvlUSD: null }, "Unavailable"],
    [{ rewardsStatus: "SOON" }, "Not started"],
    [{ rewardsStatus: "PAST" }, "No campaign"],
    [{ protocol: "balancer" }, "No campaign"],
  ])("reads %j as %s, never $0", (fields, text) => {
    render(<PoolSubscribed contractData={pool(fields)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("LabelSubscribedLiquidityRow", () => {
  it("labels the pool page figure Subscribed Value Locked, with the share of TVL", () => {
    render(<LabelSubscribedLiquidityRow contractData={pool({})} />);
    expect(screen.getByText("Subscribed Value Locked")).toBeInTheDocument();
    expect(screen.getByText(/\$61,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/34% of TVL/)).toBeInTheDocument();
  });

  it("says when a pool has no campaign instead of showing $0", () => {
    render(<LabelSubscribedLiquidityRow contractData={pool({ rewardsStatus: null })} />);
    expect(screen.getByText("No campaign")).toBeInTheDocument();
  });
});

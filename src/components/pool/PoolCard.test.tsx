import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import PoolCard from "./PoolCard";

const NOW = Date.UTC(2026, 9, 2, 12);
jest.mock("../../hooks/useNow", () => ({ useNow: () => NOW }));
jest.mock("../common/ChainLogo", () => function MockChainLogo({ chain }: { chain: string }) {
  return <span>{`chain ${chain}`}</span>;
});
jest.mock("./PoolSnapshotAssets", () => function MockAssets() {
  return <span>pair</span>;
});
jest.mock("./PoolTotal", () => function MockTotal() {
  return <span>tvl value</span>;
});
jest.mock("./PoolSubscribed", () => function MockSubscribed() {
  return <span>svl value</span>;
});
jest.mock("./PoolVolume", () => function MockVolume() {
  return <span>volume value</span>;
});
jest.mock("./PoolFees", () => function MockFees() {
  return <span>fees value</span>;
});
jest.mock("./PoolRewards", () => function MockRewards() {
  return <span>rewards cell</span>;
});

const pool = (fields: Record<string, unknown> = {}) => ({
  poolContractAddress: "0xpool",
  blockchain: "polygon",
  protocol: "uniswap",
  assets: [{ ticker: "WETH", weight: 50 }, { ticker: "TEL", weight: 50 }],
  rewards: [{ amount: 500000, ticker: "TEL" }],
  rewardsStatus: null,
  rewardsApr: null,
  rewardsCampaignStart: null,
  rewardsCampaignEnd: null,
  ...fields,
});

describe("PoolCard", () => {
  it("leads a live pool with its APR, then the weekly rewards and end date, then every figure", () => {
    render(<PoolCard contractData={pool({ rewardsStatus: "LIVE", rewardsApr: 54.6, rewardsCampaignEnd: Date.UTC(2026, 9, 7, 19) })} />);
    const card = screen.getByRole("link", { name: "WETH/TEL on Polygon" });
    expect(card).toHaveAttribute("href", "/pool/0xpool?chain=polygon");
    expect(within(card).getByText("Live")).toBeInTheDocument();
    expect(within(card).getByText("54.6% APR")).toBeInTheDocument();
    expect(within(card).getByText("500,000 TEL / week · ends Oct 7 (UTC)")).toBeInTheDocument();
    for (const [label, value] of [
      ["TVL", "tvl value"],
      ["SVL", "svl value"],
      ["Volume (24hr)", "volume value"],
      ["Fees (24hr)", "fees value"],
    ]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(within(card).getByText(value)).toBeInTheDocument();
    }
    expect(within(card).queryByText("rewards cell")).not.toBeInTheDocument();
  });

  it("says when a scheduled campaign starts", () => {
    render(<PoolCard contractData={pool({ rewardsStatus: "SOON", rewardsCampaignStart: Date.UTC(2026, 9, 7, 19) })} />);
    expect(screen.getByText("Starts Oct 7")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("reads APR pending for a live campaign Merkl hasn't measured", () => {
    render(<PoolCard contractData={pool({ rewardsStatus: "LIVE", rewardsPending: true })} />);
    expect(screen.getByText("APR pending")).toBeInTheDocument();
  });

  it("falls back to the rewards cell when there's no Merkl campaign", () => {
    render(<PoolCard contractData={pool()} />);
    expect(screen.getByText("Rewards")).toBeInTheDocument();
    expect(screen.getByText("rewards cell")).toBeInTheDocument();
  });
});

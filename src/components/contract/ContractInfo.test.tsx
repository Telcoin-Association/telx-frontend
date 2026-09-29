import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import ContractInfo from "./ContractInfo";

// Each row renders its component name, so the test reads which rows the panel shows.
jest.mock("../common/LabelStatusRow", () => function LabelStatusRow() { return <span>LabelStatusRow</span>; });
jest.mock("../common/LabelProtocolRow", () => function LabelProtocolRow() { return <span>LabelProtocolRow</span>; });
jest.mock("../common/LabelStakeAddressRow", () => function LabelStakeAddressRow() { return <span>LabelStakeAddressRow</span>; });
jest.mock("../common/LabelTotalLiquidityRow", () => function LabelTotalLiquidityRow() { return <span>LabelTotalLiquidityRow</span>; });
jest.mock("../common/LabelStakedLiquidityRow", () => function LabelStakedLiquidityRow() { return <span>LabelStakedLiquidityRow</span>; });
jest.mock("../common/LabelSubscribedLiquidityRow", () => function LabelSubscribedLiquidityRow() { return <span>LabelSubscribedLiquidityRow</span>; });
jest.mock("../common/LabelVolumeRow", () => function LabelVolumeRow() { return <span>LabelVolumeRow</span>; });
jest.mock("../common/LabelFeesRow", () => function LabelFeesRow() { return <span>LabelFeesRow</span>; });
jest.mock("../common/LabelPoolAnalyticsRow", () => function LabelPoolAnalyticsRow() { return <span>LabelPoolAnalyticsRow</span>; });
jest.mock("../common/LabelStakePeriod", () => function LabelStakePeriod() { return <span>LabelStakePeriod</span>; });
jest.mock("../common/LabelRewardsRow", () => function LabelRewardsRow() { return <span>LabelRewardsRow</span>; });
jest.mock("../common/LabelViewPoolRow", () => function LabelViewPoolRow() { return <span>LabelViewPoolRow</span>; });
jest.mock("../common/LabelPoolAddressRow", () => function LabelPoolAddressRow() { return <span>LabelPoolAddressRow</span>; });
jest.mock("../common/LabelTokenAddressesRow", () => function LabelTokenAddressesRow() { return <span>LabelTokenAddressesRow</span>; });

const pool = (fields: Record<string, unknown>) => ({ protocol: "balancer", active: true, ...fields }) as any;

describe("ContractInfo", () => {
  it("shows the live figures of an active pool", () => {
    render(<ContractInfo selectedPool={pool({})} />);
    for (const row of ["LabelTotalLiquidityRow", "LabelStakedLiquidityRow", "LabelVolumeRow", "LabelFeesRow"]) {
      expect(screen.getByText(row)).toBeInTheDocument();
    }
    expect(screen.queryByText("Archived pool, no live data")).not.toBeInTheDocument();
  });

  it("replaces the live figures of an archived pool with a note, keeping its addresses and links", () => {
    render(<ContractInfo selectedPool={pool({ active: false })} />);
    expect(screen.getByText("Archived pool, no live data")).toBeInTheDocument();
    for (const row of ["LabelTotalLiquidityRow", "LabelStakedLiquidityRow", "LabelVolumeRow", "LabelFeesRow"]) {
      expect(screen.queryByText(row)).not.toBeInTheDocument();
    }
    expect(screen.getByText("LabelStakeAddressRow")).toBeInTheDocument();
    expect(screen.getByText("LabelPoolAddressRow")).toBeInTheDocument();
  });
});

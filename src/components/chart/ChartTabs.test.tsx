import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import ChartTabs from "./ChartTabs";

jest.mock("./PoolChart", () => function PoolChart() {
  return <div>chart</div>;
});

describe("ChartTabs", () => {
  it("shows Unavailable and the empty state when the pool has no data", () => {
    render(<ChartTabs totalLiquidity={null} dailyVolume={null} dailyFees={null} liquidityWeights={[]} liquidityLabels={[]} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("No historical data")).toBeInTheDocument();
    expect(screen.queryByText("Daily Volume")).not.toBeInTheDocument();
  });

  it("renders zero as an amount and keeps the tabs working", () => {
    render(
      <ChartTabs
        totalLiquidity={0}
        dailyVolume={null}
        liquidityWeights={[1, 2]}
        liquidityLabels={["2026-09-24", "2026-09-25"]}
        volumeWeights={[3]}
        volumeLabels={["2026-09-25"]}
      />
    );
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("chart")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Daily Volume"));
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("chart")).toBeInTheDocument();
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import ChartTabs from "./ChartTabs";

type MockChartProps = {
  metricLabel: string;
  onActivePointChange?: (point: { date: string; value: number } | null) => void;
};

jest.mock("./PoolChart", () =>
  function PoolChart({ metricLabel, onActivePointChange }: MockChartProps) {
    return (
      <div>
        <span>chart</span>
        <span data-testid="metric">{metricLabel}</span>
        <button onClick={() => onActivePointChange?.({ date: "2026-09-24", value: 92262.871 })}>hover</button>
        <button onClick={() => onActivePointChange?.(null)}>leave</button>
      </div>
    );
  },
);

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

  it("follows the hovered bar in the headline and returns to the latest value on leave", () => {
    render(<ChartTabs totalLiquidity={145171.7} liquidityWeights={[1, 2]} liquidityLabels={["2026-09-25", "2026-09-24"]} />);
    expect(screen.getByText("$145,171.70")).toBeInTheDocument();
    expect(screen.getByText("Past day")).toBeInTheDocument();
    expect(screen.getByTestId("metric")).toHaveTextContent("TVL");

    fireEvent.click(screen.getByText("hover"));
    expect(screen.getByText("$92,262.87")).toBeInTheDocument();
    expect(screen.getByText("Sep 24, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Past day")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("leave"));
    expect(screen.getByText("$145,171.70")).toBeInTheDocument();
    expect(screen.getByText("Past day")).toBeInTheDocument();
  });

  it("names the chart metric after the tab and clears the hovered bar when the tab changes", () => {
    render(
      <ChartTabs
        totalLiquidity={10}
        dailyVolume={20}
        dailyFees={30}
        liquidityWeights={[1]}
        liquidityLabels={["2026-09-25"]}
        volumeWeights={[2]}
        volumeLabels={["2026-09-25"]}
        feeWeights={[3]}
        feeLabels={["2026-09-25"]}
      />,
    );
    fireEvent.click(screen.getByText("hover"));
    expect(screen.getByText("Sep 24, 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Daily Volume"));
    expect(screen.getByTestId("metric")).toHaveTextContent("Volume");
    expect(screen.getByText("$20.00")).toBeInTheDocument();
    expect(screen.queryByText("Sep 24, 2026")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Daily Fees"));
    expect(screen.getByTestId("metric")).toHaveTextContent("Fees");
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });
});

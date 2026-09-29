import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import PoolChart, { activePointFromChartState, buildChartData, ChartTooltipContent } from "./PoolChart";

type ChartState = { isTooltipActive?: boolean; activeTooltipIndex?: number };
type MockBarChartProps = {
  children?: React.ReactNode;
  onMouseMove?: (state: ChartState) => void;
  onMouseLeave?: () => void;
};
type MockTooltipProps = { cursor?: unknown };
type MockBarProps = { activeBar?: unknown };

// Recharts measures its container, which jsdom cannot do, so the chart is replaced by stand-ins that expose
// the event handlers and the props that control the hover styling.
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, onMouseMove, onMouseLeave }: MockBarChartProps) => (
    <div>
      <button onClick={() => onMouseMove?.({ isTooltipActive: true, activeTooltipIndex: 1 })}>move</button>
      <button onClick={() => onMouseMove?.({ isTooltipActive: false })}>move-off</button>
      <button onClick={() => onMouseLeave?.()}>mouse-leave</button>
      {children}
    </div>
  ),
  Tooltip: ({ cursor }: MockTooltipProps) => <span data-testid="tooltip-cursor">{JSON.stringify(cursor)}</span>,
  Bar: ({ activeBar }: MockBarProps) => <span data-testid="active-bar">{JSON.stringify(activeBar)}</span>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
}));

const weights = [100, 200, 300];
const labels = ["2026-09-26", "2026-09-25", "2026-09-24"];

describe("buildChartData", () => {
  it("lines labels up with weights and keeps the last days", () => {
    expect(buildChartData(weights, labels, 90)).toEqual([
      { date: "2026-09-24", value: 100 },
      { date: "2026-09-25", value: 200 },
      { date: "2026-09-26", value: 300 },
    ]);
    expect(buildChartData(weights, labels, 2)).toEqual([
      { date: "2026-09-25", value: 200 },
      { date: "2026-09-26", value: 300 },
    ]);
  });
});

describe("activePointFromChartState", () => {
  const data = buildChartData(weights, labels, 90);

  it("returns the bar at the active tooltip index", () => {
    expect(activePointFromChartState({ isTooltipActive: true, activeTooltipIndex: 2 }, data)).toEqual({ date: "2026-09-26", value: 300 });
  });

  it("returns null when no bar is active", () => {
    expect(activePointFromChartState({ isTooltipActive: false, activeTooltipIndex: 2 }, data)).toBeNull();
    expect(activePointFromChartState({ isTooltipActive: true }, data)).toBeNull();
    expect(activePointFromChartState({ isTooltipActive: true, activeTooltipIndex: 9 }, data)).toBeNull();
    expect(activePointFromChartState(undefined, data)).toBeNull();
  });
});

describe("ChartTooltipContent", () => {
  it("shows the formatted date, the tab's metric name and the value to the cent", () => {
    render(<ChartTooltipContent active label="2026-09-24" payload={[{ value: 92262.871 }]} metricLabel="TVL" />);
    expect(screen.getByText("Sep 24, 2026")).toBeInTheDocument();
    expect(screen.getByText("TVL")).toBeInTheDocument();
    expect(screen.getByText("$92,262.87")).toBeInTheDocument();
  });

  it("uses compact notation from $1M", () => {
    render(<ChartTooltipContent active label="2026-09-24" payload={[{ value: 1_234_567 }]} metricLabel="Volume" />);
    expect(screen.getByText("$1.23M")).toBeInTheDocument();
  });

  it("renders nothing while inactive", () => {
    const { container } = render(<ChartTooltipContent active={false} payload={[{ value: 1 }]} metricLabel="Fees" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PoolChart", () => {
  function setupChart() {
    const onActivePointChange = jest.fn();
    render(<PoolChart weights={weights} labels={labels} metricLabel="TVL" selectedDays={90} onActivePointChange={onActivePointChange} />);
    return onActivePointChange;
  }

  it("reports the hovered bar and clears it on mouse leave", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    expect(onActivePointChange).toHaveBeenLastCalledWith({ date: "2026-09-25", value: 200 });

    fireEvent.click(screen.getAllByText("move-off")[0]);
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.click(screen.getAllByText("mouse-leave")[0]);
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);
  });

  it("clears the hovered bar when a touch ends or focus leaves the chart", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.touchEnd(screen.getByTestId("pool-chart"));
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.blur(screen.getAllByText("move")[0]);
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);
  });

  it("uses a low-opacity cursor and highlights the hovered bar", () => {
    setupChart();
    for (const cursor of screen.getAllByTestId("tooltip-cursor")) {
      expect(JSON.parse(cursor.textContent ?? "")).toEqual({ fill: "#4967FF", fillOpacity: 0.12 });
    }
    for (const bar of screen.getAllByTestId("active-bar")) {
      expect(JSON.parse(bar.textContent ?? "")).toEqual({ fill: "#8A9DFF" });
    }
  });
});

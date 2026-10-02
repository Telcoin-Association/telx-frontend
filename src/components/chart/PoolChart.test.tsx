import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import PoolChart, { activePointFromChartState, buildChartData, ChartTooltipContent, withOverlay } from "./PoolChart";

type ChartState = { isTooltipActive?: boolean; activeTooltipIndex?: number };
type MockBarChartProps = {
  children?: React.ReactNode;
  title?: string;
  desc?: string;
  onMouseMove?: (state: ChartState) => void;
  onMouseLeave?: () => void;
};
type MockTooltipProps = { cursor?: unknown };
type MockBarProps = { activeBar?: unknown };

// Recharts measures its container, which jsdom cannot do, so the chart is replaced by stand-ins that expose
// the event handlers, the chart's name, and the props that control the hover styling. The stand-in keeps its
// own active flag, as Recharts keeps its tooltip state, so a remount shows up as the flag clearing.
jest.mock("recharts", () => {
  const { useState } = jest.requireActual<typeof import("react")>("react");
  function MockBarChart({ children, title, desc, onMouseMove, onMouseLeave }: MockBarChartProps) {
    const [active, setActive] = useState(false);
    return (
      <div>
        <span data-testid="chart-title">{title}</span>
        <span data-testid="chart-desc">{desc}</span>
        <span data-testid="recharts-active">{String(active)}</span>
        <button
          onClick={() => {
            setActive(true);
            onMouseMove?.({ isTooltipActive: true, activeTooltipIndex: 1 });
          }}
        >
          move
        </button>
        <button onClick={() => onMouseMove?.({ isTooltipActive: false })}>move-off</button>
        <button onClick={() => onMouseLeave?.()}>mouse-leave</button>
        {children}
      </div>
    );
  }
  return {
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    BarChart: MockBarChart,
    ComposedChart: MockBarChart,
    Line: ({ name }: { name?: string }) => <span data-testid="overlay-line">{name}</span>,
    Tooltip: ({ cursor }: MockTooltipProps) => <span data-testid="tooltip-cursor">{JSON.stringify(cursor)}</span>,
    Bar: ({ activeBar }: MockBarProps) => <span data-testid="active-bar">{JSON.stringify(activeBar)}</span>,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
  };
});

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

describe("withOverlay", () => {
  it("adds the overlay's value by day, null where it has none", () => {
    expect(withOverlay(buildChartData(weights, labels, 90), { label: "SVL", byDate: { "2026-09-25": 150 } })).toEqual([
      { date: "2026-09-24", value: 100, overlay: null },
      { date: "2026-09-25", value: 200, overlay: 150 },
      { date: "2026-09-26", value: 300, overlay: null },
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

  it("shows large values to the cent, the same as the headline", () => {
    render(<ChartTooltipContent active label="2026-09-24" payload={[{ value: 1_234_567.89 }]} metricLabel="Volume" />);
    expect(screen.getByText("$1,234,567.89")).toBeInTheDocument();
  });

  it("shows the overlay's value for the day, or that no campaign ran", () => {
    const { rerender } = render(
      <ChartTooltipContent active label="2026-09-24" payload={[{ value: 1000, payload: { overlay: 400 } }]} metricLabel="TVL" overlayLabel="SVL" />,
    );
    expect(screen.getByText("SVL")).toBeInTheDocument();
    expect(screen.getByText("$400.00")).toBeInTheDocument();

    rerender(<ChartTooltipContent active label="2026-09-24" payload={[{ value: 1000, payload: { overlay: null } }]} metricLabel="TVL" overlayLabel="SVL" />);
    expect(screen.getByText("No campaign")).toBeInTheDocument();
  });

  it("says when the day's figure is an estimate", () => {
    const estimated = new Set(["2026-09-24"]);
    const { rerender } = render(
      <ChartTooltipContent active label="2026-09-24" payload={[{ value: 400 }]} metricLabel="SVL" estimatedDates={estimated} estimateSubject="SVL" />,
    );
    expect(screen.getByText("SVL is our estimate for this day.")).toBeInTheDocument();

    rerender(<ChartTooltipContent active label="2026-09-25" payload={[{ value: 400 }]} metricLabel="SVL" estimatedDates={estimated} estimateSubject="SVL" />);
    expect(screen.queryByText(/our estimate/)).not.toBeInTheDocument();
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

  it("draws an overlay as a line over the bars and names both in the title", () => {
    render(<PoolChart weights={weights} labels={labels} metricLabel="TVL" selectedDays={30} overlay={{ label: "SVL", byDate: {} }} />);
    expect(screen.getAllByTestId("overlay-line")[0]).toHaveTextContent("SVL");
    for (const title of screen.getAllByTestId("chart-title")) expect(title).toHaveTextContent("TVL and SVL by day, last 30 days");
  });

  it("draws no line without an overlay", () => {
    setupChart();
    expect(screen.queryByTestId("overlay-line")).not.toBeInTheDocument();
  });

  it("names the chart after its metric and range, and says how to move through it", () => {
    setupChart();
    for (const title of screen.getAllByTestId("chart-title")) expect(title).toHaveTextContent("TVL by day, last 90 days");
    for (const desc of screen.getAllByTestId("chart-desc")) expect(desc).toHaveTextContent(/left and right arrow keys/);
  });

  it("keeps a touched bar selected, in step with the tooltip, when the touch ends", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.touchEnd(screen.getByTestId("pool-chart"));
    expect(onActivePointChange).toHaveBeenLastCalledWith({ date: "2026-09-25", value: 200 });
    expect(screen.getAllByTestId("recharts-active")[0]).toHaveTextContent("true");
  });

  it("clears the headline, the tooltip and the active bar together when focus leaves the chart", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.blur(screen.getAllByText("move")[0], { relatedTarget: document.body });
    expect(onActivePointChange).toHaveBeenLastCalledWith(null);
    for (const flag of screen.getAllByTestId("recharts-active")) expect(flag).toHaveTextContent("false");
  });

  it("keeps the selection when focus moves within the chart", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.blur(screen.getAllByText("move")[0], { relatedTarget: screen.getAllByText("move-off")[0] });
    expect(onActivePointChange).toHaveBeenLastCalledWith({ date: "2026-09-25", value: 200 });
  });

  it("reports the same point object for repeated moves over one bar, so the headline does not re-render", () => {
    const onActivePointChange = setupChart();
    fireEvent.click(screen.getAllByText("move")[0]);
    fireEvent.click(screen.getAllByText("move")[0]);
    expect(onActivePointChange.mock.calls[0][0]).toBe(onActivePointChange.mock.calls[1][0]);
  });

  it("uses a low-opacity cursor and highlights the hovered bar", () => {
    setupChart();
    for (const cursor of screen.getAllByTestId("tooltip-cursor")) {
      expect(JSON.parse(cursor.textContent ?? "")).toEqual({ fill: "var(--color-accent)", fillOpacity: 0.12 });
    }
    for (const bar of screen.getAllByTestId("active-bar")) {
      expect(JSON.parse(bar.textContent ?? "")).toEqual({ fill: "var(--color-accent-light)" });
    }
  });
});

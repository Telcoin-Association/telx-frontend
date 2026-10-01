import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import ChartTabs, { ANNOUNCE_DELAY_MS } from "./ChartTabs";
import { openAddLiquidity } from "@/lib/poolPageEvents";

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
        <button onClick={() => onActivePointChange?.({ date: "2026-09-23", value: 1_234_567.891 })}>hover-large</button>
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

  it("follows the hovered bar in the headline and returns to the current value on leave", () => {
    render(<ChartTabs totalLiquidity={145171.7} liquidityWeights={[1, 2]} liquidityLabels={["2026-09-25", "2026-09-24"]} />);
    expect(screen.getByText("$145,171.70")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByTestId("metric")).toHaveTextContent("TVL");

    fireEvent.click(screen.getByText("hover"));
    expect(screen.getByText("$92,262.87")).toBeInTheDocument();
    expect(screen.getByText("Sep 24, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("leave"));
    expect(screen.getByText("$145,171.70")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows a hovered bar of $1M or more to the cent, as the tooltip does", () => {
    render(<ChartTabs totalLiquidity={10} liquidityWeights={[1, 2]} liquidityLabels={["2026-09-25", "2026-09-24"]} />);
    fireEvent.click(screen.getByText("hover-large"));
    expect(screen.getByText("$1,234,567.89")).toBeInTheDocument();
  });

  it("captions the resting volume and fees as the last 24 hours", () => {
    render(<ChartTabs totalLiquidity={10} dailyVolume={20} liquidityWeights={[1]} liquidityLabels={["2026-09-25"]} volumeWeights={[2]} volumeLabels={["2026-09-25"]} />);
    fireEvent.click(screen.getByText("Daily Volume"));
    expect(screen.getByText("Last 24 hours")).toBeInTheDocument();
  });

  it("announces the selected bar with its metric once, after the selection settles, and never on every bar", () => {
    jest.useFakeTimers();
    try {
      render(<ChartTabs totalLiquidity={10} liquidityWeights={[1, 2]} liquidityLabels={["2026-09-25", "2026-09-24"]} />);
      const region = screen.getByRole("status");
      expect(within(region).queryByText("$10.00")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("hover"));
      fireEvent.click(screen.getByText("hover-large"));
      act(() => {
        jest.advanceTimersByTime(ANNOUNCE_DELAY_MS - 1);
      });
      expect(region).toBeEmptyDOMElement();
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(region).toHaveTextContent("TVL on Sep 23, 2026: $1,234,567.89");

      fireEvent.click(screen.getByText("leave"));
      expect(region).toBeEmptyDOMElement();
    } finally {
      jest.useRealTimers();
    }
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

describe("ChartTabs Add liquidity tab", () => {
  const card = (addLiquidity?: React.ReactNode) => (
    <ChartTabs totalLiquidity={1000} liquidityWeights={[1, 2]} liquidityLabels={["2026-09-24", "2026-09-25"]} addLiquidity={addLiquidity} />
  );
  const addTab = () => screen.getByRole("button", { name: /Add liquidity/ });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("is offered only when there is something to add liquidity to", () => {
    render(card());
    expect(screen.queryByRole("button", { name: /Add liquidity/ })).not.toBeInTheDocument();
  });

  it("swaps the chart for the add form in the same card, and a metric tab swaps it back", () => {
    render(card(<p>add form</p>));
    expect(addTab()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(addTab());
    expect(screen.getByText("add form")).toBeInTheDocument();
    expect(screen.queryByText("chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(addTab()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByText("TVL"));
    expect(screen.getByText("chart")).toBeInTheDocument();
    expect(screen.queryByText("add form")).not.toBeInTheDocument();
  });

  it("opens from the page's #add-liquidity link, on load and when the hash changes", () => {
    window.history.replaceState(null, "", "/#add-liquidity");
    const { unmount } = render(card(<p>add form</p>));
    expect(screen.getByText("add form")).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/");
    render(card(<p>add form</p>));
    expect(screen.queryByText("add form")).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, "", "/#add-liquidity");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByText("add form")).toBeInTheDocument();
  });

  it("opens when the button under the positions list asks for it", () => {
    render(card(<p>add form</p>));
    act(() => openAddLiquidity());
    expect(screen.getByText("add form")).toBeInTheDocument();
  });
});

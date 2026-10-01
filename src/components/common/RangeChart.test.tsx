import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import RangeChart from "./RangeChart";
import { priceAtTick, type TickRange } from "../../lib/v4/range";

// jsdom has no PointerEvent; a MouseEvent carries the clientX the drag reads.
beforeAll(() => {
  if (!("PointerEvent" in window)) Object.assign(window, { PointerEvent: MouseEvent });
});

const WINDOW = { tickLower: -6_000, tickUpper: 6_000 };
const RANGE = { tickLower: -1_200, tickUpper: 1_200 };
const SEGMENTS = [
  { tickLower: -6_000, tickUpper: -1_200, liquidity: 10n },
  { tickLower: -1_200, tickUpper: 1_200, liquidity: 40n },
  { tickLower: 1_200, tickUpper: 6_000, liquidity: 0n },
];

function renderChart(overrides: Partial<React.ComponentProps<typeof RangeChart>> = {}) {
  const onChange = jest.fn<void, [TickRange]>();
  const onDragging = jest.fn<void, [boolean]>();
  const utils = render(
    <RangeChart
      segments={SEGMENTS}
      window={WINDOW}
      currentTick={0}
      range={RANGE}
      fullRange={false}
      tickSpacing={60}
      decimals={[18, 18]}
      priceUnit="TEL per WETH"
      onChange={onChange}
      onDragging={onDragging}
      {...overrides}
    />,
  );
  return { ...utils, onChange, onDragging };
}

describe("RangeChart", () => {
  it("draws a bar per liquidity segment, scaled to the largest", () => {
    renderChart();
    const bars = screen.getAllByTestId("liquidity-bar");
    expect(bars).toHaveLength(3);
    expect(Number(bars[1].getAttribute("height"))).toBeGreaterThan(Number(bars[0].getAttribute("height")));
    expect(Number(bars[2].getAttribute("height"))).toBe(0);
  });

  it("says when the liquidity is still being read", () => {
    renderChart({ segments: null });
    expect(screen.getByText("Reading the pool's liquidity...")).toBeInTheDocument();
  });

  it("names each handle's price for assistive technology", () => {
    renderChart();
    expect(screen.getByRole("slider", { name: "Min price" })).toHaveAttribute("aria-valuetext", expect.stringMatching(/TEL per WETH$/));
    expect(screen.getByRole("slider", { name: "Max price" })).toHaveAttribute("aria-valuenow", "1200");
  });

  it("moves a handle one tick spacing per arrow key and ten per page key", () => {
    const { onChange } = renderChart();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Min price" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ tickLower: -1_260, tickUpper: 1_200 });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Max price" }), { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith({ tickLower: -1_200, tickUpper: 600 });
  });

  it("keeps the lower handle below the upper one", () => {
    const { onChange } = renderChart({ range: { tickLower: 0, tickUpper: 60 } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Min price" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ tickLower: 0, tickUpper: 60 });
  });

  it("drags a handle to the price under the pointer, aligned to the tick spacing", () => {
    const { onChange, onDragging } = renderChart();
    const area = screen.getByTestId("range-chart-area");
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 160, right: 1000, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    const handle = screen.getByRole("slider", { name: "Max price" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
    expect(onDragging).toHaveBeenLastCalledWith(true);
    // Three quarters of the way along a linear price axis.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 750 });
    const { tickUpper } = onChange.mock.calls.at(-1)![0];
    const low = priceAtTick(WINDOW.tickLower, 18, 18);
    const high = priceAtTick(WINDOW.tickUpper, 18, 18);
    expect(Math.abs(tickUpper % 60)).toBe(0);
    expect(priceAtTick(tickUpper, 18, 18)).toBeCloseTo(low + 0.75 * (high - low), 1);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onDragging).toHaveBeenLastCalledWith(false);
  });

  it("hides the handles for a full range", () => {
    renderChart({ fullRange: true });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByText("Full range: the position earns at every price.")).toBeInTheDocument();
  });
});

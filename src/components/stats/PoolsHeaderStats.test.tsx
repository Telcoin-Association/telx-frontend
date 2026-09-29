import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PoolsHeaderStats from "./PoolsHeaderStats";

jest.mock("../common/LoadingAnimationCircle", () => function LoadingAnimation() {
  return <span data-testid="spinner" />;
});


// The tooltip trigger whose visible text starts with `text`: the element that carries aria-describedby.
const describedTrigger = (text: string) =>
  screen.getByText((_, el) => !!el?.hasAttribute("aria-describedby") && !!el.textContent?.startsWith(text));

describe("PoolsHeaderStats", () => {
  it("renders zero totals as currency", () => {
    render(<PoolsHeaderStats totalLiquidity={0} stakedLiquidity={0} totalVolume={0} totalFees={0} />);
    expect(screen.getAllByText("$0.00")).toHaveLength(4);
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });

  it("shows the spinner only for null totals", () => {
    render(<PoolsHeaderStats totalLiquidity={1234.5} stakedLiquidity={null} totalVolume={0} totalFees={null} />);
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getAllByTestId("spinner")).toHaveLength(2);
  });

  it("marks each shown total as partial with the note on hover, and leaves missing ones alone", () => {
    const note = "Partial total: excludes Polygon pools, whose data is unavailable";
    render(<PoolsHeaderStats totalLiquidity={10} stakedLiquidity={null} totalVolume={0} totalFees={1} unavailable partialNote={note} />);
    expect(screen.getAllByText("partial")).toHaveLength(3);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    const trigger = describedTrigger("$10.00");
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAccessibleDescription(note);
  });

  it("shows no partial marker without a note", () => {
    render(<PoolsHeaderStats totalLiquidity={10} stakedLiquidity={5} totalVolume={0} totalFees={1} partialNote={null} />);
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows Unavailable instead of a spinner once the load has failed for good", () => {
    render(<PoolsHeaderStats totalLiquidity={null} stakedLiquidity={null} totalVolume={null} totalFees={null} unavailable />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PoolsHeaderStats from "./PoolsHeaderStats";

jest.mock("../common/LoadingAnimationCircle", () => function LoadingAnimation() {
  return <span data-testid="spinner" />;
});



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

  it("marks each shown total as partial with a named button described by the note, and leaves missing ones alone", () => {
    const note = "Partial total: excludes Polygon pools, whose data is unavailable";
    render(<PoolsHeaderStats totalLiquidity={10} stakedLiquidity={null} totalVolume={0} totalFees={1} unavailable partialNote={note} />);
    expect(screen.getAllByText("partial")).toHaveLength(3);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    // The marker, not the value, is the control, and it says which total it qualifies.
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    expect(trigger).toHaveAccessibleDescription(note);
    expect(trigger).not.toHaveTextContent("$10.00");
    expect(screen.getByRole("button", { name: "Fees (24hr): partial total" })).toBeInTheDocument();
  });

  it("shows no partial marker without a note", () => {
    render(<PoolsHeaderStats totalLiquidity={10} stakedLiquidity={5} totalVolume={0} totalFees={1} partialNote={null} />);
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
  });

  it("shows Unavailable instead of a spinner once the load has failed for good", () => {
    render(<PoolsHeaderStats totalLiquidity={null} stakedLiquidity={null} totalVolume={null} totalFees={null} unavailable />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });
});

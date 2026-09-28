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

  it("shows Unavailable instead of a spinner once the load has failed for good", () => {
    render(<PoolsHeaderStats totalLiquidity={null} stakedLiquidity={null} totalVolume={null} totalFees={null} unavailable />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });
});

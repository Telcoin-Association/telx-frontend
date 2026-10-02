import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PoolSnapshotAssets, { ALIGNED_CHIP_CLASS } from "./PoolSnapshotAssets";

jest.mock("./PoolWeightChip", () => function MockPoolWeightChip({ asset, className }: { asset: { ticker: string }; className?: string }) {
  return <div data-testid="chip" className={className ?? ""}>{asset.ticker}</div>;
});

const assets = [
  { ticker: "eUSD", weight: NaN },
  { ticker: "TEL", weight: NaN },
];

describe("PoolSnapshotAssets", () => {
  it("gives every chip in a list row the same minimum width, so the second token lines up across rows", () => {
    render(<PoolSnapshotAssets assets={assets} />);
    const chips = screen.getAllByTestId("chip");
    expect(chips).toHaveLength(2);
    chips.forEach(chip => expect(chip).toHaveClass(ALIGNED_CHIP_CLASS));
  });

  it("keeps natural widths in the inline heading", () => {
    render(<PoolSnapshotAssets flex assets={assets} />);
    screen.getAllByTestId("chip").forEach(chip => expect(chip).not.toHaveClass(ALIGNED_CHIP_CLASS));
  });
});

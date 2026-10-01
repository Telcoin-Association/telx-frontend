import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PoolsMain from "./PoolsMain";
import { getPoolMapKey } from "../../lib/contracts";
import type { miningContractFields } from "../../helpers/normalizeMiningContracts";

const mockContracts: { value: Record<string, unknown> } = { value: {} };
jest.mock("../../redux/hooks", () => ({ useAppSelector: () => mockContracts.value }));
jest.mock("../../hooks/useNow", () => ({ useNow: () => Date.UTC(2026, 9, 1, 12) }));
jest.mock("../pool/PoolSnapshot", () => function MockPoolSnapshot({ contractData }: { contractData: { poolContractAddress: string } }) {
  return <div data-testid="row">{contractData.poolContractAddress}</div>;
});
jest.mock("../pool/PoolListSkeleton", () => function MockPoolListSkeleton() {
  return <div>skeleton</div>;
});
jest.mock("../common/HelpTip", () => function MockHelpTip() {
  return null;
});
jest.mock("next/image", () => function MockImage() {
  return null;
});

const entry = (address: string, blockchain: string): miningContractFields =>
  ({ attributes: { pool_address: address, blockchain, protocol: "uniswap", active: true } }) as unknown as miningContractFields;

const registry = [entry("0xeth", "ethereum"), entry("0xbase-live", "base"), entry("0xbase", "base"), entry("0xpolygon", "polygon")];

beforeEach(() => {
  const loaded = (address: string, blockchain: string, fields: Record<string, unknown> = {}) => ({
    [getPoolMapKey(address, blockchain, "uniswap")]: { poolContractAddress: address, blockchain, protocol: "uniswap", totalLiquidity: 100, ...fields },
  });
  mockContracts.value = {
    ...loaded("0xeth", "ethereum", { totalLiquidity: 900, dailyVolumeUSD: 30 }),
    ...loaded("0xbase-live", "base", { rewardsStatus: "LIVE", rewardsApr: 90, dailyVolumeUSD: 10 }),
    ...loaded("0xbase", "base", { totalLiquidity: 50, dailyVolumeUSD: 20 }),
    ...loaded("0xpolygon", "polygon", { totalLiquidity: 300, dailyVolumeUSD: null }),
  };
});

const rows = () => screen.getAllByTestId("row").map((row) => row.textContent);

describe("PoolsMain", () => {
  it("lists Polygon, then Base, then Ethereum, with a live Base campaign first within Base", () => {
    render(<PoolsMain pools={registry} />);
    expect(rows()).toEqual(["0xpolygon", "0xbase-live", "0xbase", "0xeth"]);
  });

  it("filters by chain with counted chips, and by live rewards", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    expect(screen.getByRole("button", { name: "Base (2)" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Base (2)" }));
    expect(rows()).toEqual(["0xbase-live", "0xbase"]);

    await user.click(screen.getByRole("button", { name: "Live rewards only" }));
    expect(rows()).toEqual(["0xbase-live"]);
    expect(screen.getByRole("button", { name: "All (1)" })).toBeInTheDocument();
  });

  it("offers to show all pools when the filters match none", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.click(screen.getByRole("button", { name: "Ethereum (1)" }));
    await user.click(screen.getByRole("button", { name: "Live rewards only" }));
    expect(screen.getByText("No pools match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all pools" }));
    expect(rows()).toHaveLength(4);
  });

  it("sorts by a column highest first, then lowest first, then back to the default order", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);

    await user.click(screen.getByRole("button", { name: "Sort by TVL, highest first" }));
    expect(rows()).toEqual(["0xeth", "0xpolygon", "0xbase-live", "0xbase"]);

    await user.click(screen.getByRole("button", { name: "TVL, sorted highest first. Sort lowest first" }));
    expect(rows()).toEqual(["0xbase", "0xbase-live", "0xpolygon", "0xeth"]);

    await user.click(screen.getByRole("button", { name: "TVL, sorted lowest first. Return to the default order" }));
    expect(rows()).toEqual(["0xpolygon", "0xbase-live", "0xbase", "0xeth"]);
  });

  it("sorts unknown values last", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.click(screen.getByRole("button", { name: "Sort by Volume (24hr), highest first" }));
    expect(rows()).toEqual(["0xeth", "0xbase", "0xbase-live", "0xpolygon"]);
  });
});

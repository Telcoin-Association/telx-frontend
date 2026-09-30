import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PoolsMain from "./PoolsMain";
import { getPoolMapKey } from "../../lib/contracts";
import type { miningContractFields } from "../../helpers/normalizeMiningContracts";

const mockContracts: { value: Record<string, unknown> } = { value: {} };
jest.mock("../../redux/hooks", () => ({ useAppSelector: () => mockContracts.value }));
jest.mock("../../hooks/useNow", () => ({ useNow: () => Date.UTC(2026, 8, 30, 12) }));
jest.mock("../pool/PoolSnapshot", () => function MockPoolSnapshot({ contractData }: { contractData: { poolContractAddress: string } }) {
  return <div data-testid="row">{contractData.poolContractAddress}</div>;
});
jest.mock("../pool/PoolSnapshotLabels", () => function MockPoolSnapshotLabels() {
  return <div>labels</div>;
});
jest.mock("../pool/PoolListSkeleton", () => function MockPoolListSkeleton() {
  return <div>skeleton</div>;
});

const entry = (address: string, blockchain: string): miningContractFields =>
  ({ attributes: { pool_address: address, blockchain, protocol: "uniswap", active: true } }) as unknown as miningContractFields;

describe("PoolsMain", () => {
  it("lists live campaigns first and Base above Ethereum, whatever the registry order", () => {
    const registry = [entry("0xeth", "ethereum"), entry("0xbase", "base"), entry("0xlive", "ethereum"), entry("0xpolygon", "polygon")];
    const loaded = (address: string, blockchain: string, fields: Record<string, unknown> = {}) => ({
      [getPoolMapKey(address, blockchain, "uniswap")]: { poolContractAddress: address, blockchain, totalLiquidity: 100, ...fields },
    });
    mockContracts.value = {
      ...loaded("0xeth", "ethereum"),
      ...loaded("0xbase", "base"),
      ...loaded("0xlive", "ethereum", { rewardsStatus: "LIVE", rewardsApr: 90 }),
      ...loaded("0xpolygon", "polygon"),
    };
    render(<PoolsMain pools={registry} />);
    expect(screen.getAllByTestId("row").map((row) => row.textContent)).toEqual(["0xlive", "0xpolygon", "0xbase", "0xeth"]);
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import PortfolioPoolPositions, { type PortfolioPool } from "./PortfolioPoolPositions";
import { MERKL_POLYGON_WETH_TEL_POOLID } from "@/lib/contracts";
import type { Position } from "@/lib/positions";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const READY = { status: "ready", rewards: { positions: {} } };
const ESTIMATES = { perToken: { "101": 0.01 }, all: null };
const mockRewardsCalls: unknown[][] = [];
const mockEstimateCalls: Array<{ targets: unknown[]; owner: unknown }> = [];
const mockListProps: Array<Record<string, unknown>> = [];
const mockCollect = jest.fn();

jest.mock("wagmi", () => ({ useAccount: () => ({ address: "0x00000000000000000000000000000000000000Aa" }) }));
jest.mock("../../hooks/usePositionRewards", () => ({
  usePoolRewards: (...args: unknown[]) => {
    mockRewardsCalls.push(args);
    return { status: "ready", rewards: { positions: {} } };
  },
}));
jest.mock("../../hooks/useCollectEstimates", () => ({
  useCollectEstimates: (args: { targets: unknown[]; owner: unknown }) => {
    mockEstimateCalls.push(args);
    return { perToken: { "101": 0.01 }, all: null };
  },
}));
jest.mock("../../hooks/usePositionActions", () => ({
  usePositionActions: () => ({ pending: null, results: {}, subscribeNeedsInRange: false, subscribe: jest.fn(), unsubscribe: jest.fn(), collect: mockCollect }),
}));
jest.mock("../common/ChainLogo", () => function MockChainLogo() {
  return null;
});
jest.mock("../common/PositionsList", () => function MockPositionsList(props: Record<string, unknown>) {
  mockListProps.push(props);
  return null;
});

const Q96 = (2n ** 96n).toString();
const withFees: Position = {
  tokenId: "101",
  isSubscribed: true,
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amounts: { amount0: "1", amount1: "1", sqrtPriceX96: Q96 },
  price: { price1Per0: 1, price0Per1: 1 },
  fees: { amount0: "0.001", amount1: "5" },
};

const pool = (poolContractAddress: string): PortfolioPool => ({
  poolContractAddress,
  blockchain: "polygon",
  assets: [{ ticker: "WETH", address: null }, { ticker: "TEL", address: null }],
});

describe("PortfolioPoolPositions rows", () => {
  beforeEach(() => {
    mockRewardsCalls.length = 0;
    mockEstimateCalls.length = 0;
    mockListProps.length = 0;
  });

  it("gives Portfolio's rows the same TELx rewards, fee estimates and collect action as the pool page", () => {
    render(<PortfolioPoolPositions pool={pool(MERKL_POLYGON_WETH_TEL_POOLID)} positions={[withFees]} rates={undefined} onConfirmed={jest.fn()} />);
    const props = mockListProps.at(-1)!;
    expect(mockRewardsCalls.at(-1)).toEqual(["polygon", MERKL_POLYGON_WETH_TEL_POOLID, true]);
    expect(props.rewards).toEqual(READY);
    expect(props.poolId).toBe(MERKL_POLYGON_WETH_TEL_POOLID);
    expect(props.onCollect).toBe(mockCollect);
    expect(props.collectEstimates).toEqual(ESTIMATES);
    expect(mockEstimateCalls.at(-1)).toMatchObject({ owner: OWNER, targets: [expect.objectContaining({ tokenId: "101" })] });
  });

  it("shows no TELx rewards for a pool outside the Merkl program, and doesn't read them", () => {
    render(<PortfolioPoolPositions pool={pool("0xlegacy")} positions={[withFees]} rates={undefined} onConfirmed={jest.fn()} />);
    expect(mockListProps.at(-1)!.rewards).toBeUndefined();
    expect(mockRewardsCalls.at(-1)?.[2]).toBe(false);
  });
});

import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import PortfolioPoolPositions, { portfolioPoolName, type PortfolioPool } from "./PortfolioPoolPositions";

// Each hook instance records the pool it was created for, and its actions report that pool back.
const mockSent: { blockchain: string | undefined; poolId: string | undefined; tokenId: string; action: string }[] = [];

jest.mock("wagmi", () => ({ useAccount: () => ({ address: undefined }) }));
jest.mock("../../hooks/usePositionRewards", () => ({ usePoolRewards: () => ({ status: "loading" }) }));
jest.mock("../../hooks/useCollectEstimates", () => ({ useCollectEstimates: () => ({ perToken: {}, all: null }) }));
jest.mock("../../hooks/usePositionActions", () => ({
  usePositionActions: ({ blockchain, poolId }: { blockchain: string | undefined; poolId: string | undefined }) => ({
    pending: null,
    results: {},
    subscribeNeedsInRange: false,
    subscribe: (tokenId: string) => mockSent.push({ blockchain, poolId, tokenId, action: "subscribe" }),
    unsubscribe: (tokenId: string) => mockSent.push({ blockchain, poolId, tokenId, action: "unsubscribe" }),
  }),
}));
jest.mock("../common/ChainLogo", () => function MockChainLogo() {
  return null;
});
jest.mock("../common/PositionsList", () => function MockPositionsList({
  title,
  onSubscribe,
  onUnsubscribe,
}: {
  title: React.ReactNode;
  onSubscribe: (tokenId: string) => void;
  onUnsubscribe: (tokenId: string) => void;
}) {
  return (
    <section>
      <h3>{title}</h3>
      <button onClick={() => onSubscribe("1")}>subscribe</button>
      <button onClick={() => onUnsubscribe("2")}>unsubscribe</button>
    </section>
  );
});

const POOLS: PortfolioPool[] = [
  { poolContractAddress: "0xpolygon", blockchain: "polygon", assets: [{ ticker: "WETH", address: null }, { ticker: "TEL", address: null }] },
  { poolContractAddress: "0xbase", blockchain: "base", assets: [{ ticker: "ETH", address: null }, { ticker: "TEL", address: null }] },
  { poolContractAddress: "0xethereum", blockchain: "ethereum", assets: [{ ticker: "eUSD", address: null }, { ticker: "TEL", address: null }] },
];

describe("PortfolioPoolPositions", () => {
  beforeEach(() => {
    mockSent.length = 0;
  });

  it("sends each group's actions for its own pool and chain when groups on all three chains sit side by side", () => {
    render(
      <>
        {POOLS.map((pool) => (
          <PortfolioPoolPositions key={pool.blockchain} pool={pool} positions={[]} rates={undefined} onConfirmed={jest.fn()} />
        ))}
      </>,
    );

    const subscribes = screen.getAllByRole("button", { name: "subscribe" });
    const unsubscribes = screen.getAllByRole("button", { name: "unsubscribe" });
    fireEvent.click(subscribes[1]);
    fireEvent.click(unsubscribes[2]);
    fireEvent.click(subscribes[0]);

    expect(mockSent).toEqual([
      { blockchain: "base", poolId: "0xbase", tokenId: "1", action: "subscribe" },
      { blockchain: "ethereum", poolId: "0xethereum", tokenId: "2", action: "unsubscribe" },
      { blockchain: "polygon", poolId: "0xpolygon", tokenId: "1", action: "subscribe" },
    ]);
  });

  it("names each group after its tokens and chain, and links to its pool page", () => {
    render(<PortfolioPoolPositions pool={POOLS[1]} positions={[]} rates={undefined} onConfirmed={jest.fn()} />);
    expect(screen.getByRole("link", { name: "ETH/TEL on Base" })).toBeInTheDocument();
    expect(portfolioPoolName({ assets: [], blockchain: "" })).toBe("Uniswap v4 pool");
  });
});

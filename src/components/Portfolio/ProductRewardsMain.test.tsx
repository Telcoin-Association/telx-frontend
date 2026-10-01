import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductRewardsMain from "./ProductRewardsMain";
jest.mock("./UsdceConvertCard", () => function MockUsdceConvertCard() {
  return null;
});
jest.mock("./LegacyTelUpgradeCard", () => function MockLegacyTelUpgradeCard({ legacyClaimableTel }: { legacyClaimableTel: number | null }) {
  return <div data-testid="legacy-tel-card">{String(legacyClaimableTel)}</div>;
});
jest.mock("../common/AddTokenToWallet", () => function MockAddTokenToWallet({ token }: { token: { symbol: string } }) {
  return <span data-testid="add-token-to-wallet">{`add ${token.symbol}`}</span>;
});

const OWNER = "0x00000000000000000000000000000000000000aa";
const WETH_TEL = "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";

const mockState: { contracts: Record<string, any> } = { contracts: {} };
const mockWallet: { address: string | undefined } = { address: OWNER };
const mockFetchMerkl = jest.fn();

jest.mock("../../redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));
jest.mock("../../redux/slices/contractsSlice", () => ({
  contractsLoadingSelector: (s: any) => s.contracts.loading,
  hasFetchedDataSelector: (s: any) => s.contracts.hasFetchedData,
  userContractsSelector: (s: any) => s.contracts.userContracts,
  deprecatedPoolsListSelector: (s: any) => s.contracts.deprecatedPools,
  userUniswapContractsSelector: (s: any) => s.contracts.userUniswapContracts,
}));
jest.mock("wagmi", () => ({ useAccount: () => ({ address: mockWallet.address }) }));
// GET /api/market-rate sends each price as a numeric string.
const mockRates: { data: Record<string, { USD: string }> } = { data: {} };
jest.mock("../../redux/slices/marketRateSlice", () => ({
  useGetMarketRateQuery: () => ({ data: mockRates.data, isLoading: false }),
}));
jest.mock("../../merkl/merklService", () => ({ fetchMerklRewards: (...args: unknown[]) => mockFetchMerkl(...args) }));
jest.mock("../../merkl/merklUtils", () => ({ formatMerklTokenAmount: (amount: string) => amount }));
jest.mock("../../hooks/usePositionTransferWatch", () => ({ usePositionTransferWatch: jest.fn() }));
jest.mock("../layout/CustomConnectButton", () => ({
  CustomConnectButton: function CustomConnectButton() {
    return <button type="button">Connect</button>;
  },
}));
jest.mock("../common/LoadingWrapper", () => function LoadingWrapper() {
  return <p>Loading portfolio</p>;
});
jest.mock("../../merkl/MerklClaimCard", () => function MerklClaimCard({ blockchain }: { blockchain: string }) {
  return <div data-testid="merkl-card">{blockchain}</div>;
});
jest.mock("./UnclaimedUniswapRewardsCard", () => function UnclaimedUniswapRewardsCard({ blockchain, uniswapRewards }: { blockchain: string; uniswapRewards: number | null }) {
  return <div data-testid="old-pool-card">{`${blockchain}:${uniswapRewards ?? "Unavailable"}`}</div>;
});
jest.mock("./UnclaimedRewardsCard", () => function UnclaimedRewardsCard({ contractData }: { contractData: any }) {
  return <div data-testid="deprecated-rewards-card">{contractData.poolContractAddress}</div>;
});
jest.mock("./CardRewards", () => function CardRewards({ contractData }: { contractData: any }) {
  return <div data-testid="lpt-card">{contractData.poolContractAddress}</div>;
});
jest.mock("./PortfolioPoolPositions", () => ({
  __esModule: true,
  // "Confirm subscribe of 2" stands in for a confirmed row action: the row reports its new status, and the
  // page reads the chain's positions again.
  default: function PortfolioPoolPositions({
    pool,
    positions,
    onConfirmed,
    onConfirmedStatuses,
  }: {
    pool: any;
    positions: any[];
    onConfirmed: (blockNumber: number | undefined) => void;
    onConfirmedStatuses?: (statuses: Record<string, boolean>) => void;
  }) {
    return (
      <div>
        <span data-testid="pool-positions">{`${pool.blockchain}:${pool.poolContractAddress}:${positions.length}`}</span>
        <button
          type="button"
          onClick={() => {
            onConfirmedStatuses?.({ "2": true });
            onConfirmed(5);
          }}
        >
          Confirm subscribe of 2
        </button>
      </div>
    );
  },
}));

const uniswapPool = (poolContractAddress: string, blockchain: string, assets: any[]) => ({
  poolContractAddress,
  blockchain,
  protocol: "uniswap",
  assets,
  decimals: { amount0Decimals: 18, amount1Decimals: 18 },
});
const WETH = { ticker: "WETH", address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619" };
const TEL = { ticker: "TEL", address: "0xe0000000000000000000000000000000000000e1" };

const position = (tokenId: string, isSubscribed: boolean, liquidity = "1000") => ({
  tokenId,
  isSubscribed,
  tickLower: -100,
  tickUpper: 100,
  liquidity,
  amounts: { amount0: "1", amount1: "2000", sqrtPriceX96: "0" },
  price: { price1Per0: 2000 },
});

type Responses = {
  positions?: Partial<Record<string, { status: number; pools?: Record<string, { positions: any[] }> }>>;
  oldRewards?: { status: number; claimableAmount?: Record<string, string | null> };
};

let fetchMock: jest.Mock;
function mockFetch({ positions = {}, oldRewards = { status: 200, claimableAmount: { base: "0", polygon: "0", ethereum: "0" } } }: Responses) {
  fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith("/api/positions")) {
      const chain = new URL(url, "http://x").searchParams.get("chain")!;
      const reply = positions[chain] ?? { status: 200, pools: {} };
      return { ok: reply.status === 200, status: reply.status, json: async () => ({ chain, owner: OWNER, blockNumber: 1, truncated: false, pools: reply.pools ?? {} }) };
    }
    if (url.startsWith("/api/uniswap-user-rewards")) {
      return { ok: oldRewards.status === 200, status: oldRewards.status, json: async () => ({ claimableAmount: oldRewards.claimableAmount }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

const merklResult = (claimable: string, pending: string) => ({
  isEmpty: claimable === "0" && pending === "0",
  summary: { rewards: [{ tokenDecimals: 18 }], totalClaimable: claimable, totalPending: pending },
});

function setState(overrides: Record<string, unknown> = {}) {
  mockState.contracts = {
    loading: false,
    hasFetchedData: true,
    userContracts: {},
    deprecatedPools: {},
    userUniswapContracts: [uniswapPool(WETH_TEL, "polygon", [TEL, WETH]), uniswapPool(EUSD_TEL, "base", [TEL, { ticker: "eUSD", address: "0x1" }])],
    ...overrides,
  };
}

const renderPage = () => render(<ProductRewardsMain defaultRewards={{}} />);

beforeEach(() => {
  mockRates.data = { WETH: { USD: "3000.000000" }, TEL: { USD: "0.005000" } };
  mockWallet.address = OWNER;
  setState();
  mockFetchMerkl.mockReset();
  mockFetchMerkl.mockResolvedValue(merklResult("0", "0"));
  mockFetch({});
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe("ProductRewardsMain", () => {
  it("asks for a wallet when none is connected", () => {
    mockWallet.address = undefined;
    renderPage();
    expect(screen.getByText("Connect your wallet to see your positions and rewards.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("leads with the summary and lists positions grouped by pool, expanded", async () => {
    mockFetch({
      positions: {
        polygon: { status: 200, pools: { [WETH_TEL]: { positions: [position("1", true), position("2", false), position("3", false, "0")] } } },
      },
    });
    renderPage();

    const summary = screen.getByRole("region", { name: "Portfolio summary" });
    expect(await within(summary).findByText("1 of 2")).toBeInTheDocument();
    // Two open positions of 1 WETH ($3000) and 2000 TEL ($10) each.
    expect(within(summary).getByText("$6,020.00")).toBeInTheDocument();
    expect(screen.getAllByTestId("pool-positions").map(el => el.textContent)).toEqual([`polygon:${WETH_TEL}:3`]);
  });

  it("reads Unavailable, not $0, when open positions have no price", async () => {
    mockRates.data = {};
    mockFetch({
      positions: {
        polygon: { status: 200, pools: { [WETH_TEL]: { positions: [position("1", true), position("2", false)] } } },
      },
    });
    renderPage();

    const summary = screen.getByRole("region", { name: "Portfolio summary" });
    expect(await within(summary).findByText("1 of 2")).toBeInTheDocument();
    expect(within(summary).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(within(summary).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("offers a retry instead of reading a failed positions request as no positions", async () => {
    const user = userEvent.setup();
    mockFetch({ positions: { base: { status: 502 } } });
    renderPage();

    expect(await screen.findByText("Your positions on Base could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("You have no Uniswap v4 positions in TELx pools yet.")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Portfolio summary" })).getByText("partial")).toBeInTheDocument();

    mockFetch({ positions: { base: { status: 200, pools: { [EUSD_TEL]: { positions: [position("9", true)] } } } } });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("pool-positions")).toHaveTextContent(`base:${EUSD_TEL}:1`);
    expect(screen.queryByText("Your positions on Base could not be loaded.")).not.toBeInTheDocument();
  });

  it("keeps rows from an earlier read when a refresh fails, and says they may be out of date", async () => {
    const user = userEvent.setup();
    mockFetch({ positions: { base: { status: 200, pools: { [EUSD_TEL]: { positions: [position("9", true)] } } } } });
    renderPage();
    expect(await screen.findByTestId("pool-positions")).toHaveTextContent(`base:${EUSD_TEL}:1`);

    mockFetch({ positions: { base: { status: 502 } } });
    await user.click(screen.getByRole("button", { name: "Confirm subscribe of 2" }));

    expect(await screen.findByText("Your positions on Base could not be refreshed. Those below may be out of date.")).toBeInTheDocument();
    expect(screen.queryByText("Your positions on Base could not be loaded.")).not.toBeInTheDocument();
    expect(screen.getByTestId("pool-positions")).toHaveTextContent(`base:${EUSD_TEL}:1`);
  });

  it("moves focus to the chain's positions after Try again, and keeps it there when the read succeeds", async () => {
    const user = userEvent.setup();
    mockFetch({ positions: { base: { status: 502 } } });
    renderPage();
    await screen.findByText("Your positions on Base could not be loaded.");

    mockFetch({ positions: { base: { status: 200, pools: { [EUSD_TEL]: { positions: [position("9", true)] } } } } });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("pool-positions");
    expect(screen.getByTestId("positions-base")).toHaveFocus();
  });

  it("counts a row's confirmed status in the summary before the positions are read again", async () => {
    const user = userEvent.setup();
    mockFetch({
      positions: { polygon: { status: 200, pools: { [WETH_TEL]: { positions: [position("1", true), position("2", false)] } } } },
    });
    renderPage();
    const summary = screen.getByRole("region", { name: "Portfolio summary" });
    expect(await within(summary).findByText("1 of 2")).toBeInTheDocument();

    // The follow-up read still returns the old status; the summary follows the row.
    await user.click(screen.getByRole("button", { name: "Confirm subscribe of 2" }));
    expect(await within(summary).findByText("2 of 2")).toBeInTheDocument();
  });

  it("keeps the page on screen during a later load, such as after a deprecated claim", async () => {
    mockFetch({ positions: { polygon: { status: 200, pools: { [WETH_TEL]: { positions: [position("1", true)] } } } } });
    const { rerender } = renderPage();
    await screen.findByTestId("pool-positions");

    setState({ loading: true, hasFetchedData: true });
    rerender(<ProductRewardsMain defaultRewards={{}} />);
    expect(screen.queryByText("Loading portfolio")).not.toBeInTheDocument();
    expect(screen.getByTestId("pool-positions")).toBeInTheDocument();
  });

  it("shows the loader only before the first load", () => {
    setState({ loading: true, hasFetchedData: false });
    renderPage();
    expect(screen.getByText("Loading portfolio")).toBeInTheDocument();
  });

  it("never shows another wallet's legacy stakes or rewards", async () => {
    const other = {
      poolContractAddress: "0xother",
      blockchain: "polygon",
      protocol: "balancer",
      selectedWalletAddress: "0x00000000000000000000000000000000000000bb",
      user: { stakedLPT: "10" },
      rewards: [{ ticker: "TEL", unclaimed: "40" }],
    };
    setState({ userContracts: { a: other }, deprecatedPools: { a: other } });
    renderPage();
    await screen.findByText("You have no Uniswap v4 positions in TELx pools yet.");
    expect(screen.queryByText("Balancer Claimable Rewards (deprecated)")).not.toBeInTheDocument();
    expect(screen.queryByText("Your LPT stakes (deprecated)")).not.toBeInTheDocument();
  });

  it("links to the pools when the wallet has no positions", async () => {
    renderPage();
    expect(await screen.findByText("You have no Uniswap v4 positions in TELx pools yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse pools" })).toHaveAttribute("href", "/pools");
  });

  it("shows a Merkl card only for chains with claimable or pending TEL, or whose read failed", async () => {
    mockFetchMerkl.mockImplementation(async (_owner: string, chainId: number) => {
      if (chainId === 1) return merklResult("0", "0");
      if (chainId === 8453) return merklResult("0", "25");
      throw new Error("Merkl down");
    });
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId("merkl-card").map(el => el.textContent)).toEqual(["base", "polygon"]));
    const summary = screen.getByRole("region", { name: "Portfolio summary" });
    expect(within(summary).getByText("25 TEL")).toBeInTheDocument();
  });

  it("says there is nothing to claim when every chain reads zero", async () => {
    renderPage();
    expect(await screen.findByText(/No TELx rewards to claim yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("merkl-card")).not.toBeInTheDocument();
  });

  it("keeps the deprecated Balancer sections for a wallet with a stake or unclaimed rewards", async () => {
    const staked = { poolContractAddress: "0xstaked", blockchain: "polygon", protocol: "balancer", user: { stakedLPT: "10" }, rewards: [] };
    const withdrawn = {
      poolContractAddress: "0xwithdrawn",
      blockchain: "polygon",
      protocol: "balancer",
      user: { stakedLPT: 0 },
      rewards: [{ ticker: "TEL", unclaimed: "40" }],
    };
    setState({ userContracts: { a: staked, b: withdrawn } });
    renderPage();

    expect(await screen.findByText("Balancer Claimable Rewards (deprecated)")).toBeInTheDocument();
    expect(screen.getAllByTestId("deprecated-rewards-card").map(el => el.textContent)).toEqual(["0xstaked", "0xwithdrawn"]);
    expect(screen.getByText("Your LPT stakes (deprecated)")).toBeInTheDocument();
    expect(screen.getByTestId("lpt-card")).toBeVisible();
    expect(screen.getByTestId("lpt-card")).toHaveTextContent("0xstaked");
    // The unclaimed legacy TEL is counted in the summary.
    expect(await screen.findByText("Plus 40 legacy TEL from old pools.")).toBeInTheDocument();
  });

  it("leaves the deprecated sections out when the wallet has nothing there", async () => {
    renderPage();
    await screen.findByText("You have no Uniswap v4 positions in TELx pools yet.");
    expect(screen.queryByText("Balancer Claimable Rewards (deprecated)")).not.toBeInTheDocument();
    expect(screen.queryByText("Your LPT stakes (deprecated)")).not.toBeInTheDocument();
  });

  it("hides the old pool rewards when every chain reads zero", async () => {
    renderPage();
    await screen.findByText("You have no Uniswap v4 positions in TELx pools yet.");
    await waitFor(() => expect(screen.queryByText("Uniswap Claimable Rewards (old pools)")).not.toBeInTheDocument());
  });

  it("collapses the old pool rewards, shows only chains with an amount, and marks the summary partial when a chain is unreadable", async () => {
    const user = userEvent.setup();
    mockFetch({ oldRewards: { status: 200, claimableAmount: { base: "12", polygon: null, ethereum: "0" } } });
    renderPage();

    expect(await screen.findByText("Uniswap Claimable Rewards (old pools)")).toBeInTheDocument();
    const cards = screen.getAllByTestId("old-pool-card");
    expect(cards.map(el => el.textContent)).toEqual(["base:12", "polygon:Unavailable"]);
    expect(cards[0]).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show old pool rewards" }));
    expect(screen.getAllByTestId("old-pool-card")[0]).toBeVisible();

    const summary = screen.getByRole("region", { name: "Portfolio summary" });
    expect(within(summary).getByText("partial")).toBeInTheDocument();
    expect(within(summary).getByText("Plus 12 legacy TEL from old pools.")).toBeInTheDocument();
    // The upgrade card gets the legacy TEL still to claim, so it can point to the upgrade site.
    expect(screen.getByTestId("legacy-tel-card")).toHaveTextContent("12");
  });
});

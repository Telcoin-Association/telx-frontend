import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "react-toastify";
import { MERKL_POLYGON_WETH_TEL_POOLID, getUniswapChainAddresses } from "@/lib/contracts";
import type { ChainPositions, Position } from "@/lib/positions";
import UserPositions from "./UserPositions";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const POOL_ID = MERKL_POLYGON_WETH_TEL_POOLID;
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";
const ADD_LIQUIDITY = "https://app.uniswap.org/positions/add/polygon/pool";

// Wallet state read by the wagmi mocks; tests change it and rerender.
const mockWallet: {
  address: string | undefined;
  chain: { id: number } | undefined;
  hash: string | undefined;
  receipt: { isSuccess: boolean; isError: boolean; data?: { blockNumber: bigint }; error?: Error };
} = { address: OWNER, chain: { id: 137 }, hash: undefined, receipt: { isSuccess: false, isError: false } };
const mockWriteContractAsync = jest.fn();
const mockSwitchChainAsync = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => ({ address: mockWallet.address, chain: mockWallet.chain }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ data: mockWallet.hash, writeContractAsync: mockWriteContractAsync }),
  useWaitForTransactionReceipt: () => ({
    data: mockWallet.receipt.data,
    isSuccess: mockWallet.receipt.isSuccess,
    isError: mockWallet.receipt.isError,
    error: mockWallet.receipt.error,
  }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../hooks/usePositionTransferWatch", () => ({ usePositionTransferWatch: jest.fn() }));
jest.mock("../../redux/slices/marketRateSlice", () => ({
  useGetMarketRateQuery: () => ({ data: { WETH: { USD: "3000.000000" }, TEL: { USD: "0.005000" } } }),
}));
jest.mock("../layout/CustomConnectButton", () => ({
  CustomConnectButton: () => (
    <button type="button" data-testid="connect-button">
      Connect
    </button>
  ),
}));

const Q96 = (2n ** 96n).toString();
const position = (tokenId: string, fields: Partial<Position> = {}): Position => ({
  tokenId,
  isSubscribed: false,
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amounts: { amount0: "0.000165854280435722", amount1: "12.3456", sqrtPriceX96: Q96 },
  price: { price1Per0: 1, price0Per1: 1 },
  ...fields,
});

const SUBSCRIBED = position("101", { isSubscribed: true });
const NOT_SUBSCRIBED = position("102", { tickLower: 60, tickUpper: 120 });
const CLOSED = position("103", { liquidity: "0", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: Q96 } });

const selectedPool = {
  blockchain: "polygon",
  addLiquidityLink: ADD_LIQUIDITY,
  // Listed out of currency order on purpose: WETH (0x7ce...) is currency0.
  assets: [
    { ticker: "TEL", address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731" },
    { ticker: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
  ],
};
const addresses = getUniswapChainAddresses("polygon", POOL_ID);

const body = (positions: Position[]): ChainPositions => ({
  chain: "polygon",
  owner: OWNER.toLowerCase(),
  blockNumber: 1,
  truncated: false,
  pools: { [POOL_ID]: { positions, claimableAmount: null } },
});
const fetchMock = jest.fn();

function mockPositions(positions: Position[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body(positions) });
}

const view = () => <UserPositions selectedPool={selectedPool} currentPoolAddress={POOL_ID} />;

async function renderList(positions: Position[] = [SUBSCRIBED, NOT_SUBSCRIBED, CLOSED]) {
  mockPositions(positions);
  const utils = render(view());

  await waitFor(() => expect(screen.queryByText(/Loading your positions/)).not.toBeInTheDocument());
  return utils;
}

const row = (tokenId: string) => screen.getByRole("listitem", { name: new RegExp(`^Position ${tokenId},`) });
const chip = (name: RegExp) => screen.getByRole("button", { name });

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  mockWallet.address = OWNER;
  mockWallet.chain = { id: 137 };
  mockSwitchChainAsync.mockReset();
  mockSwitchChainAsync.mockResolvedValue(undefined);
  mockWallet.hash = undefined;
  mockWallet.receipt = { isSuccess: false, isError: false };
  mockWriteContractAsync.mockReset();
  fetchMock.mockReset();
  (toast.success as jest.Mock).mockReset();
  (toast.error as jest.Mock).mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("UserPositions list and filters", () => {
  it("shows open positions under All with counts, and closed ones only under Closed", async () => {
    const user = userEvent.setup();
    await renderList();

    expect(chip(/^All \(2\)$/)).toHaveAttribute("aria-pressed", "true");
    expect(chip(/^Subscribed \(1\)$/)).toHaveAttribute("aria-pressed", "false");
    expect(chip(/^Not subscribed \(1\)$/)).toBeInTheDocument();
    expect(chip(/^Closed \(1\)$/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("listitem", { name: /^Position 103,/ })).not.toBeInTheDocument();

    await user.click(chip(/^Closed/));
    expect(chip(/^Closed/)).toHaveAttribute("aria-pressed", "true");
    expect(chip(/^All/)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const closedRow = row("103");
    expect(within(closedRow).getByText("Closed")).toBeInTheDocument();
    expect(within(closedRow).queryByRole("button")).not.toBeInTheDocument();

    await user.click(chip(/^Subscribed/));
    expect(screen.getAllByRole("listitem").map(li => li.getAttribute("aria-label"))).toEqual(["Position 101, Subscribed, in range"]);

    await user.click(chip(/^Not subscribed/));
    expect(screen.getAllByRole("listitem").map(li => li.getAttribute("aria-label"))).toEqual(["Position 102, Not subscribed, out of range"]);
  });

  it("shows readable amounts in currency order, the USD value and the range badges", async () => {
    await renderList();
    const subscribedRow = row("101");
    expect(within(subscribedRow).getByText("0.0001659 WETH")).toBeInTheDocument();
    expect(within(subscribedRow).getByText("12.35 TEL")).toBeInTheDocument();
    // 0.000165854 WETH at $3000 plus 12.3456 TEL at $0.005
    expect(within(subscribedRow).getByText("$0.56")).toBeInTheDocument();
    expect(within(subscribedRow).getByText("In range")).toBeInTheDocument();
    expect(within(subscribedRow).getByText("Subscribed")).toBeInTheDocument();
    expect(within(row("102")).getByText("Out of range")).toBeInTheDocument();
    expect(within(row("102")).getByText("Not subscribed")).toBeInTheDocument();
    expect(screen.queryByText(/UnSubscribed/)).not.toBeInTheDocument();
  });
});

describe("UserPositions row actions", () => {
  it("subscribes the row's position with the same contract call", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockResolvedValue(HASH);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
    expect(mockWriteContractAsync).toHaveBeenCalledWith({
      chainId: 137,
      address: addresses.positionManager,
      abi: expect.any(Array),
      functionName: "subscribe",
      args: [102n, addresses.subscriber, "0x"],
    });
  });

  it("unsubscribes the row's position with the same contract call", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockResolvedValue(HASH);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Unsubscribe position 101" }));
    expect(mockWriteContractAsync).toHaveBeenCalledWith({
      chainId: 137,
      address: addresses.positionManager,
      abi: expect.any(Array),
      functionName: "unsubscribe",
      args: [101n],
    });
  });

  it("shows the pending state on the sending row only, then the result on that row", async () => {
    const user = userEvent.setup();
    let send: (hash: string) => void = () => undefined;
    mockWriteContractAsync.mockImplementation(() => new Promise(resolve => (send = resolve)));
    const { rerender } = await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    const pendingButton = screen.getByRole("button", { name: "Subscribing... position 102" });
    expect(pendingButton).toBeDisabled();
    expect(within(row("102")).getByTestId("loader")).toBeInTheDocument();
    expect(within(row("102")).getByText("Confirm in your wallet.")).toBeInTheDocument();
    expect(row("102")).toHaveAttribute("aria-busy", "true");
    // Other rows wait for the transaction in flight, without a spinner of their own.
    expect(screen.getByRole("button", { name: "Unsubscribe position 101" })).toBeDisabled();
    expect(within(row("101")).queryByTestId("loader")).not.toBeInTheDocument();

    mockWallet.hash = HASH;
    await act(async () => send(HASH));
    expect(within(row("102")).getByText("Waiting for confirmation...")).toBeInTheDocument();

    mockPositions([SUBSCRIBED, { ...NOT_SUBSCRIBED, isSubscribed: true }, CLOSED]);
    mockWallet.receipt = { isSuccess: true, isError: false, data: { blockNumber: 1234n } };
    rerender(view());

    await waitFor(() => expect(within(row("102")).getByText("Subscribed.")).toBeInTheDocument());
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${HASH}`);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("minBlock=1234"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unsubscribe position 102" })).toBeEnabled());
    expect(chip(/^Subscribed \(2\)$/)).toBeInTheDocument();
  });

  it("shows a failed receipt on the row", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    mockWriteContractAsync.mockImplementation(async () => {
      mockWallet.hash = HASH;
      return HASH;
    });
    const { rerender } = await renderList();

    await user.click(screen.getByRole("button", { name: "Unsubscribe position 101" }));
    mockWallet.receipt = { isSuccess: false, isError: true, error: new Error("reverted") };
    rerender(view());

    await waitFor(() => expect(within(row("101")).getByText(/Unsubscribe failed\./)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Unsubscribe position 101" })).toBeEnabled();
  });

  it("shows a rejected request on the row and re-enables its button", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockRejectedValue(Object.assign(new Error("long"), { shortMessage: "User rejected the request." }));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("Subscribe was not sent: User rejected the request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe position 102" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Unsubscribe position 101" })).toBeEnabled();
  });
});

describe("UserPositions chain", () => {
  it("sends on the pool's chain without a switch when the wallet is already on it", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockResolvedValue(HASH);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 }));
  });

  it("switches a wallet on another network to the pool's chain before sending", async () => {
    const user = userEvent.setup();
    mockWallet.chain = { id: 8453 };
    mockWriteContractAsync.mockResolvedValue(HASH);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Unsubscribe position 101" }));
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
  });

  it("sends nothing when the wallet refuses to switch, and says so on the row", async () => {
    const user = userEvent.setup();
    mockWallet.chain = { id: 1 };
    mockSwitchChainAsync.mockRejectedValue(Object.assign(new Error("long"), { shortMessage: "User rejected the request." }));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("Subscribe was not sent: User rejected the request.")).toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });
});

describe("UserPositions empty states", () => {
  it("asks for a wallet when none is connected", () => {
    mockWallet.address = undefined;
    render(view());
    expect(screen.getByText("Connect your wallet to see your positions in this pool.")).toBeInTheDocument();
    expect(screen.getByTestId("connect-button")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links to adding liquidity when the wallet has no positions", async () => {
    await renderList([]);
    expect(screen.getByText("You do not have any Uniswap v4 positions in this pool.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add liquidity on Uniswap" })).toHaveAttribute("href", ADD_LIQUIDITY);
    expect(screen.queryByRole("group", { name: "Filter positions" })).not.toBeInTheDocument();
  });

  it("offers Show all when no position matches the filter", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);

    await user.click(chip(/^Not subscribed \(0\)$/));
    expect(screen.getByText("All of your open positions in this pool are subscribed.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(chip(/^All/)).toHaveAttribute("aria-pressed", "true");
    expect(row("101")).toBeInTheDocument();
  });

  it("offers Show closed when every position is closed", async () => {
    const user = userEvent.setup();
    await renderList([CLOSED]);

    expect(screen.getByText("All of your positions in this pool are closed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show closed" }));
    expect(row("103")).toBeInTheDocument();
  });

  it("offers a retry when the positions cannot be loaded", async () => {
    const user = userEvent.setup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(view());

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

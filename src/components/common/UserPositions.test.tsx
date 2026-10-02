import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "react-toastify";
import { MERKL_POLYGON_WETH_TEL_POOLID, getUniswapChainAddresses } from "@/lib/contracts";
import type { ChainPositions, Position } from "@/lib/positions";
import { announcePositionAdded } from "@/lib/poolPageEvents";
import UserPositions from "./UserPositions";
import { runExclusive } from "@/lib/claims/claimQueue";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const POOL_ID = MERKL_POLYGON_WETH_TEL_POOLID;
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";
const ADD_LIQUIDITY = "https://app.uniswap.org/positions/add/polygon/pool";

// Wallet state read by the wagmi mocks; tests change it before rendering.
const mockWallet: { address: string | undefined; chain: { id: number } | undefined } = { address: OWNER, chain: { id: 137 } };
const mockWriteContractAsync = jest.fn();
const mockSwitchChainAsync = jest.fn();
const mockPublicClient = { simulateContract: jest.fn(), waitForTransactionReceipt: jest.fn(), multicall: jest.fn() };
const mockEstimates = { perToken: {} as Record<string, number | null>, all: null as number | null };
jest.mock("../../hooks/useCollectEstimates", () => ({ useCollectEstimates: () => mockEstimates }));

jest.mock("wagmi", () => ({
  useAccount: () => ({ address: mockWallet.address, chain: mockWallet.chain }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
  usePublicClient: () => mockPublicClient,
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./PositionHistory", () => function MockPositionHistory({ chain, tokenId }: { chain: string; tokenId: string }) {
  return <div data-testid="position-history">{`${chain}:${tokenId}`}</div>;
});
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
const NOT_SUBSCRIBED = position("102");
const CLOSED = position("103", { liquidity: "0", amounts: { amount0: "0", amount1: "0", sqrtPriceX96: Q96 } });
const OUT_OF_RANGE = position("104", { tickLower: 60, tickUpper: 120 });

const rewardsMock = jest.fn();

const WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL_ADDRESS = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";

/**
 * The wagmi public client's multicall for a collect's fresh read: the pool key, each position's fee reads, then token
 * metadata. `owed` gives each position's fees in base units as [WETH, TEL]. Fee growth reads zero, and each
 * position's last growth sits that far below it modulo 2^256, so positions sharing a range still owe different fees.
 */
function freshChain(owed: Record<string, [bigint, bigint]>) {
  const Q128 = 2n ** 128n;
  const TWO_256 = 2n ** 256n;
  const below = (amount: bigint) => (TWO_256 - amount * Q128) % TWO_256;
  return async ({ contracts }: { contracts: { functionName: string; args?: readonly unknown[]; address: string }[] }) =>
    contracts.map(({ functionName, args, address }) => {
      switch (functionName) {
        case "poolKeys":
          return { status: "success", result: [WETH_ADDRESS, TEL_ADDRESS, 3000, 60, "0x0000000000000000000000000000000000000000"] };
        case "getPositionInfo": {
          const [weth, tel] = owed[BigInt(args![4] as string).toString()] ?? [0n, 0n];
          return { status: "success", result: [1n, below(weth), below(tel)] };
        }
        case "getFeeGrowthInside":
          return { status: "success", result: [0n, 0n] };
        case "decimals":
          return { status: "success", result: 18 };
        case "symbol":
          return { status: "success", result: address.toLowerCase() === WETH_ADDRESS.toLowerCase() ? "WETH" : "TEL" };
        default:
          return { status: "failure", error: new Error(functionName) };
      }
    });
}
const REWARDS = {
  chain: "polygon",
  poolId: POOL_ID.toLowerCase(),
  updatedAt: 1,
  campaigns: [],
  unresolved: 0,
  positions: { "101": { reward: 34_000, claimable: 30_000, pending: 4_000, final: false } },
};

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

const body = (positions: Position[], blockNumber = 1): ChainPositions => ({
  chain: "polygon",
  owner: OWNER.toLowerCase(),
  blockNumber,
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
const moreButton = (tokenId: string) => screen.getByRole("button", { name: `More actions for position ${tokenId}` });

/** The labels of a row's More menu, read by opening it and closing it again with Escape. */
async function menuLabels(user: ReturnType<typeof userEvent.setup>, tokenId: string): Promise<string[]> {
  await user.click(moreButton(tokenId));
  const labels = screen.getAllByRole("menuitem").map(item => item.textContent ?? "");
  await user.keyboard("{Escape}");
  return labels;
}

/** Unsubscribes a row through its More menu and the confirmation step. */
async function unsubscribeVia(user: ReturnType<typeof userEvent.setup>, tokenId: string) {
  await user.click(moreButton(tokenId));
  await user.click(screen.getByRole("menuitem", { name: "Unsubscribe…" }));
  await user.click(screen.getByRole("button", { name: `Unsubscribe position ${tokenId}` }));
}
const receipt = (fields: Record<string, unknown> = {}) => ({ status: "success", transactionHash: HASH, blockNumber: 1234n, ...fields });

/** A promise with its resolve and reject exposed, to hold a step open while the test inspects the row. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  mockWallet.address = OWNER;
  mockWallet.chain = { id: 137 };
  mockSwitchChainAsync.mockReset();
  mockSwitchChainAsync.mockResolvedValue(undefined);
  mockWriteContractAsync.mockReset();
  mockWriteContractAsync.mockResolvedValue(HASH);
  mockPublicClient.simulateContract.mockReset();
  mockPublicClient.simulateContract.mockResolvedValue({ request: {} });
  mockPublicClient.waitForTransactionReceipt.mockReset();
  mockPublicClient.waitForTransactionReceipt.mockResolvedValue(receipt());
  mockPublicClient.multicall.mockReset();
  mockPublicClient.multicall.mockImplementation(freshChain({ "101": [10n ** 15n, 5n * 10n ** 18n], "102": [2n * 10n ** 15n, 3n * 10n ** 18n] }));
  mockEstimates.perToken = {};
  mockEstimates.all = null;
  fetchMock.mockReset();
  rewardsMock.mockReset();
  rewardsMock.mockResolvedValue({ ok: true, json: async () => REWARDS });
  (toast.success as jest.Mock).mockReset();
  (toast.error as jest.Mock).mockReset();
  // The wallet's rewards are answered apart, so `fetchMock` sees only position reads.
  global.fetch = ((...args: [string, RequestInit?]) =>
    String(args[0]).startsWith("/api/positions/rewards") ? rewardsMock(...args) : fetchMock(...args)) as unknown as typeof fetch;
});

describe("UserPositions list and filters", () => {
  it("shows open positions under All with counts, and closed ones only under Closed", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED, OUT_OF_RANGE, CLOSED]);

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
    expect(within(closedRow).queryByRole("button", { name: /subscribe/i })).not.toBeInTheDocument();

    await user.click(chip(/^Subscribed/));
    expect(screen.getAllByRole("listitem").map(li => li.getAttribute("aria-label"))).toEqual(["Position 101, Subscribed, in range"]);

    await user.click(chip(/^Not subscribed/));
    expect(screen.getAllByRole("listitem").map(li => li.getAttribute("aria-label"))).toEqual(["Position 104, Not subscribed, out of range"]);
  });

  it("shows readable amounts in currency order, the USD value and the range badges", async () => {
    await renderList([SUBSCRIBED, OUT_OF_RANGE]);
    const subscribedRow = row("101");
    expect(within(subscribedRow).getByText("0.0001659 WETH")).toBeInTheDocument();
    expect(within(subscribedRow).getByText("12.35 TEL")).toBeInTheDocument();
    // 0.000165854 WETH at $3000 plus 12.3456 TEL at $0.005
    expect(within(within(subscribedRow).getByTestId("position-amounts")).getByText("$0.56")).toBeInTheDocument();
    expect(within(subscribedRow).getByTestId("range-indicator")).toHaveAttribute("data-state", "in");
    expect(within(subscribedRow).getByText("Subscribed")).toBeInTheDocument();
    expect(within(row("104")).getByText("Out of range")).toBeInTheDocument();
    expect(within(row("104")).getByText("Not subscribed")).toBeInTheDocument();
    expect(screen.queryByText(/UnSubscribed/)).not.toBeInTheDocument();
  });

  it("keeps closed positions still subscribed under Closed, points to them, and keeps their Unsubscribe", async () => {
    const user = userEvent.setup();
    const closedSubscribed = { ...CLOSED, isSubscribed: true };
    const otherClosedSubscribed = { ...CLOSED, tokenId: "105", isSubscribed: true };
    await renderList([NOT_SUBSCRIBED, closedSubscribed, otherClosedSubscribed]);

    expect(chip(/^All \(1\)$/)).toBeInTheDocument();
    expect(chip(/^Closed \(2\)$/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /^Position 103,/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 closed positions are still subscribed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show closed" }));
    expect(chip(/^Closed/)).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(chip(/^Closed/)).toHaveFocus());
    expect(screen.queryByText(/closed positions? (is|are) still subscribed/)).not.toBeInTheDocument();
    const closedRow = row("103");
    expect(closedRow).toHaveAttribute("aria-label", "Position 103, Closed, still subscribed");
    expect(within(closedRow).getByText("Still subscribed")).toBeInTheDocument();

    await unsubscribeVia(user, "103");
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: "unsubscribe", args: [103n] }));
  });

  it("does not point to closed positions when none is still subscribed", async () => {
    await renderList([NOT_SUBSCRIBED, CLOSED]);
    expect(screen.queryByText(/still subscribed\./)).not.toBeInTheDocument();
  });

  it("lists open positions by USD value, highest first", async () => {
    const small = position("201", { amounts: { amount0: "0.0001", amount1: "1", sqrtPriceX96: Q96 } });
    const large = position("150", { amounts: { amount0: "1", amount1: "1", sqrtPriceX96: Q96 } });
    await renderList([CLOSED, small, large]);
    expect(screen.getAllByRole("listitem").map(li => li.getAttribute("aria-label")?.split(",")[0])).toEqual(["Position 150", "Position 201"]);
  });

  it("does not offer Subscribe on an out-of-range position in a Merkl pool, and says why", async () => {
    await renderList([OUT_OF_RANGE]);
    expect(screen.getByRole("button", { name: "Subscribe position 104" })).toBeDisabled();
    expect(within(row("104")).getByText("Only in-range positions can be subscribed.")).toBeInTheDocument();
  });
});

describe("UserPositions add liquidity", () => {
  it("offers a button under the list of a TELx Merkl pool that opens the Add liquidity tab", async () => {
    await renderList();
    const opened = jest.fn();
    window.addEventListener("telx:open-add-liquidity", opened);
    const button = screen.getByRole("link", { name: /Add liquidity and earn TELx rewards/ });
    expect(button).toHaveAttribute("href", "#add-liquidity");
    fireEvent.click(button);
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener("telx:open-add-liquidity", opened);
  });

  it("does not offer it for a pool outside the TELx Merkl program", async () => {
    mockPositions([SUBSCRIBED]);
    render(<UserPositions selectedPool={selectedPool} currentPoolAddress="0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7" />);
    await waitFor(() => expect(screen.queryByText(/Loading your positions/)).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Add liquidity and earn TELx rewards/ })).not.toBeInTheDocument();
  });

  it("reloads the list, at the confirmed block, when a position is added from the tab", async () => {
    await renderList();
    fetchMock.mockClear();
    act(() => announcePositionAdded(4321));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("minBlock=4321");
  });
});

describe("UserPositions row actions", () => {
  it("simulates, then subscribes the row's position on the pool's chain", async () => {
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    const call = { address: addresses.positionManager, abi: expect.any(Array), functionName: "subscribe", args: [102n, addresses.subscriber, "0x"] };
    expect(mockPublicClient.simulateContract).toHaveBeenCalledWith({ ...call, account: OWNER });
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
    expect(mockWriteContractAsync).toHaveBeenCalledWith({ ...call, chainId: 137 });
    expect(mockPublicClient.simulateContract.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
  });

  it("unsubscribes the row's position with the same contract call", async () => {
    const user = userEvent.setup();
    await renderList();

    await unsubscribeVia(user, "101");
    expect(mockWriteContractAsync).toHaveBeenCalledWith({
      chainId: 137,
      address: addresses.positionManager,
      abi: expect.any(Array),
      functionName: "unsubscribe",
      args: [101n],
    });
  });

  it("shows each step on the sending row, links the hash while mining, then the result", async () => {
    const user = userEvent.setup();
    const sent = deferred<string>();
    const mined = deferred<ReturnType<typeof receipt>>();
    mockWriteContractAsync.mockImplementation(() => sent.promise);
    mockPublicClient.waitForTransactionReceipt.mockImplementation(() => mined.promise);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    const pendingButton = await screen.findByRole("button", { name: "Subscribing... position 102" });
    expect(pendingButton).toHaveAttribute("aria-disabled", "true");
    expect(pendingButton).toBeEnabled();
    expect(within(row("102")).getByTestId("loader")).toBeInTheDocument();
    expect(await within(within(row("102")).getByRole("status")).findByText("Confirm in your wallet.")).toBeInTheDocument();
    expect(row("102")).toHaveAttribute("aria-busy", "true");
    // Other rows wait for the transaction in flight, without a spinner of their own, and stay focusable.
    expect(moreButton("101")).toHaveAttribute("aria-disabled", "true");
    expect(within(row("101")).queryByTestId("loader")).not.toBeInTheDocument();

    await act(async () => sent.resolve(HASH));
    expect(within(row("102")).getByText(/Waiting for confirmation\.\.\./)).toBeInTheDocument();
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${HASH}`);
    expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, timeout: 5 * 60_000 }));

    mockPositions([SUBSCRIBED, { ...NOT_SUBSCRIBED, isSubscribed: true }, CLOSED]);
    await act(async () => mined.resolve(receipt()));

    await waitFor(() => expect(within(row("102")).getByText("Subscribed.")).toBeInTheDocument());
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${HASH}`);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("minBlock=1234"));
    await waitFor(() => expect(moreButton("102")).not.toHaveAttribute("aria-disabled"));
    expect(await menuLabels(user, "102")).toContain("Unsubscribe…");
    expect(chip(/^Subscribed \(2\)$/)).toBeInTheDocument();
  });

  it("shows the confirmed status at once, even when the follow-up read is stale or fails", async () => {
    const user = userEvent.setup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderList();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(within(row("102")).getByText("Subscribed.")).toBeInTheDocument());
    expect(within(row("102")).getByText("Subscribed")).toBeInTheDocument();
    expect(await menuLabels(user, "102")).toContain("Unsubscribe…");
    expect(screen.queryByRole("button", { name: "Subscribe position 102" })).not.toBeInTheDocument();
    expect(chip(/^Subscribed \(2\)$/)).toBeInTheDocument();
  });

  it("explains a simulated revert on the row and sends nothing", async () => {
    const user = userEvent.setup();
    const revert = Object.assign(new Error("reverted"), {
      shortMessage: "The contract function reverted.",
      cause: { name: "ContractFunctionRevertedError", data: { errorName: "AlreadySubscribed", args: [102n, addresses.subscriber] } },
    });
    mockPublicClient.simulateContract.mockRejectedValue(revert);
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("Subscribe was not sent. This position is already subscribed.")).toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("names an out-of-range rejection from the Merkl registry", async () => {
    const user = userEvent.setup();
    mockPublicClient.simulateContract.mockRejectedValue({
      cause: { data: { errorName: "WrappedError", args: [addresses.subscriber, "0x8d57f6b2", "0x6f2fb69e00000000000000000000000000000000000000000000000000000000000230b2", "0x"] } },
    });
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText(/Only in-range positions can be subscribed\. This one is out of range\./)).toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("still sends when the simulation fails for a reason other than a revert", async () => {
    const user = userEvent.setup();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockPublicClient.simulateContract.mockRejectedValue(new Error("HTTP request failed"));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(mockWriteContractAsync).toHaveBeenCalledTimes(1));
  });

  it("shows a reverted receipt on the row with a short toast", async () => {
    const user = userEvent.setup();
    mockPublicClient.waitForTransactionReceipt.mockResolvedValue(receipt({ status: "reverted" }));
    await renderList();

    await unsubscribeVia(user, "101");
    await waitFor(() => expect(within(row("101")).getByText(/Unsubscribe failed on chain\./)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith("Unsubscribe failed on Polygon.");
    expect(moreButton("101")).not.toHaveAttribute("aria-disabled");
  });

  it("reports a cancel in the wallet as a cancel, linked to the mined replacement", async () => {
    const user = userEvent.setup();
    const CANCEL = `0x${"2".repeat(64)}`;
    mockPublicClient.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "cancelled", transaction: { hash: CANCEL } });
      return receipt({ transactionHash: CANCEL });
    });
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(within(row("102")).getByText(/Subscribe was cancelled in your wallet\. The position is unchanged\./)).toBeInTheDocument());
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${CANCEL}`);
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(row("102")).getByText("Not subscribed")).toBeInTheDocument();
  });

  it("links a sped-up transaction to the hash that was mined", async () => {
    const user = userEvent.setup();
    const FASTER = `0x${"3".repeat(64)}`;
    mockPublicClient.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      onReplaced({ reason: "repriced", transaction: { hash: FASTER } });
      return receipt({ transactionHash: FASTER });
    });
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(within(row("102")).getByText("Subscribed.")).toBeInTheDocument());
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${FASTER}`);
  });

  it("gives up after the receipt timeout and points to the explorer", async () => {
    const user = userEvent.setup();
    mockPublicClient.waitForTransactionReceipt.mockRejectedValue(Object.assign(new Error("timed out"), { name: "WaitForTransactionReceiptTimeoutError" }));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(within(row("102")).getByText(/Subscribe is not confirmed after 5 minutes\./)).toBeInTheDocument());
    expect(within(row("102")).getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", `${addresses.explorerTxBase}${HASH}`);
    expect(moreButton("101")).not.toHaveAttribute("aria-disabled");
  });

  it("shows a signing refused in the wallet as a notice and re-enables the buttons", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockRejectedValue(Object.assign(new Error("long"), { name: "UserRejectedRequestError", shortMessage: "User rejected the request." }));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("Subscribe was cancelled in your wallet, so nothing was sent.")).toHaveClass("text-primary");
    expect(screen.getByRole("button", { name: "Subscribe position 102" })).toBeEnabled();
    expect(moreButton("101")).not.toHaveAttribute("aria-disabled");
  });

  it("shows another send failure as an error with the wallet's message", async () => {
    const user = userEvent.setup();
    mockWriteContractAsync.mockRejectedValue(Object.assign(new Error("long"), { shortMessage: "Insufficient funds for gas." }));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("Subscribe was not sent. Insufficient funds for gas.")).toHaveClass("text-red-400");
  });
});

describe("UserPositions chain", () => {
  it("sends on the pool's chain without a switch when the wallet is already on it", async () => {
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    await waitFor(() => expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 })));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it("names the network while asking the wallet to switch, before sending", async () => {
    const user = userEvent.setup();
    mockWallet.chain = { id: 8453 };
    const switched = deferred<void>();
    mockSwitchChainAsync.mockImplementation(() => switched.promise);
    await renderList();

    await unsubscribeVia(user, "101");
    expect(await within(row("101")).findByText("Switch your wallet to Polygon to continue.")).toBeInTheDocument();
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
    expect(mockWriteContractAsync).not.toHaveBeenCalled();

    await act(async () => switched.resolve());
    await waitFor(() => expect(mockWriteContractAsync).toHaveBeenCalledTimes(1));
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
  });

  it("says a declined switch was declined, as a notice, and sends nothing", async () => {
    const user = userEvent.setup();
    mockWallet.chain = { id: 1 };
    mockSwitchChainAsync.mockRejectedValue(Object.assign(new Error("long"), { code: 4001, shortMessage: "User rejected the request." }));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(await within(row("102")).findByText("The switch to Polygon was declined, so nothing was sent.")).toHaveClass("text-primary");
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("says when the wallet cannot switch, as an error", async () => {
    const user = userEvent.setup();
    mockWallet.chain = { id: 1 };
    mockSwitchChainAsync.mockRejectedValue(Object.assign(new Error("long"), { shortMessage: "An error occurred when attempting to switch chain." }));
    await renderList();

    await user.click(screen.getByRole("button", { name: "Subscribe position 102" }));
    expect(
      await within(row("102")).findByText("Your wallet could not switch to Polygon, so nothing was sent: An error occurred when attempting to switch chain."),
    ).toHaveClass("text-red-400");
  });
});

describe("UserPositions history", () => {
  it("opens and closes a row's history on the pool's chain", async () => {
    const user = userEvent.setup();
    await renderList();

    expect(screen.queryByTestId("position-history")).not.toBeInTheDocument();

    await user.click(moreButton("102"));
    await user.click(screen.getByRole("menuitem", { name: "Show history" }));
    expect(within(row("102")).getByTestId("position-history")).toHaveTextContent("polygon:102");
    // Choosing an item closes the menu and returns focus to its button.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(moreButton("102")).toHaveFocus();

    await user.click(moreButton("102"));
    await user.click(screen.getByRole("menuitem", { name: "Hide history" }));
    expect(screen.queryByTestId("position-history")).not.toBeInTheDocument();
  });
});

describe("UserPositions position figures", () => {
  it("shows each position's LM, range bar and TELx rewards, from one read of the pool's rewards index", async () => {
    await renderList([SUBSCRIBED, NOT_SUBSCRIBED]);
    // Ticks -60 to 60 around tick 0: 2 / (2 - 2 × 1.0001^-30) ≈ 334.
    expect(within(row("101")).getByText("334x")).toBeInTheDocument();
    expect(within(row("101")).getByRole("img", { name: "In range: price at 50% of the range, from 0.994 to 1.01 TEL per WETH" })).toBeInTheDocument();
    expect(await within(row("101")).findByTestId("pending-tel-101")).toHaveTextContent("34K TEL$170.00");
    expect(within(row("101")).getByText(/30K TEL claimable, 4K TEL accruing/)).toHaveTextContent("Provisional");
    // Provisional is a neutral note with an explanation, not a warning.
    expect(within(row("101")).getByTestId("provisional-101")).toHaveClass("text-primary");
    expect(within(row("101")).getByTestId("provisional-101")).not.toHaveClass("text-yellow-300");
    // A position Merkl has never rewarded reads zero.
    expect(within(row("102")).getByTestId("pending-tel-102")).toHaveTextContent("0 TEL");
    expect(rewardsMock).toHaveBeenCalledTimes(1);
    expect(String(rewardsMock.mock.calls[0][0])).toBe(`/api/positions/rewards?chain=polygon&poolId=${POOL_ID.toLowerCase()}`);
  });

  it("says TELx rewards are unavailable when the index can't be read, and keeps the rest of the row", async () => {
    rewardsMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await renderList([SUBSCRIBED]);
    expect(await within(row("101")).findByText("Unavailable")).toBeInTheDocument();
    expect(within(row("101")).getByText("12.35 TEL")).toBeInTheDocument();
  });

  it("marks an out-of-range range bar and gives its width-based LM", async () => {
    await renderList([OUT_OF_RANGE]);
    // Ticks 60 to 120 with the price below: 1 / (1 - 1.0001^-15) ≈ 667.
    expect(within(row("104")).getByText("667x")).toBeInTheDocument();
    expect(within(row("104")).getByRole("img", { name: /^Out of range: price below the range/ })).toBeInTheDocument();
    expect(within(row("104")).getByTestId("range-indicator")).toHaveAttribute("data-state", "out");
  });

  it("collapses the range bar and amounts behind Details on phones, and expands them on tap", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);
    const summary = within(row("101")).getByTestId("position-summary");
    expect(summary).toHaveTextContent("$0.56");
    expect(await within(summary).findByText("34K TEL")).toBeInTheDocument();
    const toggle = within(summary).getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(row("101")).getByTestId("position-range")).toHaveClass("hidden", "sm:flex");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(row("101")).getByTestId("position-range")).not.toHaveClass("hidden");
    expect(within(row("101")).getByTestId("position-amounts")).not.toHaveClass("hidden");
  });

  it("does not read rewards for a pool outside the Merkl program", async () => {
    const legacyPool = "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7";
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...body([]), pools: { [legacyPool]: { positions: [SUBSCRIBED], claimableAmount: null } } }) });
    render(<UserPositions selectedPool={selectedPool} currentPoolAddress={legacyPool} />);
    await screen.findByRole("listitem", { name: /^Position 101,/ });
    expect(rewardsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pending-tel-101")).not.toBeInTheDocument();
  });
});

describe("UserPositions row layout", () => {
  const withFees = (p: Position, amount0: string, amount1: string): Position => ({ ...p, fees: { amount0, amount1 } });

  it("labels the desktop columns once, in a header above the rows", async () => {
    await renderList([SUBSCRIBED, NOT_SUBSCRIBED]);
    const header = screen.getByTestId("positions-header");
    expect(header).toHaveClass("hidden", "lg:grid");
    expect(header).toHaveTextContent("PositionRangeLiquidityUncollected feesTELx rewards");
    expect(within(header).getByRole("button", { name: "About the liquidity multiplier" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "About TELx rewards" })).toBeInTheDocument();
    // The header and the rows share one column template.
    const columns = Array.from(header.classList).find(name => name.startsWith("lg:grid-cols-"));
    expect(columns).toBeDefined();
    expect(row("101")).toHaveClass(columns!);
  });

  it("puts each cell in its own desktop column, with the per-row labels kept for screen readers only", async () => {
    mockEstimates.perToken = { "101": 0.01 };
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);
    expect(within(row("101")).getByTestId("position-range")).toHaveClass("sm:col-start-2", "sm:row-start-1");
    expect(within(row("101")).getByTestId("position-amounts")).toHaveClass("sm:col-start-3", "sm:row-start-1");
    expect(within(row("101")).getByTestId("fees-101").parentElement).toHaveClass("sm:row-start-2", "lg:col-start-4", "lg:row-start-1");
    expect((await within(row("101")).findByTestId("pending-tel-101")).parentElement?.parentElement).toHaveClass("lg:col-start-5", "lg:row-start-1");
    expect(within(row("101")).getByText("Uncollected fees")).toHaveClass("lg:sr-only");
    expect(within(row("101")).getByText("TELx rewards")).toHaveClass("lg:sr-only");
  });

  it("adds a full-width notes line only while a row has something to say", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);
    expect(within(row("101")).queryByTestId("position-notes-101")).not.toBeInTheDocument();
    await user.click(moreButton("101"));
    await user.click(screen.getByRole("menuitem", { name: "Unsubscribe…" }));
    expect(within(row("101")).getByTestId("position-notes-101")).toHaveClass("col-span-full");
  });

  it("keeps the phone row to one line: the too-small fee note moves into Details", async () => {
    mockEstimates.perToken = { "101": 9 };
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);
    expect(within(row("101")).getByTestId("fees-too-small-101")).toHaveClass("hidden", "sm:flex");
    const detailsNote = within(within(row("101")).getByTestId("fees-101").parentElement!).getByText("Fees too small to collect yet");
    expect(detailsNote).toHaveClass("sm:hidden");
  });
});

describe("UserPositions fee collection", () => {
  const withFees = (p: Position, amount0: string, amount1: string): Position => ({ ...p, fees: { amount0, amount1 } });

  it("shows each open position's uncollected fees, the network fee, and a Collect fees button", async () => {
    mockEstimates.perToken = { "101": 0.01 };
    await renderList([withFees(SUBSCRIBED, "0.001", "5"), withFees(NOT_SUBSCRIBED, "0", "0")]);
    expect(within(row("101")).getByTestId("fees-101")).toHaveTextContent("0.001 WETH · 5 TEL$3.03");
    expect(within(row("101")).getByRole("button", { name: "Collect fees from position 101" })).toBeEnabled();
    // Nothing earned yet: no collect action at all.
    expect(within(row("102")).getByTestId("fees-102")).toHaveTextContent("None yet");
    expect(within(row("102")).queryByRole("button", { name: "Collect fees from position 102" })).not.toBeInTheDocument();
  });

  it("says quietly when collecting would cost more in network fees than it collects, and keeps it in the menu", async () => {
    const user = userEvent.setup();
    mockEstimates.perToken = { "101": 9 };
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);
    expect(within(row("101")).getByTestId("fees-too-small-101")).toHaveTextContent("Fees too small to collect yet");
    expect(within(row("101")).queryByRole("button", { name: "Collect fees from position 101" })).not.toBeInTheDocument();
    expect(screen.queryByText(/costs more than the fees/)).not.toBeInTheDocument();
    expect(await menuLabels(user, "101")).toEqual(["Show history", "Collect fees anyway", "Unsubscribe…"]);
  });

  it("asks before unsubscribing, and Keep subscribed sends nothing", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);
    await user.click(moreButton("101"));
    await user.click(screen.getByRole("menuitem", { name: "Unsubscribe…" }));
    const confirm = screen.getByRole("group", { name: "Confirm unsubscribing position 101" });
    expect(confirm).toHaveTextContent("It stops earning TELx rewards until it is subscribed again.");
    expect(within(confirm).getByRole("button", { name: "Keep subscribed" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Keep subscribed" }));
    expect(screen.queryByRole("group", { name: /Confirm unsubscribing/ })).not.toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("moves through the More menu with the keyboard and closes it with Escape", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);
    moreButton("101").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Show history" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Unsubscribe…" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Show history" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Unsubscribe…" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(moreButton("101")).toHaveFocus();
  });

  it("reads what is owed now, simulates, then sends one collect on the pool's chain, and keeps the position subscribed", async () => {
    const user = userEvent.setup();
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);

    await user.click(screen.getByRole("button", { name: "Collect fees from position 101" }));

    await waitFor(() => expect(mockWriteContractAsync).toHaveBeenCalledTimes(1));
    const sent = mockWriteContractAsync.mock.calls[0][0];
    expect(sent).toMatchObject({ address: addresses.positionManager, functionName: "modifyLiquidities", chainId: 137 });
    expect(mockPublicClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "modifyLiquidities", account: OWNER, args: sent.args }));
    expect(mockPublicClient.multicall.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
    expect(await within(row("101")).findByText(/Collected 0.001 WETH and 5 TEL\./)).toBeInTheDocument();
    expect(row("101")).toHaveAttribute("aria-label", "Position 101, Subscribed, in range");
    expect(await menuLabels(user, "101")).toContain("Unsubscribe…");
  });

  it("sends nothing when the fresh read finds no fees left", async () => {
    const user = userEvent.setup();
    mockPublicClient.multicall.mockImplementation(freshChain({ "101": [0n, 0n] }));
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);
    await user.click(screen.getByRole("button", { name: "Collect fees from position 101" }));
    expect(await within(row("101")).findByText("There are no fees to collect right now.")).toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("collects every position in the pool in one transaction from the bar above the list", async () => {
    const user = userEvent.setup();
    mockEstimates.all = 0.02;
    await renderList([withFees(SUBSCRIBED, "0.001", "5"), withFees(NOT_SUBSCRIBED, "0.002", "3")]);
    const bar = screen.getByTestId("collect-all");
    expect(bar).toHaveTextContent("Uncollected fees across 2 positions: 0.003 WETH · 8 TEL");
    expect(within(bar).getByText("Network fee about $0.02")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Collect fees from all 2 positions" }));

    await waitFor(() => expect(mockWriteContractAsync).toHaveBeenCalledTimes(1));
    expect(await within(bar).findByText(/Collected 0.003 WETH and 8 TEL\./)).toBeInTheDocument();
  });

  it("offers no bar for a single position with fees, and no collect on closed positions", async () => {
    await renderList([withFees(SUBSCRIBED, "0.001", "5"), { ...CLOSED, fees: { amount0: "0", amount1: "0" } }]);
    expect(screen.queryByTestId("collect-all")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collect fees from position 103" })).not.toBeInTheDocument();
  });

  it("waits its turn when a claim is already running on the page", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = runExclusive(() => new Promise<void>(resolve => (release = resolve)));
    await renderList([withFees(SUBSCRIBED, "0.001", "5")]);
    await user.click(screen.getByRole("button", { name: "Collect fees from position 101" }));
    expect(await within(row("101")).findByText(/Another claim is in progress/)).toBeInTheDocument();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    release();
    await held;
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

describe("UserPositions row behaviour and accessibility", () => {
  it("does not reload when the pool data refresh passes an equal pool, or when the wallet changes network", async () => {
    const { rerender } = await renderList();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<UserPositions selectedPool={{ ...selectedPool, assets: [...selectedPool.assets] }} currentPoolAddress={POOL_ID} />);
    mockWallet.chain = { id: 8453 };
    rerender(<UserPositions selectedPool={{ ...selectedPool }} currentPoolAddress={POOL_ID} />);

    expect(screen.queryByText(/Loading your positions/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an acted-on row, its outcome and its link in view under a status filter", async () => {
    const user = userEvent.setup();
    await renderList();
    await user.click(chip(/^Subscribed/));

    mockPositions([{ ...SUBSCRIBED, isSubscribed: false }, NOT_SUBSCRIBED, CLOSED]);
    await unsubscribeVia(user, "101");

    await waitFor(() => expect(within(row("101")).getByText("Unsubscribed.")).toBeInTheDocument());
    expect(within(row("101")).getByRole("link", { name: "View on Polygonscan" })).toBeInTheDocument();
    expect(chip(/^Subscribed \(0\)$/)).toBeInTheDocument();

    // Changing the filter lets the list follow the chips again.
    await user.click(chip(/^Not subscribed/));
    await user.click(chip(/^Subscribed/));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("keeps focus on the pressed button while its transaction runs", async () => {
    const user = userEvent.setup();
    const sent = deferred<string>();
    mockWriteContractAsync.mockImplementation(() => sent.promise);
    await renderList();

    const button = screen.getByRole("button", { name: "Subscribe position 102" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Subscribing... position 102" })).toHaveFocus();

    // A press on another row while one is in flight does nothing.
    await user.click(moreButton("101"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await act(async () => sent.resolve(HASH));
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the chip that Show all presses", async () => {
    const user = userEvent.setup();
    await renderList([SUBSCRIBED]);

    await user.click(chip(/^Not subscribed \(0\)$/));
    await user.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(chip(/^All/)).toHaveFocus());
  });

  it("keeps focus in the positions area when Try again replaces itself with the loader", async () => {
    const user = userEvent.setup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockPositions([SUBSCRIBED]);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(view());

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row("101")).toBeInTheDocument());
    expect(screen.getByTestId("positions-area")).toHaveFocus();
    expect(screen.getByTestId("positions-area")).toContainElement(row("101"));
  });

  it("uses a Subscribe colour with at least 4.5:1 contrast against its white label", async () => {
    await renderList();
    const button = screen.getByRole("button", { name: "Subscribe position 102" });
    expect(button).toHaveClass("bg-blue-1000", "text-white", "hover:bg-blue-1100");
    expect(button).not.toHaveClass("bg-blue-600");
  });
});

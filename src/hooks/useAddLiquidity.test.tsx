import { act, renderHook, waitFor } from "@testing-library/react";
import { decodeFunctionData, zeroAddress, type Hex } from "viem";
import { useAddLiquidity } from "./useAddLiquidity";
import { BASE_POSITION_MANAGER, MERKL_ETH_TEL_POOLID, MERKL_POLYGON_WETH_TEL_POOLID, MERKL_TELX_SUBSCRIBER, POLYGON_POSITION_MANAGER } from "../lib/contracts";
import { MAX_UINT160, MAX_UINT256, PERMIT2, positionManagerAbi } from "../lib/v4/positionManager";

const OWNER = "0x00000000000000000000000000000000000000aa";
const HASH = "0x00000000000000000000000000000000000000000000000000000000000000ff";
const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";

const mockWallet: { chainId: number } = { chainId: 137 };
const mockSwitchChainAsync = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockClient = {
  readContract: jest.fn(),
  getBalance: jest.fn(),
  simulateContract: jest.fn(),
  waitForTransactionReceipt: jest.fn(),
};

jest.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x00000000000000000000000000000000000000aa", chain: { id: mockWallet.chainId } }),
  usePublicClient: () => mockClient,
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/** On-chain state the read mock answers from; tests change it before rendering or between calls. */
const chainState = {
  currency0: WETH as string,
  tick: 140_355,
  nextTokenIds: [] as bigint[],
};

function answer({ functionName }: { functionName: string }) {
  switch (functionName) {
    case "poolKeys":
      return [chainState.currency0, TEL, 3000, 60, zeroAddress];
    case "getSlot0":
      return [1n << 96n, chainState.tick, 0, 3000];
    case "getLiquidity":
      return 10n ** 20n;
    case "decimals":
      return 18;
    case "balanceOf":
      return 5n * 10n ** 18n;
    case "allowance":
      return 0n;
    case "nextTokenId":
      return chainState.nextTokenIds.shift() ?? 500n;
    default:
      throw new Error(`unexpected read ${functionName}`);
  }
}

beforeEach(() => {
  mockWallet.chainId = 137;
  chainState.currency0 = WETH;
  chainState.tick = 140_355;
  chainState.nextTokenIds = [];
  mockSwitchChainAsync.mockReset().mockResolvedValue(undefined);
  mockWriteContractAsync.mockReset().mockResolvedValue(HASH);
  mockClient.readContract.mockReset().mockImplementation(async (call: { functionName: string; address: string }) =>
    call.functionName === "allowance" && call.address === PERMIT2 ? [0n, 0, 0] : answer(call),
  );
  mockClient.getBalance.mockReset().mockResolvedValue(10n ** 18n);
  mockClient.simulateContract.mockReset().mockResolvedValue({});
  mockClient.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success", transactionHash: HASH, blockNumber: 77n });
});

const RANGE = { tickLower: 137_460, tickUpper: 142_620 };
const REQUEST = { ...RANGE, liquidity: 10n ** 15n, amount0Max: 10n ** 16n, amount1Max: 10n ** 22n };

async function renderLoaded(blockchain = "polygon", poolId = MERKL_POLYGON_WETH_TEL_POOLID, onConfirmed = jest.fn()) {
  const view = renderHook(() => useAddLiquidity({ blockchain, poolId, onConfirmed }));
  await waitFor(() => expect(view.result.current.wallet).not.toBeNull());
  return { ...view, onConfirmed };
}

/** The token ids the multicall sent to the wallet subscribes. */
function subscribedIds(): bigint[] {
  return mockWriteContractAsync.mock.calls.map(([call]) => {
    const [, subscribe] = call.args[0] as Hex[];
    return decodeFunctionData({ abi: positionManagerAbi, data: subscribe }).args[0] as bigint;
  });
}

describe("reading the pool and wallet", () => {
  it("reads the pool key, price, decimals, balances and both approvals on the pool's chain", async () => {
    const { result } = await renderLoaded();
    expect(result.current.pool).toEqual({
      poolKey: { currency0: WETH, currency1: TEL, fee: 3000, tickSpacing: 60, hooks: zeroAddress },
      sqrtPriceX96: 1n << 96n,
      tick: 140_355,
      poolLiquidity: 10n ** 20n,
      decimals: [18, 18],
    });
    expect(result.current.wallet).toEqual({
      balances: [5n * 10n ** 18n, 5n * 10n ** 18n],
      approvals: [
        { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 },
        { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 },
      ],
    });
  });

  it("reads native ETH as a balance that needs no approval", async () => {
    chainState.currency0 = zeroAddress;
    const { result } = await renderLoaded("base", MERKL_ETH_TEL_POOLID);
    expect(result.current.wallet?.balances[0]).toBe(10n ** 18n);
    expect(result.current.wallet?.approvals[0]).toEqual({ erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 });
  });
});

describe("approvals", () => {
  it("approves the token for Permit2 for the maximum amount", async () => {
    const { result } = await renderLoaded();
    await act(() => result.current.approve({ kind: "erc20", currency: TEL, symbol: "TEL" }));
    expect(mockClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ address: TEL, functionName: "approve", args: [PERMIT2, MAX_UINT256] }));
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: TEL, functionName: "approve", args: [PERMIT2, MAX_UINT256], chainId: 137 }));
    expect(result.current.result).toEqual(expect.objectContaining({ kind: "success", message: "TEL approved for Permit2." }));
  });

  it("approves the PositionManager on Permit2 with an expiry", async () => {
    const { result } = await renderLoaded();
    const before = Math.floor(Date.now() / 1000);
    await act(() => result.current.approve({ kind: "permit2", currency: WETH, symbol: "WETH" }));
    const call = mockWriteContractAsync.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({ address: PERMIT2, functionName: "approve", chainId: 137 }));
    expect(call.args.slice(0, 3)).toEqual([WETH, POLYGON_POSITION_MANAGER, MAX_UINT160]);
    expect(call.args[3]).toBeGreaterThanOrEqual(before + 29 * 24 * 3600);
  });

  it("reports a cancelled approval without sending anything else", async () => {
    mockWriteContractAsync.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await renderLoaded();
    await act(() => result.current.approve({ kind: "erc20", currency: TEL, symbol: "TEL" }));
    expect(result.current.result).toEqual(expect.objectContaining({ kind: "notice", message: "Approving TEL was cancelled in your wallet, so nothing was sent." }));
    expect(mockClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe("add liquidity and subscribe", () => {
  it("simulates and sends one multicall that mints and subscribes the next token id", async () => {
    chainState.nextTokenIds = [146_048n];
    const { result, onConfirmed } = await renderLoaded();
    await act(() => result.current.add(REQUEST));

    expect(mockClient.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ address: POLYGON_POSITION_MANAGER, functionName: "multicall", value: 0n, account: OWNER }));
    const sent = mockWriteContractAsync.mock.calls[0][0];
    expect(sent).toEqual(expect.objectContaining({ address: POLYGON_POSITION_MANAGER, functionName: "multicall", value: 0n, chainId: 137 }));
    const [mint, subscribe] = sent.args[0] as Hex[];
    expect(decodeFunctionData({ abi: positionManagerAbi, data: mint }).functionName).toBe("modifyLiquidities");
    expect(decodeFunctionData({ abi: positionManagerAbi, data: subscribe }).args).toEqual([146_048n, MERKL_TELX_SUBSCRIBER, "0x"]);
    expect(onConfirmed).toHaveBeenCalledWith(77);
    expect(result.current.result).toEqual(
      expect.objectContaining({ kind: "success", message: "Position #146048 added and subscribed to TELx rewards.", txUrl: `https://polygonscan.com/tx/${HASH}` }),
    );
  });

  it("reads the next token id again and retries once when another mint took it", async () => {
    chainState.nextTokenIds = [146_048n, 146_049n];
    mockClient.simulateContract.mockRejectedValueOnce({ name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", data: { errorName: "NotApproved" } } });
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockClient.simulateContract).toHaveBeenCalledTimes(2);
    expect(subscribedIds()).toEqual([146_049n]);
    expect(result.current.result?.kind).toBe("success");
  });

  it("stops after the one retry, and sends nothing, when the id is taken again", async () => {
    const raced = { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionRevertedError", data: { errorName: "NotApproved" } } };
    mockClient.simulateContract.mockRejectedValueOnce(raced).mockRejectedValueOnce(raced);
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockClient.simulateContract).toHaveBeenCalledTimes(2);
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(result.current.result?.kind).toBe("error");
  });

  it("does not send when the price has moved out of the range", async () => {
    const { result } = await renderLoaded();
    chainState.tick = 150_000;
    await act(() => result.current.add(REQUEST));
    expect(mockClient.simulateContract).not.toHaveBeenCalled();
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(result.current.result).toEqual(
      expect.objectContaining({ kind: "error", message: "Adding liquidity was not sent. The price moved: The range must include the current price to earn TELx rewards." }),
    );
  });

  it("sends the native ETH maximum as value, on Base", async () => {
    chainState.currency0 = zeroAddress;
    mockWallet.chainId = 8453;
    const { result } = await renderLoaded("base", MERKL_ETH_TEL_POOLID);
    await act(() => result.current.add(REQUEST));
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: BASE_POSITION_MANAGER, value: REQUEST.amount0Max, chainId: 8453 }));
  });

  it("switches the wallet to the pool's chain before asking for a signature", async () => {
    mockWallet.chainId = 1;
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
  });

  it("explains an add that fails on chain, and refreshes nothing", async () => {
    mockClient.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", transactionHash: HASH, blockNumber: 78n });
    const { result, onConfirmed } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(result.current.result?.message).toMatch(/nothing was added/);
  });
});

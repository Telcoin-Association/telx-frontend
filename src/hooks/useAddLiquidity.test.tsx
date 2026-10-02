import { act, renderHook, waitFor } from "@testing-library/react";
import { decodeFunctionData, zeroAddress, type Hex } from "viem";
import { useAddLiquidity } from "./useAddLiquidity";
import { BASE_POSITION_MANAGER, MERKL_ETH_TEL_POOLID, MERKL_POLYGON_WETH_TEL_POOLID, MERKL_TELX_SUBSCRIBER, POLYGON_POSITION_MANAGER } from "../lib/contracts";
import { MAX_UINT256, PERMIT2, PERMIT_SECONDS, positionManagerAbi } from "../lib/v4/positionManager";

const OWNER = "0x00000000000000000000000000000000000000aa";
const HASH = "0x00000000000000000000000000000000000000000000000000000000000000ff";
const SIGNATURE = `0x${"11".repeat(65)}` as Hex;
const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";

const mockWallet: { chainId: number } = { chainId: 137 };
const mockSwitchChainAsync = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockSignTypedDataAsync = jest.fn();
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
  useSignTypedData: () => ({ signTypedDataAsync: mockSignTypedDataAsync }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const FAR = 4_000_000_000;

/** On-chain state the read mock answers from; tests change it before rendering or between calls. */
const chainState = {
  currency0: WETH as string,
  tick: 140_355,
  nextTokenIds: [] as bigint[],
  /** Each token's allowance to Permit2, and Permit2's allowance to the PositionManager, by lowercase token address. */
  erc20: {} as Record<string, bigint>,
  permit2: {} as Record<string, [bigint, number, number]>,
};

function answer(call: { functionName: string; address: string; args?: readonly unknown[] }) {
  switch (call.functionName) {
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
      return call.address === PERMIT2
        ? (chainState.permit2[String(call.args?.[1]).toLowerCase()] ?? [0n, 0, 0])
        : (chainState.erc20[call.address.toLowerCase()] ?? 0n);
    case "nextTokenId":
      return chainState.nextTokenIds.shift() ?? 500n;
    default:
      throw new Error(`unexpected read ${call.functionName}`);
  }
}

/** Both tokens approved for Permit2 and allowed to the PositionManager for a long time: an add needs no other step. */
function approveEverything() {
  for (const token of [WETH, TEL]) {
    chainState.erc20[token.toLowerCase()] = MAX_UINT256;
    chainState.permit2[token.toLowerCase()] = [10n ** 30n, FAR, 3];
  }
}

beforeEach(() => {
  mockWallet.chainId = 137;
  chainState.currency0 = WETH;
  chainState.tick = 140_355;
  chainState.nextTokenIds = [];
  chainState.erc20 = {};
  chainState.permit2 = {};
  approveEverything();
  mockSwitchChainAsync.mockReset().mockResolvedValue(undefined);
  mockWriteContractAsync.mockReset().mockResolvedValue(HASH);
  mockSignTypedDataAsync.mockReset().mockResolvedValue(SIGNATURE);
  mockClient.readContract.mockReset().mockImplementation(async (call: { functionName: string; address: string; args?: readonly unknown[] }) => answer(call));
  mockClient.getBalance.mockReset().mockResolvedValue(10n ** 18n);
  mockClient.simulateContract.mockReset().mockResolvedValue({});
  mockClient.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success", transactionHash: HASH, blockNumber: 77n });
});

const RANGE = { tickLower: 137_460, tickUpper: 142_620 };
const REQUEST = { ...RANGE, liquidity: 10n ** 15n, amount0Max: 10n ** 16n, amount1Max: 10n ** 22n, symbols: ["WETH", "TEL"] as [string, string] };

async function renderLoaded(blockchain = "polygon", poolId = MERKL_POLYGON_WETH_TEL_POOLID, onConfirmed = jest.fn()) {
  const view = renderHook(() => useAddLiquidity({ blockchain, poolId, onConfirmed }));
  await waitFor(() => expect(view.result.current.wallet).not.toBeNull());
  return { ...view, onConfirmed };
}

const multicalls = () => mockWriteContractAsync.mock.calls.map(([call]) => call).filter(call => call.functionName === "multicall");
const decoded = (data: Hex) => decodeFunctionData({ abi: positionManagerAbi, data });

/** The token ids the multicalls sent to the wallet subscribe. */
function subscribedIds(): bigint[] {
  return multicalls().map(call => {
    const subscribe = (call.args[0] as Hex[]).at(-1)!;
    return decoded(subscribe).args[0] as bigint;
  });
}

describe("reading the pool and wallet", () => {
  it("reads the pool key, price, decimals, balances and both approvals, with the Permit2 nonce, on the pool's chain", async () => {
    chainState.erc20 = {};
    chainState.permit2 = { [TEL.toLowerCase()]: [5n, 9, 2] };
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
        { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0, permit2Nonce: 0 },
        { erc20ToPermit2: 0n, permit2Amount: 5n, permit2Expiration: 9, permit2Nonce: 2 },
      ],
    });
  });

  it("reads native ETH as a balance that needs no approval", async () => {
    chainState.currency0 = zeroAddress;
    const { result } = await renderLoaded("base", MERKL_ETH_TEL_POOLID);
    expect(result.current.wallet?.balances[0]).toBe(10n ** 18n);
    expect(result.current.wallet?.approvals[0]).toEqual({ erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0, permit2Nonce: 0 });
  });
});

describe("one click, every step", () => {
  it("approves each new token, signs one allowance, then adds with the allowance in the same multicall", async () => {
    chainState.erc20 = {};
    chainState.permit2 = { [TEL.toLowerCase()]: [0n, 0, 4] };
    const { result } = await renderLoaded();
    const before = Math.floor(Date.now() / 1000);
    await act(() => result.current.add(REQUEST));

    const writes = mockWriteContractAsync.mock.calls.map(([call]) => call);
    expect(writes.map(call => [call.address, call.functionName])).toEqual([
      [WETH, "approve"],
      [TEL, "approve"],
      [POLYGON_POSITION_MANAGER, "multicall"],
    ]);
    expect(writes[0].args).toEqual([PERMIT2, MAX_UINT256]);
    // Each approval is confirmed before the next step is asked for.
    expect(mockClient.waitForTransactionReceipt.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[1]);

    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(1);
    const typed = mockSignTypedDataAsync.mock.calls[0][0];
    expect(typed.domain).toEqual({ name: "Permit2", chainId: 137, verifyingContract: PERMIT2 });
    expect(typed.message.spender).toBe(POLYGON_POSITION_MANAGER);
    expect(typed.message.details).toEqual([
      { token: WETH, amount: REQUEST.amount0Max, expiration: expect.any(Number), nonce: 0 },
      { token: TEL, amount: REQUEST.amount1Max, expiration: expect.any(Number), nonce: 4 },
    ]);
    expect(typed.message.details[0].expiration).toBeGreaterThanOrEqual(before + PERMIT_SECONDS);
    expect(typed.message.details[0].expiration).toBeLessThan(before + PERMIT_SECONDS + 60);

    const [permit, mint, subscribe] = writes[2].args[0] as Hex[];
    const permitCall = decoded(permit);
    expect(permitCall.functionName).toBe("permitBatch");
    expect(String(permitCall.args[0]).toLowerCase()).toBe(OWNER);
    expect(permitCall.args[2]).toBe(SIGNATURE);
    expect((permitCall.args[1] as { sigDeadline: bigint }).sigDeadline).toBe(typed.message.sigDeadline);
    expect(decoded(mint).functionName).toBe("modifyLiquidities");
    expect(decoded(subscribe).functionName).toBe("subscribe");
    expect(result.current.result?.kind).toBe("success");
  });

  it("signs only for the token whose Permit2 allowance falls short", async () => {
    chainState.permit2[WETH.toLowerCase()] = [1n, FAR, 7];
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockSignTypedDataAsync.mock.calls[0][0].message.details).toEqual([{ token: WETH, amount: REQUEST.amount0Max, expiration: expect.any(Number), nonce: 7 }]);
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
  });

  it("signs again for an allowance about to expire", async () => {
    chainState.permit2[TEL.toLowerCase()] = [10n ** 30n, Math.floor(Date.now() / 1000) + 60, 1];
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockSignTypedDataAsync.mock.calls[0][0].message.details.map((d: { token: string }) => d.token)).toEqual([TEL]);
  });

  it("asks for nothing but the add when everything is already allowed", async () => {
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled();
    expect((multicalls()[0].args[0] as Hex[]).map(call => decoded(call).functionName)).toEqual(["modifyLiquidities", "subscribe"]);
  });

  it("stops, sending nothing more, when an approval is cancelled", async () => {
    chainState.erc20 = {};
    mockWriteContractAsync.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(result.current.result).toEqual(expect.objectContaining({ kind: "notice", message: "Approving WETH was cancelled in your wallet, so nothing was sent." }));
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled();
  });

  it("stops when an approval fails on chain", async () => {
    chainState.erc20 = {};
    mockClient.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", transactionHash: HASH, blockNumber: 70n });
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(result.current.result).toEqual(expect.objectContaining({ kind: "error", message: "Approving WETH failed on chain." }));
    expect(mockWriteContractAsync).toHaveBeenCalledTimes(1);
  });

  it("adds nothing when the allowance isn't signed", async () => {
    chainState.permit2 = {};
    mockSignTypedDataAsync.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(result.current.result).toEqual(expect.objectContaining({ kind: "notice", message: "The token allowance was not signed, so nothing was added." }));
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });

  it("switches the wallet to the pool's chain once, before the first prompt", async () => {
    mockWallet.chainId = 1;
    chainState.erc20 = {};
    const { result } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(mockSwitchChainAsync).toHaveBeenCalledTimes(1);
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 137 });
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
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
    expect(decoded(mint).functionName).toBe("modifyLiquidities");
    expect(decoded(subscribe).args).toEqual([146_048n, MERKL_TELX_SUBSCRIBER, "0x"]);
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

  it("sends the native ETH maximum as value, on Base, with no approval or allowance for ETH", async () => {
    chainState.currency0 = zeroAddress;
    chainState.permit2 = {};
    mockWallet.chainId = 8453;
    const { result } = await renderLoaded("base", MERKL_ETH_TEL_POOLID);
    await act(() => result.current.add(REQUEST));
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: BASE_POSITION_MANAGER, value: REQUEST.amount0Max, chainId: 8453 }));
    expect(mockSignTypedDataAsync.mock.calls[0][0].message.details.map((d: { token: string }) => d.token)).toEqual([TEL]);
    expect(mockSignTypedDataAsync.mock.calls[0][0].domain.chainId).toBe(8453);
  });

  it("explains an add that fails on chain, and refreshes nothing", async () => {
    mockClient.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", transactionHash: HASH, blockNumber: 78n });
    const { result, onConfirmed } = await renderLoaded();
    await act(() => result.current.add(REQUEST));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(result.current.result?.message).toMatch(/nothing was added/);
  });
});

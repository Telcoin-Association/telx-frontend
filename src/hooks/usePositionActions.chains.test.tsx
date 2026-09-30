import { act, renderHook } from "@testing-library/react";
import { usePositionActions } from "./usePositionActions";
import {
  BASE_POSITION_MANAGER,
  BASE_SUBSCRIBER,
  ETHEREUM_POSITION_MANAGER,
  MERKL_ETH_TEL_POOLID,
  MERKL_POLYGON_WETH_TEL_POOLID,
  MERKL_TELX_SUBSCRIBER,
  POLYGON_POSITION_MANAGER,
} from "../lib/contracts";

const OWNER = "0x00000000000000000000000000000000000000aa";
const HASH = "0x00000000000000000000000000000000000000000000000000000000000000ff";

const mockWallet: { chainId: number } = { chainId: 137 };
const mockSwitchChainAsync = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockUsePublicClient = jest.fn();
const mockClient = {
  simulateContract: jest.fn(),
  waitForTransactionReceipt: jest.fn(),
};

jest.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x00000000000000000000000000000000000000aa", chain: { id: mockWallet.chainId } }),
  usePublicClient: (options: unknown) => mockUsePublicClient(options),
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

beforeEach(() => {
  mockWallet.chainId = 137;
  mockSwitchChainAsync.mockReset().mockResolvedValue(undefined);
  mockWriteContractAsync.mockReset().mockResolvedValue(HASH);
  mockClient.simulateContract.mockReset().mockResolvedValue({});
  mockClient.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success", transactionHash: HASH, blockNumber: 10n });
  mockUsePublicClient.mockReset().mockReturnValue(mockClient);
});

// Each registry chain, with the PositionManager, subscriber, chain id and explorer its transactions must use.
const CASES = [
  {
    blockchain: "polygon",
    poolId: MERKL_POLYGON_WETH_TEL_POOLID,
    chainId: 137,
    positionManager: POLYGON_POSITION_MANAGER,
    subscriber: MERKL_TELX_SUBSCRIBER,
    explorer: "https://polygonscan.com/tx/",
  },
  {
    blockchain: "base",
    poolId: "0x0000000000000000000000000000000000000000000000000000000000000b05",
    chainId: 8453,
    positionManager: BASE_POSITION_MANAGER,
    subscriber: BASE_SUBSCRIBER,
    explorer: "https://basescan.org/tx/",
  },
  {
    blockchain: "ethereum",
    poolId: MERKL_ETH_TEL_POOLID,
    chainId: 1,
    positionManager: ETHEREUM_POSITION_MANAGER,
    subscriber: MERKL_TELX_SUBSCRIBER,
    explorer: "https://etherscan.io/tx/",
  },
] as const;

describe("usePositionActions on each chain", () => {
  it.each(CASES)("subscribes a $blockchain position through its own chain's contracts", async ({ blockchain, poolId, chainId, positionManager, subscriber, explorer }) => {
    mockWallet.chainId = chainId === 137 ? 8453 : 137;
    const { result } = renderHook(() => usePositionActions({ blockchain, poolId }));

    await act(async () => {
      await result.current.subscribe("42");
    });

    expect(mockUsePublicClient).toHaveBeenCalledWith({ chainId });
    expect(mockClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: positionManager, functionName: "subscribe", args: [42n, subscriber, "0x"], account: OWNER }),
    );
    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId });
    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ address: positionManager, functionName: "subscribe", args: [42n, subscriber, "0x"], chainId }),
    );
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(mockWriteContractAsync.mock.invocationCallOrder[0]);
    expect(result.current.results["42"]).toMatchObject({ kind: "success", txUrl: `${explorer}${HASH}` });
  });

  it.each(CASES)("unsubscribes a $blockchain position on its chain without a switch when the wallet is already there", async ({ blockchain, poolId, chainId, positionManager }) => {
    mockWallet.chainId = chainId;
    const { result } = renderHook(() => usePositionActions({ blockchain, poolId }));

    await act(async () => {
      await result.current.unsubscribe("7");
    });

    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
    expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: positionManager, functionName: "unsubscribe", args: [7n], chainId }));
    expect(result.current.results["7"]).toMatchObject({ kind: "success", subscribed: false });
  });
});

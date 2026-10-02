import { act, renderHook } from "@testing-library/react";
import { useClaimAll } from "./useClaimAll";

const mockChain = { id: 137 as number | undefined };
const mockSwitch = jest.fn();
jest.mock("wagmi", () => ({
  useAccount: () => ({ chainId: mockChain.id }),
  useSwitchChain: () => ({ switchChainAsync: mockSwitch }),
  useWalletClient: () => ({ data: { writeContract: jest.fn() } }),
}));

// Gas of 100k at 30 gwei is 0.003 of the native token: $0.0006 at POL $0.20, $9 at ETH $3,000.
jest.mock("../lib/publicClients", () => {
  const client = () => ({
    estimateContractGas: jest.fn(async () => 100_000n),
    getGasPrice: jest.fn(async () => 30_000_000_000n),
    readContract: jest.fn(async () => 500n),
  });
  return { publicClientEthereum: client(), publicClientBase: client(), publicClientPolygon: client() };
});
jest.mock("../app/api/backendHelpers/helpers", () => ({ positionRegistryAbi: [] }));

const mockFetchMerkl = jest.fn();
jest.mock("../merkl/merklService", () => ({ fetchMerklRewards: (...args: unknown[]) => mockFetchMerkl(...args) }));
jest.mock("../web3/swap/usd", () => ({
  fetchSwapPrices: async (chain: string) => ({ "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": chain === "polygon" ? 0.2 : 3_000 }),
}));

function merkl(claimableWei: bigint) {
  const reward = { amount: String(claimableWei), tokenAddress: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731", tokenDecimals: 18, proofs: ["0x" + "11".repeat(32)] };
  return { summary: { claimableRewards: claimableWei > 0n ? [reward] : [], totalClaimable: String(claimableWei) } };
}

const USER = "0x00000000000000000000000000000000000000Aa";

beforeEach(() => {
  mockChain.id = 137;
  mockFetchMerkl.mockReset();
  mockFetchMerkl.mockImplementation(async (_user: string, chainId: number) => merkl(chainId === 1 ? 1_000n * 10n ** 18n : 200_000n * 10n ** 18n));
});

const render = (overrides: Partial<Parameters<typeof useClaimAll>[0]> = {}) =>
  renderHook(() =>
    useClaimAll({
      address: USER,
      merklClaimable: { polygon: 200_000, ethereum: 1_000 },
      oldPoolsClaimable: { base: 5 },
      telUsd: 0.002,
      onClaimed: jest.fn(),
      ...overrides,
    })
  );

describe("useClaimAll", () => {
  it("labels the button by the number of chains", () => {
    expect(render().result.current.label).toBe("Claim all (3 chains)");
    expect(render({ merklClaimable: { polygon: 1 }, oldPoolsClaimable: {} }).result.current.label).toBe("Claim TEL");
  });

  it("says why it is off when there is nothing to claim or no wallet", () => {
    expect(render({ merklClaimable: {}, oldPoolsClaimable: {} }).result.current.disabledReason).toBe("Nothing to claim yet.");
    expect(render({ address: undefined }).result.current.disabledReason).toBe("Connect a wallet to claim.");
    expect(render().result.current.disabledReason).toBeNull();
  });

  it("builds the plan from fresh amounts with each row's network fee, unchecking a claim that costs more than it pays", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.open();
    });

    expect(result.current.phase).toBe("review");
    // Every Merkl figure is read fresh for its chain before the fee is estimated.
    expect(mockFetchMerkl).toHaveBeenCalledWith(USER, 137, { reloadChainId: 137 });
    expect(mockFetchMerkl).toHaveBeenCalledWith(USER, 1, { reloadChainId: 1 });
    const byId = Object.fromEntries(result.current.rows.map((row) => [row.id, row]));
    expect(result.current.rows[0].id).toBe("merkl:polygon");
    expect(byId["merkl:polygon"].feeUsd).toBeCloseTo(0.0006);
    expect(byId["merkl:polygon"].checked).toBe(true);
    // $9 of gas for $2 of TEL.
    expect(byId["merkl:ethereum"]).toMatchObject({ valueUsd: 2, uneconomic: true, checked: false });
    expect(byId["merkl:ethereum"].feeUsd).toBeCloseTo(9);
    expect(byId["oldPools:base"]).toMatchObject({ valueUsd: null, checked: true });

    act(() => result.current.toggle("merkl:ethereum"));
    expect(result.current.rows.find((row) => row.id === "merkl:ethereum")?.checked).toBe(true);

    act(() => result.current.close());
    expect(result.current.phase).toBe("closed");
  });
});

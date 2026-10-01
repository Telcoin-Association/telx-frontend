import { renderHook, waitFor } from "@testing-library/react";
import { useTokenBalances } from "./useTokenBalances";

const mockRead = { ethereum: jest.fn(), polygon: jest.fn(), base: jest.fn() };
jest.mock("../lib/publicClients", () => ({
  publicClientEthereum: { readContract: (...args: unknown[]) => mockRead.ethereum(...args) },
  publicClientPolygon: { readContract: (...args: unknown[]) => mockRead.polygon(...args) },
  publicClientBase: { readContract: (...args: unknown[]) => mockRead.base(...args) },
}));

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
const TOKENS = { polygon: "0x0000000000000000000000000000000000000001", base: "0x0000000000000000000000000000000000000002" } as const;

beforeEach(() => Object.values(mockRead).forEach((read) => read.mockReset()));

describe("useTokenBalances", () => {
  it("reads balanceOf once per chain and leaves a failed chain out", async () => {
    mockRead.polygon.mockResolvedValue(150_000n);
    mockRead.base.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useTokenBalances(OWNER, TOKENS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balances).toEqual({ polygon: 150_000n });
    expect(mockRead.polygon).toHaveBeenCalledWith(expect.objectContaining({ address: TOKENS.polygon, functionName: "balanceOf", args: [OWNER] }));
    expect(mockRead.ethereum).not.toHaveBeenCalled();
  });

  it("reads nothing without an owner", () => {
    const { result } = renderHook(() => useTokenBalances(undefined, TOKENS));
    expect(result.current).toEqual({ balances: {}, loading: false });
    expect(mockRead.polygon).not.toHaveBeenCalled();
  });
});

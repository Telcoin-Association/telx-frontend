import { renderHook, waitFor } from "@testing-library/react";
import { useLiquidityDistribution } from "./useLiquidityDistribution";
import { STATE_VIEW } from "../lib/v4/positionManager";
import type { TickRange } from "../lib/v4/range";

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const mockClient = { readContract: jest.fn() };
jest.mock("wagmi", () => ({ usePublicClient: () => mockClient }));

// Word 0 (spacing 60) has ticks 0 and 600 initialized; word -1 has tick -600.
const BITMAPS: Record<number, bigint> = { [-1]: 1n << 246n, 0: (1n << 0n) | (1n << 10n) };
const NETS: Record<number, bigint> = { [-600]: 100n, 0: 50n, 600: -150n };

beforeEach(() => {
  mockClient.readContract.mockReset().mockImplementation(async ({ functionName, args }: { functionName: string; args: [string, number] }) => {
    if (functionName === "getTickBitmap") return BITMAPS[args[1]] ?? 0n;
    if (functionName === "getTickLiquidity") return [1n, NETS[args[1]]];
    throw new Error(functionName);
  });
});

const render = (window: TickRange) =>
  renderHook((props: { window: TickRange }) => useLiquidityDistribution({ chainId: 137, poolId: POOL, tickSpacing: 60, window: props.window, currentTick: 300, activeLiquidity: 150n }), {
    initialProps: { window },
  });

describe("useLiquidityDistribution", () => {
  it("reads the bitmap words and initialized ticks in the window from StateView, then walks the liquidity", async () => {
    const { result } = render({ tickLower: -1_200, tickUpper: 1_200 });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([
      { tickLower: -1_200, tickUpper: -600, liquidity: 0n },
      { tickLower: -600, tickUpper: 0, liquidity: 100n },
      { tickLower: 0, tickUpper: 300, liquidity: 150n },
      { tickLower: 300, tickUpper: 600, liquidity: 150n },
      { tickLower: 600, tickUpper: 1_200, liquidity: 0n },
    ]);
    expect(mockClient.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: STATE_VIEW[137], functionName: "getTickBitmap", args: [POOL, -1] }));
    expect(mockClient.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getTickLiquidity", args: [POOL, -600] }));
  });

  it("reads nothing again when the window moves within words it already has", async () => {
    const { result, rerender } = render({ tickLower: -1_200, tickUpper: 1_200 });
    await waitFor(() => expect(result.current).not.toBeNull());
    const reads = mockClient.readContract.mock.calls.length;
    rerender({ window: { tickLower: -900, tickUpper: 900 } });
    expect(result.current?.[0]).toEqual({ tickLower: -900, tickUpper: -600, liquidity: 0n });
    expect(mockClient.readContract).toHaveBeenCalledTimes(reads);
  });

  it("is null when the read fails, so the chart says it has no data rather than drawing a wrong one", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockClient.readContract.mockRejectedValue(new Error("rpc down"));
    const { result } = render({ tickLower: -1_200, tickUpper: 1_200 });
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(result.current).toBeNull();
    error.mockRestore();
  });
});

import { act, renderHook } from "@testing-library/react";
import type { SettleObservation, VaultLifecycleStatus } from "@/web3/eusdVault/types";
import { settleSatisfied, useVaultSettlePolling, type VaultSettlePollingInput } from "./useVaultSettlePolling";

// The first poll fires inside the mount effect, so every mock is configured before the hook renders.
function createMocks() {
  return {
    refetch: jest.fn<Promise<SettleObservation>, []>(),
    onSettled: jest.fn<void, []>(),
  };
}

function setup(mocks: ReturnType<typeof createMocks>, overrides: Partial<VaultSettlePollingInput> = {}) {
  const initialProps: VaultSettlePollingInput = {
    status: "confirmed",
    kind: "approve",
    amountIn: 100n,
    confirmedBlock: 50n,
    ...mocks,
    intervalMs: 10,
    maxMs: 25,
    ...overrides,
  };
  const view = renderHook((props: VaultSettlePollingInput) => useVaultSettlePolling(props), { initialProps });
  return { ...view, initialProps };
}

// Lets the async tick left behind by a fired timer (or by the mount effect) run to the end.
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("settleSatisfied", () => {
  it("settles an approve when the allowance covers the submitted amount", () => {
    const target = { amountIn: 100n, confirmedBlock: 50n };
    expect(settleSatisfied("approve", { allowanceIn: 100n, blockNumber: 1n }, target)).toBe(true);
    expect(settleSatisfied("approve", { allowanceIn: 101n }, target)).toBe(true);
    expect(settleSatisfied("approve", { allowanceIn: 99n, blockNumber: 1_000n }, target)).toBe(false);
  });

  it("never settles an approve with a missing allowance or amount", () => {
    expect(settleSatisfied("approve", { blockNumber: 1_000n }, { amountIn: 100n, confirmedBlock: 50n })).toBe(false);
    expect(settleSatisfied("approve", { allowanceIn: 100n }, { confirmedBlock: 50n })).toBe(false);
    expect(settleSatisfied("approve", {}, {})).toBe(false);
  });

  it("settles a swap once the read's block reaches the receipt block", () => {
    const target = { amountIn: 100n, confirmedBlock: 50n };
    expect(settleSatisfied("swap", { blockNumber: 50n }, target)).toBe(true);
    expect(settleSatisfied("swap", { blockNumber: 51n }, target)).toBe(true);
    expect(settleSatisfied("swap", { blockNumber: 49n, allowanceIn: 1_000n }, target)).toBe(false);
  });

  it("never settles a swap with a missing block", () => {
    expect(settleSatisfied("swap", { allowanceIn: 1_000n }, { amountIn: 100n, confirmedBlock: 50n })).toBe(false);
    expect(settleSatisfied("swap", { blockNumber: 50n }, { amountIn: 100n })).toBe(false);
    expect(settleSatisfied("swap", {}, {})).toBe(false);
  });
});

describe("useVaultSettlePolling", () => {
  it("settles an approval on the second poll and reports it once", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValueOnce({ allowanceIn: 0n, blockNumber: 60n }).mockResolvedValue({ allowanceIn: 100n });
    const { result } = setup(mocks);

    await advance(0);
    expect(result.current.settle).toBe("polling");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).not.toHaveBeenCalled();

    await advance(10);
    expect(result.current.settle).toBe("settled");
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);

    await advance(50);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("keeps polling an approval while the allowance is below the submitted amount", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 99n, blockNumber: 1_000n });
    const { result } = setup(mocks, { maxMs: 1_000 });

    await advance(30);
    expect(result.current.settle).toBe("polling");
    expect(mocks.refetch).toHaveBeenCalledTimes(4);
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("settles a swap when the read reaches the receipt block", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValueOnce({ blockNumber: 49n, allowanceIn: 1_000n }).mockResolvedValue({ blockNumber: 50n });
    const { result } = setup(mocks, { kind: "swap" });

    await advance(0);
    expect(result.current.settle).toBe("polling");
    await advance(10);
    expect(result.current.settle).toBe("settled");
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles a swap on a read past the receipt block", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ blockNumber: 51n });
    const { result } = setup(mocks, { kind: "swap" });

    await advance(0);
    expect(result.current.settle).toBe("settled");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("keeps polling a swap while the read is older than the receipt block", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ blockNumber: 49n, allowanceIn: 1_000n });
    const { result } = setup(mocks, { kind: "swap", maxMs: 1_000 });

    await advance(30);
    expect(result.current.settle).toBe("polling");
    expect(mocks.refetch).toHaveBeenCalledTimes(4);
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("times out, stops, and settles from a poll restarted by refresh", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ blockNumber: 49n });
    const { result } = setup(mocks, { kind: "swap" });

    await advance(40);
    expect(result.current.settle).toBe("timed-out");
    expect(mocks.refetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    const pollsBeforeRefresh = mocks.refetch.mock.calls.length;

    await advance(50);
    expect(mocks.refetch).toHaveBeenCalledTimes(pollsBeforeRefresh);

    mocks.refetch.mockResolvedValueOnce({ blockNumber: 49n }).mockResolvedValue({ blockNumber: 50n });
    act(() => result.current.refresh());
    expect(result.current.settle).toBe("polling");
    await advance(0);
    expect(result.current.settle).toBe("polling");
    expect(mocks.refetch).toHaveBeenCalledTimes(pollsBeforeRefresh + 1);

    await advance(10);
    expect(result.current.settle).toBe("settled");
    expect(mocks.refetch).toHaveBeenCalledTimes(pollsBeforeRefresh + 2);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("times out again when the restarted poll still sees the old state", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ blockNumber: 49n });
    const { result } = setup(mocks, { kind: "swap" });
    await advance(40);
    const pollsBeforeRefresh = mocks.refetch.mock.calls.length;

    act(() => result.current.refresh());
    await advance(20);
    expect(result.current.settle).toBe("polling");
    await advance(20);
    expect(result.current.settle).toBe("timed-out");
    expect(mocks.refetch).toHaveBeenCalledTimes(pollsBeforeRefresh + 4);
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("ignores refresh while polling and after settling", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValueOnce({ allowanceIn: 0n }).mockResolvedValue({ allowanceIn: 100n });
    const { result } = setup(mocks);
    await advance(0);

    act(() => result.current.refresh());
    await advance(0);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    await advance(10);
    expect(result.current.settle).toBe("settled");
    act(() => result.current.refresh());
    await advance(50);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("treats a rejected refetch as not settled", async () => {
    const mocks = createMocks();
    mocks.refetch.mockRejectedValueOnce(new Error("network")).mockResolvedValue({ allowanceIn: 100n });
    const { result } = setup(mocks);

    await advance(0);
    expect(result.current.settle).toBe("polling");
    expect(mocks.onSettled).not.toHaveBeenCalled();
    await advance(10);
    expect(result.current.settle).toBe("settled");
  });

  it("times out when every refetch is rejected", async () => {
    const mocks = createMocks();
    mocks.refetch.mockRejectedValue(new Error("network"));
    const { result } = setup(mocks);

    await advance(40);
    expect(result.current.settle).toBe("timed-out");
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("returns to idle when the status leaves confirmed and restarts on the next cycle", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 100n });
    const { result, rerender, initialProps } = setup(mocks);

    await advance(0);
    expect(result.current.settle).toBe("settled");

    rerender({ ...initialProps, status: "idle" });
    expect(result.current.settle).toBe("idle");
    await advance(50);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    mocks.refetch.mockResolvedValue({ allowanceIn: 0n });
    rerender({ ...initialProps, status: "confirmed" });
    expect(result.current.settle).toBe("polling");
    await advance(0);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(result.current.settle).toBe("polling");
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);

    mocks.refetch.mockResolvedValue({ allowanceIn: 100n });
    await advance(10);
    expect(result.current.settle).toBe("settled");
    expect(mocks.onSettled).toHaveBeenCalledTimes(2);
  });

  it("does nothing in any status other than confirmed", async () => {
    const statuses: VaultLifecycleStatus[] = ["idle", "preflight", "signing", "confirming", "verifying", "failed"];
    for (const status of statuses) {
      const mocks = createMocks();
      mocks.refetch.mockResolvedValue({ allowanceIn: 100n, blockNumber: 50n });
      const { result, unmount } = setup(mocks, { status });

      await advance(50);
      act(() => result.current.refresh());
      await advance(50);

      expect(result.current.settle).toBe("idle");
      expect(mocks.refetch).not.toHaveBeenCalled();
      expect(mocks.onSettled).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("does nothing while confirmed without an operation kind", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 100n, blockNumber: 50n });
    const { result } = setup(mocks, { kind: undefined, observed: true });

    await advance(50);
    expect(result.current.settle).toBe("idle");
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("stops polling on unmount", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 0n });
    const { unmount } = setup(mocks);

    await advance(0);
    unmount();
    await advance(50);

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a refetch that resolves after unmount", async () => {
    const mocks = createMocks();
    let resolve!: (o: SettleObservation) => void;
    mocks.refetch.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { unmount } = setup(mocks);

    unmount();
    resolve({ allowanceIn: 100n });
    await advance(50);

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("ignores a refetch that resolves after the status left confirmed", async () => {
    const mocks = createMocks();
    let resolve!: (o: SettleObservation) => void;
    mocks.refetch.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result, rerender, initialProps } = setup(mocks);

    rerender({ ...initialProps, status: "idle" });
    resolve({ allowanceIn: 100n });
    await advance(50);

    expect(result.current.settle).toBe("idle");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).not.toHaveBeenCalled();
  });

  it("does not overlap a refetch still in flight from an earlier cycle", async () => {
    const mocks = createMocks();
    let resolve!: (o: SettleObservation) => void;
    mocks.refetch
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValue({ allowanceIn: 100n });
    const { result, rerender, initialProps } = setup(mocks);

    rerender({ ...initialProps, status: "idle" });
    rerender({ ...initialProps, status: "confirmed" });
    await advance(10);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    // The earlier cycle's answer is dropped even though it would settle.
    resolve({ allowanceIn: 100n });
    await advance(0);
    expect(result.current.settle).toBe("polling");
    expect(mocks.onSettled).not.toHaveBeenCalled();

    await advance(10);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(result.current.settle).toBe("settled");
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles at once when the page already observes the post-state", () => {
    const mocks = createMocks();
    const { result } = setup(mocks, { observed: true });

    expect(result.current.settle).toBe("settled");
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("settles a timed-out cycle once the page observes the post-state", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ blockNumber: 49n });
    const { result, rerender, initialProps } = setup(mocks, { kind: "swap" });

    await advance(40);
    expect(result.current.settle).toBe("timed-out");
    expect(mocks.onSettled).not.toHaveBeenCalled();

    rerender({ ...initialProps, kind: "swap", observed: true });

    expect(result.current.settle).toBe("settled");
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the page observes the post-state mid-poll", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 0n });
    const { result, rerender, initialProps } = setup(mocks, { maxMs: 1_000 });
    await advance(0);

    rerender({ ...initialProps, maxMs: 1_000, observed: true });
    expect(result.current.settle).toBe("settled");
    await advance(50);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("calls onSettled once when the page observes the post-state after the poll settled", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 100n });
    const { result, rerender, initialProps } = setup(mocks);
    await advance(0);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);

    rerender({ ...initialProps, observed: true });
    rerender({ ...initialProps, observed: false });
    await advance(50);

    expect(result.current.settle).toBe("settled");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.onSettled).toHaveBeenCalledTimes(1);
  });

  it("polls every 2 seconds for up to 30 seconds by default", async () => {
    const mocks = createMocks();
    mocks.refetch.mockResolvedValue({ allowanceIn: 0n });
    const { result } = setup(mocks, { intervalMs: undefined, maxMs: undefined });

    await advance(0);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    await advance(1_999);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);

    await advance(26_000);
    expect(result.current.settle).toBe("polling");
    await advance(2_000);
    expect(result.current.settle).toBe("timed-out");
    expect(mocks.refetch).toHaveBeenCalledTimes(16);
    await advance(10_000);
    expect(mocks.refetch).toHaveBeenCalledTimes(16);
  });
});

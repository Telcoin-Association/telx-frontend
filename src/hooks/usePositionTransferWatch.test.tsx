import { act, renderHook } from "@testing-library/react";
import type { PositionTransfer, TransferFeed } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { MAX_POLL_BACKOFF_MS, transferRefetchBlock, usePositionTransferWatch, type PositionTransferWatchOptions } from "./usePositionTransferWatch";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const OWNER_LOWER = OWNER.toLowerCase();
const OTHER = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";

const transfer = (tokenId: string, from: string, to: string, blockNumber: number): PositionTransfer => ({
  tokenId,
  from,
  to,
  blockNumber,
  logIndex: 0,
});
const feed = (head: number, transfers: PositionTransfer[] = [], chain: RpcChain = "polygon"): TransferFeed => ({
  chain,
  head,
  fromBlock: head - 299,
  transfers,
});
// A minimal Response: reading a real body goes through timers that the fake clock would hold back.
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let visibility: DocumentVisibilityState = "visible";
beforeAll(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  visibility = "visible";
});

afterEach(() => {
  jest.useRealTimers();
});

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

// Lets pending fetch promises and their callbacks run without moving the clock.
const flush = () => act(() => jest.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

function watch(options: Partial<PositionTransferWatchOptions> & { responses?: TransferFeed[] } = {}) {
  const responses = options.responses ?? [];
  let call = 0;
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit?]>(async () =>
    json(responses[Math.min(call++, responses.length - 1)] ?? feed(1_000)),
  );
  const onTransfer = jest.fn();
  const view = renderHook(() =>
    usePositionTransferWatch({ owner: OWNER, chains: ["polygon"], onTransfer, fetchImpl: fetchImpl as unknown as typeof fetch, ...options }),
  );
  return { fetchImpl, onTransfer, ...view };
}

describe("transferRefetchBlock", () => {
  it("counts every transfer to or from the owner in the window on the first read", () => {
    expect(transferRefetchBlock(feed(1_000, [transfer("1", ZERO, OWNER_LOWER, 900), transfer("2", OTHER, ZERO, 950)]), OWNER, undefined)).toBe(900);
    expect(transferRefetchBlock(feed(1_000, [transfer("2", OTHER, ZERO, 950)]), OWNER, undefined)).toBeNull();
  });

  it("counts only transfers after the last seen head, and returns the newest one's block", () => {
    const transfers = [transfer("1", ZERO, OWNER_LOWER, 990), transfer("2", OWNER_LOWER, OTHER, 996), transfer("3", ZERO, OWNER_LOWER, 998)];
    expect(transferRefetchBlock(feed(1_000, transfers), OWNER, 995)).toBe(998);
    expect(transferRefetchBlock(feed(1_000, transfers), OWNER, 998)).toBeNull();
  });

  it("returns the head when the window starts after the last seen head", () => {
    expect(transferRefetchBlock(feed(2_000), OWNER, 1_000)).toBe(2_000);
    expect(transferRefetchBlock(feed(2_000), OWNER, 1_700)).toBeNull();
  });
});

describe("usePositionTransferWatch", () => {
  it("polls the chain's feed at once and then about once per block while visible", async () => {
    const { fetchImpl } = watch();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual(["/api/positions/transfers?chain=polygon", expect.objectContaining({ signal: expect.any(AbortSignal) })]);

    await advance(1_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await advance(2_000 * 5);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("polls Ethereum at its own block time, one feed per chain", async () => {
    const { fetchImpl } = watch({ chains: ["ethereum", "polygon", "ethereum"] });
    await flush();
    expect(fetchImpl.mock.calls.map(([url]) => url).sort()).toEqual([
      "/api/positions/transfers?chain=ethereum",
      "/api/positions/transfers?chain=polygon",
    ]);
    await advance(12_000);
    const urls = fetchImpl.mock.calls.map(([url]) => url as string);
    expect(urls.filter(url => url.endsWith("ethereum"))).toHaveLength(2);
    expect(urls.filter(url => url.endsWith("polygon"))).toHaveLength(7);
  });

  it("stops polling while hidden and polls at once when visible again", async () => {
    const { fetchImpl } = watch();
    await flush();
    setVisibility("hidden");
    await advance(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await advance(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not start polling when mounted hidden, until the page becomes visible", async () => {
    visibility = "hidden";
    const { fetchImpl } = watch();
    await advance(10_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    setVisibility("visible");
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("polls at once when the window gains focus, without doubling up on an in-flight poll", async () => {
    const { fetchImpl } = watch();
    await flush();
    await advance(500);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The next poll is one block after the focus poll, not after the earlier one.
    await advance(1_999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("calls onTransfer only for a new transfer to or from the owner", async () => {
    const { onTransfer } = watch({
      responses: [
        feed(1_000, [transfer("1", OTHER, ZERO, 990)]),
        feed(1_001, [transfer("2", ZERO, OTHER, 1_001)]),
        feed(1_002, [transfer("3", ZERO, OWNER_LOWER, 1_002)]),
        feed(1_003, [transfer("3", ZERO, OWNER_LOWER, 1_002)]),
        feed(1_004, [transfer("3", ZERO, OWNER_LOWER, 1_002), transfer("4", OWNER_LOWER, OTHER, 1_004)]),
      ],
    });
    await flush();
    await advance(2_000);
    expect(onTransfer).not.toHaveBeenCalled();

    await advance(2_000);
    expect(onTransfer).toHaveBeenCalledTimes(1);
    expect(onTransfer).toHaveBeenLastCalledWith("polygon", 1_002);

    await advance(2_000);
    expect(onTransfer).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(onTransfer).toHaveBeenCalledTimes(2);
    expect(onTransfer).toHaveBeenLastCalledWith("polygon", 1_004);
  });

  it("ignores a stale feed older than one already processed", async () => {
    const { onTransfer } = watch({
      responses: [feed(1_010), feed(1_005, [transfer("3", ZERO, OWNER_LOWER, 1_004)])],
    });
    await flush();
    await advance(2_000);
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("calls onTransfer with the head after being hidden for longer than the window", async () => {
    const { onTransfer } = watch({ responses: [feed(1_000), feed(5_000)] });
    await flush();
    setVisibility("hidden");
    await advance(600_000);
    setVisibility("visible");
    await flush();
    expect(onTransfer).toHaveBeenCalledWith("polygon", 5_000);
  });

  it("backs off after failures and resets after a success", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ error: "Transfer feed unavailable" }, 502))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(json(feed(1_000)));
    renderHook(() => usePositionTransferWatch({ owner: OWNER, chains: ["polygon"], onTransfer: jest.fn(), fetchImpl }));
    await flush();
    await advance(3_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await advance(8_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await advance(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("caps the backoff", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 502));
    renderHook(() => usePositionTransferWatch({ owner: OWNER, chains: ["polygon"], onTransfer: jest.fn(), fetchImpl }));
    await flush();
    await advance(10 * 60_000);
    const calls = fetchImpl.mock.calls.length;
    await advance(MAX_POLL_BACKOFF_MS);
    expect(fetchImpl.mock.calls.length).toBe(calls + 1);
  });

  it("does nothing without an owner, without chains, or when disabled", async () => {
    for (const options of [{ owner: undefined }, { chains: [] }, { enabled: false }]) {
      const { fetchImpl, unmount } = watch(options);
      await advance(10_000);
      expect(fetchImpl).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("stops polling and ignores an in-flight response after unmount", async () => {
    let resolve!: (response: Response) => void;
    const fetchImpl = jest.fn(() => new Promise<Response>(r => (resolve = r)));
    const onTransfer = jest.fn();
    const { unmount } = renderHook(() => usePositionTransferWatch({ owner: OWNER, chains: ["polygon"], onTransfer, fetchImpl }));
    await flush();
    const signal = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true);
    resolve(json(feed(1_000, [transfer("1", ZERO, OWNER_LOWER, 1_000)])));
    await advance(60_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("restarts for a new owner without calling the previous owner's callback", async () => {
    const onTransfer = jest.fn();
    const fetchImpl = jest.fn(async () => json(feed(1_000, [transfer("1", ZERO, OTHER, 1_000)])));
    const { rerender } = renderHook(({ owner }) => usePositionTransferWatch({ owner, chains: ["polygon"], onTransfer, fetchImpl }), {
      initialProps: { owner: OWNER },
    });
    await flush();
    expect(onTransfer).not.toHaveBeenCalled();
    rerender({ owner: OTHER });
    await flush();
    expect(onTransfer).toHaveBeenCalledWith("polygon", 1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

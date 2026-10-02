import { renderHook, waitFor } from "@testing-library/react";
import { usePoolSvl } from "./usePoolSvl";

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const days = [{ date: "2026-09-25", svlUSD: 50_000, estimated: true }];

afterEach(() => jest.restoreAllMocks());

describe("usePoolSvl", () => {
  it("loads the pool's SVL days", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ days }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => usePoolSvl("polygon", POOL, true));

    await waitFor(() => expect(result.current).toEqual(days));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/pools/svl?chain=polygon&poolId=${POOL}`);
  });

  it("does not fetch when disabled", () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => usePoolSvl("polygon", POOL, false));

    expect(result.current).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays empty when the read fails", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => usePoolSvl("polygon", POOL, true));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

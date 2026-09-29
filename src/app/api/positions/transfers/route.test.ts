/**
 * @jest-environment node
 */
const getBlockNumber = jest.fn();
const getLogs = jest.fn();
jest.mock("../../backendHelpers/alchemy", () => {
  const client = { getBlockNumber: (...args: unknown[]) => getBlockNumber(...args), getLogs: (...args: unknown[]) => getLogs(...args) };
  return { publicClientPolygon: client, publicClientBase: client, publicClientEthereum: client };
});

import { NextRequest } from "next/server";
import { HttpRequestError } from "viem";
import { BASE_POSITION_MANAGER, POLYGON_POSITION_MANAGER } from "@/lib/contracts";
import { clearTransferFeedCache } from "@/server/positions/transfers";
import { GET } from "./route";

const request = (search: string) => new NextRequest(`https://telx.network/api/positions/transfers${search}`);

const A = "0x00000000000000000000000000000000000000Aa";
const B = "0x00000000000000000000000000000000000000bB";
const ZERO = "0x0000000000000000000000000000000000000000";
const log = (tokenId: bigint, from: string, to: string, blockNumber: bigint, logIndex: number) => ({
  args: { from, to, tokenId },
  blockNumber,
  logIndex,
});

beforeEach(() => {
  clearTransferFeedCache();
  getBlockNumber.mockReset();
  getLogs.mockReset();
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/positions/transfers", () => {
  it("returns the head and the window's transfers, oldest first, with lowercase addresses", async () => {
    getBlockNumber.mockResolvedValue(1_000n);
    getLogs.mockResolvedValue([log(9n, A, B, 999n, 4), log(7n, ZERO, A, 990n, 1), log(8n, ZERO, A, 999n, 2)]);

    const res = await GET(request("?chain=polygon"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      chain: "polygon",
      head: 1000,
      fromBlock: 701,
      transfers: [
        { tokenId: "7", from: ZERO, to: A.toLowerCase(), blockNumber: 990, logIndex: 1 },
        { tokenId: "8", from: ZERO, to: A.toLowerCase(), blockNumber: 999, logIndex: 2 },
        { tokenId: "9", from: A.toLowerCase(), to: B.toLowerCase(), blockNumber: 999, logIndex: 4 },
      ],
    });
  });

  it("reads the head fresh and makes one eth_getLogs over the window on the chain's PositionManager", async () => {
    getBlockNumber.mockResolvedValue(20_000n);
    getLogs.mockResolvedValue([]);

    await GET(request("?chain=base"));
    expect(getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 });
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(getLogs.mock.calls[0][0]).toMatchObject({
      address: BASE_POSITION_MANAGER,
      fromBlock: 19_701n,
      toBlock: 20_000n,
      strict: true,
      event: expect.objectContaining({ type: "event", name: "Transfer" }),
    });
  });

  it("uses a shorter window on Ethereum", async () => {
    getBlockNumber.mockResolvedValue(100n);
    getLogs.mockResolvedValue([]);
    const body = await (await GET(request("?chain=ethereum"))).json();
    expect(body).toMatchObject({ head: 100, fromBlock: 51 });
  });

  it("clamps the window at block zero", async () => {
    getBlockNumber.mockResolvedValue(10n);
    getLogs.mockResolvedValue([]);
    await GET(request("?chain=polygon"));
    expect(getLogs.mock.calls[0][0]).toMatchObject({ address: POLYGON_POSITION_MANAGER, fromBlock: 0n, toBlock: 10n });
  });

  it.each([
    ["polygon", "public, s-maxage=2, stale-while-revalidate=6"],
    ["base", "public, s-maxage=2, stale-while-revalidate=6"],
    ["ethereum", "public, s-maxage=12, stale-while-revalidate=36"],
  ])("caches the %s feed at the edge for about one block", async (chain, header) => {
    getBlockNumber.mockResolvedValue(1_000n);
    getLogs.mockResolvedValue([]);
    const res = await GET(request(`?chain=${chain}`));
    expect(res.headers.get("Cache-Control")).toBe(header);
  });

  it.each(["", "?chain=", "?chain=arbitrum", "?chain=Polygon", "?chain=polygon%00"])("rejects %j with 400 before any upstream call", async search => {
    const res = await GET(request(search));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getBlockNumber).not.toHaveBeenCalled();
  });

  it.each(["?chain=polygon&x=1", "?x=1&chain=polygon", "?chain=polygon&chain=base", "?chain=polygon&", "?chain=%70olygon"])(
    "redirects %j to the canonical URL with a cacheable 308 and no upstream call",
    async search => {
      const res = await GET(request(search));
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe("/api/positions/transfers?chain=polygon");
      expect(res.headers.get("Cache-Control")).toMatch(/^public, .*s-maxage=\d+/);
      expect(getBlockNumber).not.toHaveBeenCalled();
      expect(getLogs).not.toHaveBeenCalled();
    },
  );

  it("answers an upstream failure with a fixed 502 that is not cached, and logs it without the Alchemy key", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    getBlockNumber.mockResolvedValue(1_000n);
    getLogs.mockRejectedValue(
      new HttpRequestError({ url: "https://polygon-mainnet.g.alchemy.com/v2/SECRETKEY", status: 503, body: {}, details: "down" }),
    );

    const res = await GET(request("?chain=polygon"));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Transfer feed unavailable" });
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("HttpRequestError");
    expect(logged).not.toContain("SECRETKEY");
  });

  it("gives up on a hung eth_getLogs instead of holding the request open", async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(console, "error").mockImplementation(() => {});
      getBlockNumber.mockResolvedValue(1_000n);
      getLogs.mockReturnValue(new Promise(() => {}));
      const pending = GET(request("?chain=polygon"));
      await jest.advanceTimersByTimeAsync(10_000);
      const res = await pending;
      expect(res.status).toBe(502);
    } finally {
      jest.useRealTimers();
    }
  });

  it("shares one chain read between concurrent requests on an instance", async () => {
    getBlockNumber.mockResolvedValue(1_000n);
    getLogs.mockResolvedValue([]);
    await Promise.all([GET(request("?chain=polygon")), GET(request("?chain=polygon"))]);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });
});

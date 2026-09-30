/**
 * @jest-environment node
 */
const mockHistory = jest.fn();
jest.mock("../../../../server/positions/history", () => ({ positionHistory: (...args: unknown[]) => mockHistory(...args) }));
jest.mock("../../../../server/positions/chains", () => ({ positionsChain: () => ({ client: {}, positionManager: "0xpm" }) }));
jest.mock("../../../../server/pools/redis", () => ({ getRedis: () => ({}) }));

import { NextRequest } from "next/server";
import { HttpRequestError } from "viem";
import { GET } from "./route";

const request = (query: Record<string, string>) => new NextRequest(`https://telx.network/api/positions/history?${new URLSearchParams(query)}`);

beforeEach(() => {
  mockHistory.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/positions/history", () => {
  it.each([
    [{ tokenId: "1" }, "Unknown chain"],
    [{ chain: "arbitrum", tokenId: "1" }, "Unknown chain"],
    [{ chain: "polygon" }, "Invalid tokenId"],
    [{ chain: "polygon", tokenId: "0x1" }, "Invalid tokenId"],
    [{ chain: "polygon", tokenId: "1".repeat(31) }, "Invalid tokenId"],
  ])("rejects %j with 400 before any upstream call", async (query, message) => {
    const res = await GET(request(query as Record<string, string>));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: message });
    expect(mockHistory).not.toHaveBeenCalled();
  });

  it("serves the history with the shared cache policy", async () => {
    mockHistory.mockResolvedValue({ tokenId: "42", days: [] });
    const res = await GET(request({ chain: "polygon", tokenId: "42" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(mockHistory).toHaveBeenCalledWith("polygon", 42n, expect.objectContaining({ positionManager: "0xpm" }));
  });

  it("answers 404 for a token outside the registry pools", async () => {
    mockHistory.mockResolvedValue(null);
    const res = await GET(request({ chain: "base", tokenId: "7" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502 on an RPC failure and 500 on anything else, without caching either", async () => {
    mockHistory.mockRejectedValueOnce(new HttpRequestError({ url: "https://rpc.example", status: 500, body: {}, details: "down" }));
    const upstream = await GET(request({ chain: "polygon", tokenId: "42" }));
    expect(upstream.status).toBe(502);
    expect(upstream.headers.get("cache-control")).toBe("no-store");

    mockHistory.mockRejectedValueOnce(new Error("bug"));
    const internal = await GET(request({ chain: "polygon", tokenId: "42" }));
    expect(internal.status).toBe(500);
  });
});

/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

const reads = { ethereum: jest.fn(), base: jest.fn(), polygon: jest.fn() };
jest.mock("../backendHelpers/alchemy", () => ({
  publicClientEthereum: { readContract: (...args: unknown[]) => reads.ethereum(...args) },
  publicClientBase: { readContract: (...args: unknown[]) => reads.base(...args) },
  publicClientPolygon: { readContract: (...args: unknown[]) => reads.polygon(...args) },
}));

import { NextRequest } from "next/server";
import { HttpRequestError } from "viem";
import { dynamic, GET } from "./route";

const USER = "0x3b0b1ab7dd8ef487c46f814f56499948961ce5c3";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const CLAIMED = 120525677976447967845046n;

/** Merkl's summary for USER on Polygon, as its index saw it before the claim. */
const merklBody = () => [
  {
    chain: { id: 137, name: "Polygon" },
    amountUSD: "400",
    claimedUSD: "0",
    pendingUSD: "0",
    rewards: [
      {
        amount: CLAIMED.toString(),
        claimed: "0",
        pending: "0",
        proofs: ["0xproof"],
        token: { chainId: 137, address: TEL, decimals: 18, symbol: "TEL", price: 0.0033 },
      },
    ],
  },
];

const request = (query: string) => new NextRequest(`https://telx.network/api/merkl-user-rewards?${query}`);

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  Object.values(reads).forEach((read) => read.mockReset());
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/merkl-user-rewards", () => {
  it.each([
    "chainId=137",
    "userAddress=0x123&chainId=137",
    `userAddress=${USER}&chainId=10`,
    `userAddress=${USER}&chainId=137&reloadChainId=10`,
  ])("returns 400 for %s without calling Merkl", async (query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when Merkl has no rewards for the user", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const res = await GET(request(`userAddress=${USER}&chainId=137`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    Object.values(reads).forEach((read) => expect(read).not.toHaveBeenCalled());
  });

  it("raises claimed and claimedUSD to what the Distributor reports on the requested chain", async () => {
    fetchMock.mockResolvedValue(Response.json(merklBody()));
    reads.polygon.mockResolvedValue([CLAIMED, 1_790_000_000, `0x${"00".repeat(32)}`]);

    const res = await GET(request(`userAddress=${USER}&chainId=137`));
    expect(res.status).toBe(200);
    const [entry] = await res.json();
    expect(entry.rewards[0].claimed).toBe(CLAIMED.toString());
    expect(entry.claimedUSD).toBe("400");
    expect(reads.polygon).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "claimed", args: [USER, TEL.toLowerCase()] })
    );
    expect(reads.ethereum).not.toHaveBeenCalled();
    expect(reads.base).not.toHaveBeenCalled();
  });

  it("returns Merkl's body unchanged when the chain read fails, without logging the RPC key", async () => {
    fetchMock.mockResolvedValue(Response.json(merklBody()));
    reads.polygon.mockRejectedValue(
      new HttpRequestError({ url: "https://polygon-mainnet.g.alchemy.com/v2/SECRETKEY", status: 500, body: {}, details: "boom" })
    );

    const res = await GET(request(`userAddress=${USER}&chainId=137`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(merklBody());
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(" ");
    expect(logged).toContain("HttpRequestError");
    expect(logged).not.toContain("SECRETKEY");
  });

  it("forwards reloadChainId to Merkl", async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    await GET(request(`userAddress=${USER}&chainId=137&reloadChainId=137`));
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe(`/v4/users/${USER}/rewards/summary`);
    expect(url.searchParams.get("chainId")).toBe("137");
    expect(url.searchParams.get("reloadChainId")).toBe("137");
  });

  it.each([undefined, "137"])("fetches Merkl with no-store and no revalidate option (reloadChainId %p)", async (reloadChainId) => {
    fetchMock.mockResolvedValue(Response.json([]));
    await GET(request(`userAddress=${USER}&chainId=137${reloadChainId ? `&reloadChainId=${reloadChainId}` : ""}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store" });
  });

  it.each([
    ["Merkl's rewards", () => fetchMock.mockResolvedValue(Response.json(merklBody())), 200],
    ["no rewards", () => fetchMock.mockResolvedValue(new Response(null, { status: 404 })), 200],
    ["a Merkl error", () => fetchMock.mockResolvedValue(new Response("down", { status: 503 })), 503],
    ["a failed request", () => fetchMock.mockRejectedValue(new TypeError("fetch failed")), 500],
  ])("answers %s with Cache-Control no-store", async (_, upstream, status) => {
    upstream();
    reads.polygon.mockResolvedValue([0n, 0, `0x${"00".repeat(32)}`]);
    const res = await GET(request(`userAddress=${USER}&chainId=137`));
    expect(res.status).toBe(status);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is always rendered dynamically", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});

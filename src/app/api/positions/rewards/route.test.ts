/**
 * @jest-environment node
 */
import { GET } from "./route";

const mockFetch = jest.fn();
jest.mock("../../../../server/positions/rewards", () => ({ fetchWalletPositionRewards: (...args: unknown[]) => mockFetch(...args) }));

const OWNER = "0x0776b74e2dC3fe4f25FdAf18c0eBB274b574dba8";
const request = (query: string) => new Request(`https://telx.network/api/positions/rewards?${query}`);

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/positions/rewards", () => {
  it("serves the wallet's per-position rewards with the shared cache policy", async () => {
    const rewards = { chain: "polygon", owner: OWNER.toLowerCase(), priceUSD: 0.002, positions: { "143904": { earned: 1, claimed: 0, pending: 0, unclaimed: 1 } } };
    mockFetch.mockResolvedValue(rewards);

    const res = await GET(request(`chain=polygon&owner=${OWNER.toLowerCase()}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    await expect(res.json()).resolves.toEqual(rewards);
    expect(mockFetch).toHaveBeenCalledWith("polygon", OWNER.toLowerCase());
  });

  it.each([
    ["an unknown chain", `chain=solana&owner=${OWNER}`],
    ["no owner", "chain=polygon"],
    ["an owner that isn't an address", "chain=polygon&owner=0x123"],
  ])("answers 400 for %s without reading Merkl", async (_, query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["Merkl can't be read", () => mockFetch.mockResolvedValue(null)],
    ["the read throws", () => mockFetch.mockRejectedValue(new Error("timeout"))],
  ])("answers 502, not cached, when %s", async (_, arrange) => {
    arrange();
    const res = await GET(request(`chain=base&owner=${OWNER}`));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

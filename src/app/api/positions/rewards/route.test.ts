/**
 * @jest-environment node
 */
import { GET } from "./route";

const mockIndex = jest.fn();
jest.mock("../../../../server/positions/poolRewards", () => ({ poolRewardsIndex: (...args: unknown[]) => mockIndex(...args) }));
jest.mock("../../../../server/positions/dispute", () => ({ readDispute: jest.fn() }));

const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const request = (query: string) => new Request(`https://telx.network/api/positions/rewards?${query}`);

beforeEach(() => {
  mockIndex.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/positions/rewards", () => {
  it("serves the pool's rewards index, cached at the CDN for three minutes", async () => {
    const index = { chain: "polygon", poolId: WETH_TEL, updatedAt: 1, campaigns: [], unresolved: 0, positions: {} };
    mockIndex.mockResolvedValue(index);

    const res = await GET(request(`chain=polygon&poolId=${WETH_TEL.toUpperCase().replace("0X", "0x")}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=180, stale-while-revalidate=600");
    await expect(res.json()).resolves.toEqual(index);
    expect(mockIndex).toHaveBeenCalledWith("polygon", WETH_TEL, expect.objectContaining({ readDispute: expect.any(Function) }));
  });

  it("answers 400 for an unknown chain without reading Merkl", async () => {
    const res = await GET(request(`chain=solana&poolId=${WETH_TEL}`));
    expect(res.status).toBe(400);
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["no pool", "chain=polygon"],
    ["a malformed pool id", "chain=polygon&poolId=0x123"],
    ["a pool outside the TELx reward pools", `chain=polygon&poolId=0x${"ab".repeat(32)}`],
  ])("answers 404 for %s without reading Merkl", async (_, query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("answers 502, not cached, when the index can't be built", async () => {
    mockIndex.mockRejectedValue(new Error("merkl down"));
    const res = await GET(request(`chain=polygon&poolId=${WETH_TEL}`));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

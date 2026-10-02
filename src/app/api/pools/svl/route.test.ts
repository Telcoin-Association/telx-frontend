/**
 * @jest-environment node
 */
import { GET } from "./route";

const mockRead = jest.fn();
jest.mock("../../../../server/pools/merkl/svlDays", () => ({ readPoolSvl: (...args: unknown[]) => mockRead(...args) }));

const POOL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const request = (query: string) => new Request(`https://telx.network/api/pools/svl?${query}`);

beforeEach(() => {
  mockRead.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/pools/svl", () => {
  it("serves a registry pool's SVL days with the shared cache policy, matching the id without regard to case", async () => {
    const days = [{ date: "2026-09-25", svlUSD: 50_000, estimated: true }];
    mockRead.mockResolvedValue(days);

    const res = await GET(request(`chain=polygon&poolId=${POOL.toUpperCase().replace("0X", "0x")}`));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    await expect(res.json()).resolves.toEqual({ days });
    expect(mockRead).toHaveBeenCalledWith("polygon", POOL);
  });

  it.each([
    ["an unknown chain", `chain=solana&poolId=${POOL}`],
    ["a pool on another chain", `chain=ethereum&poolId=${POOL}`],
    ["an id outside the registry", `chain=polygon&poolId=0x${"1".repeat(64)}`],
    ["no pool id", "chain=polygon"],
  ])("answers 404 for %s without reading Redis", async (_, query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("answers 502, not cached, when the read fails", async () => {
    mockRead.mockRejectedValue(new Error("redis down"));
    const res = await GET(request(`chain=polygon&poolId=${POOL}`));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

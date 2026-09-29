/**
 * @jest-environment node
 */
import { readAllGrouped } from "../../../server/pools/groupedRead";
import type { GroupedResponse } from "../../../server/pools/cache";
import { GET } from "./route";

jest.mock("../../../server/pools/groupedRead", () => ({ readAllGrouped: jest.fn() }));
const readAllGroupedMock = readAllGrouped as jest.MockedFunction<typeof readAllGrouped>;

const group = (fetchedAt: number): GroupedResponse => ({
  fetchedAt,
  indexedAt: null,
  hasIndexingErrors: false,
  parts: { hourly: null, daily: null, legacy: false },
  data: [],
});

describe("GET /api/pools", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns every group with a shared CDN cache header when all reads succeed", async () => {
    const body = { groups: { balancer: group(1), quickswap: group(2) }, failed: {} };
    readAllGroupedMock.mockResolvedValueOnce(body);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(await res.json()).toEqual(body);
  });

  it("marks the failed groups and is cached only briefly when a read errors", async () => {
    const body = { groups: { quickswap: group(2) }, failed: { balancer: "error" as const, "uniswap-base": "unavailable" as const } };
    readAllGroupedMock.mockResolvedValueOnce(body);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=10");
    expect(await res.json()).toEqual(body);
  });

  it("keeps the normal cache when groups are only unavailable", async () => {
    const body = { groups: { quickswap: group(2) }, failed: { "uniswap-polygon": "unavailable" as const } };
    readAllGroupedMock.mockResolvedValueOnce(body);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(await res.json()).toEqual(body);
  });

  it("returns 503, not cached, when no group could be read", async () => {
    readAllGroupedMock.mockResolvedValueOnce({ groups: {}, failed: { balancer: "error" } });

    const res = await GET();

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ groups: {}, failed: { balancer: "error" } });
  });
});

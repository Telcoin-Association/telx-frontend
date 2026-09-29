/**
 * @jest-environment node
 */
import { readAllGrouped } from "../../../server/pools/groupedRead";
import { getPoolsReadRedis, getRedis } from "../../../server/pools/redis";
import type { GroupedResponse } from "../../../server/pools/cache";
import { PREVIEW_AUTH_COOKIE, previewAuthToken } from "../../../helpers/previewAuth";
import { GET } from "./route";

jest.mock("../../../server/pools/groupedRead", () => ({ readAllGrouped: jest.fn() }));
jest.mock("../../../server/pools/redis", () => ({ getRedis: jest.fn(), getPoolsReadRedis: jest.fn() }));
const readAllGroupedMock = readAllGrouped as jest.MockedFunction<typeof readAllGrouped>;

const POOLS_URL = "https://www.telx.network/api/pools";
const poolsRequest = (headers: Record<string, string> = {}) => new Request(POOLS_URL, { headers });

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

    const res = await GET(poolsRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(await res.json()).toEqual(body);
  });

  it("marks the failed groups and is cached only briefly when a read errors", async () => {
    const body = { groups: { quickswap: group(2) }, failed: { balancer: "error" as const, "uniswap-base": "unavailable" as const } };
    readAllGroupedMock.mockResolvedValueOnce(body);

    const res = await GET(poolsRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=10");
    expect(await res.json()).toEqual(body);
  });

  it("keeps the normal cache when groups are only unavailable", async () => {
    const body = { groups: { quickswap: group(2) }, failed: { "uniswap-polygon": "unavailable" as const } };
    readAllGroupedMock.mockResolvedValueOnce(body);

    const res = await GET(poolsRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(await res.json()).toEqual(body);
  });

  it("returns 503, not cached, when no group could be read", async () => {
    readAllGroupedMock.mockResolvedValueOnce({ groups: {}, failed: { balancer: "error" } });

    const res = await GET(poolsRequest());

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ groups: {}, failed: { balancer: "error" } });
  });

  it.each(["?x=1", "?t=1758900000000&cache=bust"])("redirects %s to the bare path, cached, without reading Redis", async query => {
    const res = await GET(new Request(`${POOLS_URL}${query}`));

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/pools");
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(await res.text()).toBe("");
    expect(readAllGroupedMock).not.toHaveBeenCalled();
    expect(getRedis).not.toHaveBeenCalled();
    expect(getPoolsReadRedis).not.toHaveBeenCalled();
  });
});

describe("GET /api/pools on a password-protected preview", () => {
  const secret = "reviewer:s3cret";

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.PREVIEW_BASIC_AUTH = secret;
  });

  afterEach(() => {
    delete process.env.PREVIEW_BASIC_AUTH;
  });

  it("refuses a request without the preview login and never reads the cache", async () => {
    const res = await GET(poolsRequest());

    expect(res.status).toBe(401);
    expect(readAllGroupedMock).not.toHaveBeenCalled();
  });

  it("serves a logged-in visitor but keeps the response out of the CDN", async () => {
    readAllGroupedMock.mockResolvedValueOnce({ groups: { balancer: group(1) }, failed: {} });
    const token = await previewAuthToken(secret);

    const res = await GET(poolsRequest({ cookie: `${PREVIEW_AUTH_COOKIE}=${token}` }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

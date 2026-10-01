/**
 * @jest-environment node
 */
import { GET } from "./route";

const mockRead = jest.fn();
jest.mock("../../../server/analytics/series", () => ({ readAnalytics: () => mockRead() }));

const request = () => new Request("https://telx.network/api/analytics");

beforeEach(() => {
  mockRead.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/analytics", () => {
  it("serves the series with the shared cache policy", async () => {
    const body = { historyFrom: 1, pools: [], campaigns: [], telUSD: {} };
    mockRead.mockResolvedValue(body);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    await expect(res.json()).resolves.toEqual(body);
  });

  it("answers 502, not cached, when the cache can't be read", async () => {
    mockRead.mockRejectedValue(new Error("redis down"));
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

/**
 * @jest-environment node
 */
import { GET } from "./route";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const request = (query: Record<string, string>) => new Request(`https://telx.network/api/swap/prices?${new URLSearchParams(query)}`);

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("GET /api/swap/prices", () => {
  it("answers the prices and lets the CDN cache them for a minute", async () => {
    fetchMock.mockResolvedValue(Response.json({ coins: { [`polygon:${TEL.toLowerCase()}`]: { price: 0.00215, confidence: 0.99 } } }));
    const res = await GET(request({ chain: "polygon", tokens: TEL }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=120");
    expect(await res.json()).toEqual({ prices: { [TEL.toLowerCase()]: 0.00215 } });
  });

  it("refuses a malformed request without calling DefiLlama", async () => {
    const res = await GET(request({ chain: "polygon", tokens: "TEL" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers no prices, uncached, when DefiLlama fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    const res = await GET(request({ chain: "polygon", tokens: TEL }));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "USD prices are unavailable right now.", prices: {} });
  });
});

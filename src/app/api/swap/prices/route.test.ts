/**
 * @jest-environment node
 */
import { GET } from "./route";

jest.mock("../../../../server/pools/redis", () => ({ getRedis: () => ({}) }));
const mockPipelineRates = jest.fn();
jest.mock("../../../../server/pools/rpc/pipelineRates", () => ({ pipelineRates: (...args: unknown[]) => mockPipelineRates(...args) }));

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const request = (query: Record<string, string>) => new Request(`https://telx.network/api/swap/prices?${new URLSearchParams(query)}`);

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  mockPipelineRates.mockReset();
  mockPipelineRates.mockResolvedValue({});
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

  it("prices TEL3 at the pipeline's on-chain TEL price over DefiLlama's", async () => {
    const WETH = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
    mockPipelineRates.mockResolvedValue({ TEL: { USD: "0.0012939" } });
    fetchMock.mockResolvedValue(
      Response.json({ coins: { [`polygon:${TEL.toLowerCase()}`]: { price: 0.0013977, confidence: 0.99 }, [`polygon:${WETH}`]: { price: 2058.8, confidence: 0.99 } } }),
    );
    const res = await GET(request({ chain: "polygon", tokens: `${TEL},${WETH}` }));
    expect(await res.json()).toEqual({ prices: { [TEL.toLowerCase()]: 0.0012939, [WETH]: 2058.8 } });
  });

  it("keeps DefiLlama's TEL3 price when the pipeline has none or can't be read", async () => {
    fetchMock.mockImplementation(async () => Response.json({ coins: { [`polygon:${TEL.toLowerCase()}`]: { price: 0.0013977, confidence: 0.99 } } }));
    expect(await (await GET(request({ chain: "polygon", tokens: TEL }))).json()).toEqual({ prices: { [TEL.toLowerCase()]: 0.0013977 } });
    mockPipelineRates.mockRejectedValue(new Error("redis down"));
    expect(await (await GET(request({ chain: "polygon", tokens: TEL }))).json()).toEqual({ prices: { [TEL.toLowerCase()]: 0.0013977 } });
  });

  it("does not read the pipeline for a request without TEL3", async () => {
    const WETH = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
    fetchMock.mockResolvedValue(Response.json({ coins: { [`polygon:${WETH}`]: { price: 2058.8, confidence: 0.99 } } }));
    await GET(request({ chain: "polygon", tokens: WETH }));
    expect(mockPipelineRates).not.toHaveBeenCalled();
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

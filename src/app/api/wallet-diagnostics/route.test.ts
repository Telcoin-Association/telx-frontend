/**
 * @jest-environment node
 */
const walletReport = jest.fn();
jest.mock("../../../server/admin/walletReport", () => ({ walletReport: (...args: unknown[]) => walletReport(...args) }));
jest.mock("../../../server/admin/liveDeps", () => ({ liveWalletReportDeps: {} }));

import { clearWalletReportCache, REQUESTS_PER_MINUTE } from "../../../server/admin/diagnostics";
import { GET } from "./route";

const ADDRESS = "0x00000000000000000000000000000000000000Aa";
const request = (query: string, ip = "9.9.9.9") => new Request(`https://telx.network/api/wallet-diagnostics${query}`, { headers: { "x-real-ip": ip } });

beforeEach(() => {
  walletReport.mockReset().mockResolvedValue({ address: ADDRESS.toLowerCase(), generatedAt: 1, chains: [], flags: [] });
  clearWalletReportCache();
});

describe("GET /api/wallet-diagnostics", () => {
  it("answers the report with no login, never cached or indexed", async () => {
    const res = await GET(request(`?address=${ADDRESS}`, "1.0.0.1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect((await res.json()).address).toBe(ADDRESS.toLowerCase());
    expect(walletReport).toHaveBeenCalledWith(ADDRESS.toLowerCase(), {});
  });

  it.each(["", "?address=", "?address=0x123", "?address=not-an-address"])("refuses %p without reading the chains", async query => {
    const res = await GET(request(query, "1.0.0.2"));
    expect(res.status).toBe(400);
    expect(walletReport).not.toHaveBeenCalled();
  });

  it("reuses one wallet's report for repeated requests", async () => {
    await GET(request(`?address=${ADDRESS}`, "1.0.0.3"));
    await GET(request(`?address=${ADDRESS.toLowerCase()}`, "1.0.0.3"));
    expect(walletReport).toHaveBeenCalledTimes(1);
  });

  it("limits each client per minute", async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= REQUESTS_PER_MINUTE; i++) statuses.push((await GET(request(`?address=${ADDRESS}`, "1.0.0.4"))).status);
    expect(statuses.slice(0, REQUESTS_PER_MINUTE).every(status => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await GET(request(`?address=${ADDRESS}`, "1.0.0.5"))).status).toBe(200);
  });

  it("answers 502 without detail when the report fails", async () => {
    walletReport.mockRejectedValue(new Error("upstream https://polygon-mainnet.g.alchemy.com/v2/SECRET"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(request(`?address=${ADDRESS}`, "1.0.0.6"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("SECRET");
  });
});

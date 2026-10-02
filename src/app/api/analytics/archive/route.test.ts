/**
 * @jest-environment node
 */
import reportHistory from "../../../../data/report-history.json";
import { GET } from "./route";

const request = () => new Request("https://telx.network/api/analytics/archive");

describe("GET /api/analytics/archive", () => {
  it("serves the report history file, cached at the CDN for a day", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=86400, stale-while-revalidate=604800");
    await expect(res.json()).resolves.toEqual(reportHistory);
  });

  it("is not cached at the CDN on a password-protected preview", async () => {
    const before = process.env.PREVIEW_BASIC_AUTH;
    process.env.PREVIEW_BASIC_AUTH = "user:secret";
    try {
      const res = await GET(new Request("https://preview.example/api/analytics/archive", { headers: { authorization: `Basic ${btoa("user:secret")}` } }));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      if (before === undefined) delete process.env.PREVIEW_BASIC_AUTH;
      else process.env.PREVIEW_BASIC_AUTH = before;
    }
  });
});

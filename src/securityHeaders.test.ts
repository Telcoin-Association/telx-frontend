/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config";
import { config as middlewareConfig, middleware } from "./middleware";
import { PREVIEW_AUTH_COOKIE, previewAuthToken } from "./helpers/previewAuth";

const headersFor = async (path: string) => (await unstable_getResponseFromNextConfig({ url: `https://telx.network${path}`, nextConfig })).headers;

describe("next.config security headers", () => {
  it.each(["/", "/pools", "/pool/0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982", "/aboutMedia/image.png", "/api/rpc/polygon"])(
    "sends the CSP and fixed headers on %s, and no X-Frame-Options",
    async path => {
      const headers = await headersFor(path);
      const csp = headers.get("content-security-policy");
      expect(csp).toContain("default-src 'self';");
      expect(csp).toContain("frame-ancestors 'self' https://verify.walletconnect.org https://telx.network;");
      expect(csp).not.toMatch(/\s{2,}/);
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBe("strict-origin");
      expect(headers.get("permissions-policy")).toBe("autoplay=*");
      expect(headers.get("x-xss-protection")).toBe("0");
      expect(headers.get("access-control-allow-origin")).toBe("https://telx.network");
      expect(headers.has("x-frame-options")).toBe(false);
    },
  );

  it("leaves other API routes and build assets alone", async () => {
    expect((await headersFor("/api/uniswap-user-rewards")).has("content-security-policy")).toBe(false);
    expect((await headersFor("/_next/static/chunks/main.js")).has("content-security-policy")).toBe(false);
  });

  it("uses the narrow policy on /install.html", async () => {
    expect((await headersFor("/install.html")).get("content-security-policy")).toBe("default-src 'self'; script-src 'unsafe-inline';");
  });
});

describe("middleware matcher", () => {
  const matches = (path: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config: middlewareConfig, url: `https://telx.network${path}`, headers });

  it.each(["/", "/pools", "/portfolio", "/pool/0xabc", "/about/welcome-to-telx"])("runs on page %s", path => {
    expect(matches(path)).toBe(true);
  });

  it.each(["/api/rpc/polygon", "/api/uniswap-user-rewards", "/_next/static/chunks/main.js", "/_next/image", "/favicon.ico", "/aboutMedia/a.jpg", "/security.txt"])(
    "skips %s",
    path => {
      expect(matches(path)).toBe(false);
    },
  );

  it("skips router prefetches", () => {
    expect(matches("/pools", { "next-router-prefetch": "1" })).toBe(false);
  });
});

describe("middleware", () => {
  const SECRET = "reviewer:s3cret";
  const page = (headers: Record<string, string> = {}) => new NextRequest("https://preview.telx.network/pools", { headers });

  afterEach(() => {
    delete process.env.PREVIEW_BASIC_AUTH;
  });

  it("passes every request through untouched when preview auth is off", async () => {
    const res = await middleware(page());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.has("content-security-policy")).toBe(false);
  });

  it("challenges a request without credentials when preview auth is on", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(page());
    expect(res.status).toBe(401);
  });

  it("sets the remember-me cookie on a fresh Basic auth login", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(page({ authorization: `Basic ${Buffer.from(SECRET).toString("base64")}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PREVIEW_AUTH_COOKIE}=${await previewAuthToken(SECRET)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("accepts the remember-me cookie without setting it again", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(page({ cookie: `${PREVIEW_AUTH_COOKIE}=${await previewAuthToken(SECRET)}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.has("set-cookie")).toBe(false);
  });
});

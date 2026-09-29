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

  it("sends exactly the reviewed CSP, so any change to it shows up in the snapshot diff", async () => {
    expect((await headersFor("/")).get("content-security-policy")?.split("; ")).toMatchSnapshot();
  });

  it("leaves other API routes and build assets alone", async () => {
    expect((await headersFor("/api/uniswap-user-rewards")).has("content-security-policy")).toBe(false);
    expect((await headersFor("/_next/static/chunks/main.js")).has("content-security-policy")).toBe(false);
  });

  it("uses the narrow policy on /install.html", async () => {
    expect((await headersFor("/install.html")).get("content-security-policy")).toBe("default-src 'self'; script-src 'unsafe-inline';");
  });
});

describe("middleware matcher", () => {
  const matches = (origin: string, path: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config: middlewareConfig, url: `${origin}${path}`, headers: { host: new URL(origin).host, ...headers } });

  const PATHS = [
    "/",
    "/pools",
    "/pool/0xabc",
    "/pool/0xabc.png",
    "/pool/0xabc.PNG",
    "/pools.rsc",
    "/foo.js",
    "/about/foo.txt",
    "/coins/tel.png",
    "/api/pools",
    "/api/rpc/polygon",
    "/_next/static/chunks/main.js",
    "/favicon.ico",
  ];

  it.each(["https://telx-frontend-git-branch-telcoinassociation.vercel.app", "https://staging.telx.network", "https://telx.network.example.com", "http://localhost:3000"])(
    "runs on every path of the non-production host %s",
    origin => {
      for (const path of PATHS) expect({ path, matched: matches(origin, path) }).toEqual({ path, matched: true });
      expect(matches(origin, "/pools", { "next-router-prefetch": "1" })).toBe(true);
    },
  );

  it.each(["https://telx.network", "https://www.telx.network", "https://WWW.TELX.NETWORK", "https://telx.network:443"])(
    "never runs on the production host %s",
    origin => {
      for (const path of PATHS) expect({ path, matched: matches(origin, path) }).toEqual({ path, matched: false });
    },
  );
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

  it("answers an API request without the login with a JSON 401 and no login dialog", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(new NextRequest("https://preview.telx.network/api/pools"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
    await expect(res.json()).resolves.toEqual({ error: "Preview login required" });
  });

  it.each(["/api/cron/uniswap-base-grouped", "/api/health", "/api/admin/rpc-backfill/polygon"])("lets %s through to its own bearer check", async path => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(new NextRequest(`https://preview.telx.network${path}`, { headers: { authorization: "Bearer cron-secret" } }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets an API request with the remember-me cookie through", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(new NextRequest("https://preview.telx.network/api/pools", { headers: { cookie: `${PREVIEW_AUTH_COOKIE}=${await previewAuthToken(SECRET)}` } }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
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

  it("sets the remember-me cookie without Secure over plain http, where browsers would drop it", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const request = new NextRequest("http://192.168.1.20:3000/pools", { headers: { authorization: `Basic ${Buffer.from(SECRET).toString("base64")}` } });
    const cookie = (await middleware(request)).headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PREVIEW_AUTH_COOKIE}=`);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("challenges a request that claims to be a router prefetch but has no login", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(page({ "next-router-prefetch": "1" }));
    expect(res.status).toBe(401);
  });

  it("accepts the remember-me cookie without setting it again", async () => {
    process.env.PREVIEW_BASIC_AUTH = SECRET;
    const res = await middleware(page({ cookie: `${PREVIEW_AUTH_COOKIE}=${await previewAuthToken(SECRET)}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.has("set-cookie")).toBe(false);
  });
});

/**
 * @jest-environment node
 */
import { readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { NextRequest } from "next/server";

// Middleware does not run on API routes, so each one applies the preview login itself. These routes are
// exempt because they have their own bearer secret, which shares the Authorization header with Basic auth.
const EXEMPT = new Set(["cron/[job]", "health"]);
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^route\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}

const apiDir = __dirname;
const routes = routeFiles(apiDir).map((path) => ({ path, name: relative(apiDir, path).split(sep).slice(0, -1).join("/") }));

describe("API routes on a password-protected preview", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeAll(() => {
    process.env.PREVIEW_BASIC_AUTH = "reviewer:s3cret";
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    delete process.env.PREVIEW_BASIC_AUTH;
    global.fetch = originalFetch;
  });

  it("finds the API routes, and every exempt route exists", () => {
    const names = new Set(routes.map(({ name }) => name));
    expect(routes.length).toBeGreaterThan(EXEMPT.size);
    for (const exempt of EXEMPT) expect(names.has(exempt)).toBe(true);
  });

  it.each(routes.filter(({ name }) => !EXEMPT.has(name)).map(({ name, path }) => [name, path]))(
    "%s answers 401 to every method without the login and makes no upstream call",
    async (name, path) => {
      const handlers: Record<string, unknown> = await import(path);
      const exported = METHODS.filter((method) => typeof handlers[method] === "function");
      expect(exported.length).toBeGreaterThan(0);

      for (const method of exported) {
        const handler = handlers[method] as (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
        const request = new NextRequest(`https://preview.telx.network/api/${name}`, { method });
        const res = await handler(request, { params: Promise.resolve({ chain: "polygon", job: "x" }) });
        expect({ method, status: res.status }).toEqual({ method, status: 401 });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});

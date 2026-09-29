/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { siteOrigin } from "./alchemy";

const VARS = ["NEXT_PUBLIC_ORIGIN", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;
const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of VARS) delete process.env[name];
});

afterAll(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("siteOrigin", () => {
  it("uses NEXT_PUBLIC_ORIGIN when it is set", () => {
    process.env.NEXT_PUBLIC_ORIGIN = "https://www.telx.network";
    process.env.VERCEL_URL = "telx-frontend-abc.vercel.app";
    expect(siteOrigin()).toBe("https://www.telx.network");
  });

  it("uses the production domain on a production deployment", () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "www.telx.network";
    process.env.VERCEL_URL = "telx-frontend-abc.vercel.app";
    expect(siteOrigin()).toBe("https://www.telx.network");
  });

  it("uses the deployment's own host on a preview", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "www.telx.network";
    process.env.VERCEL_URL = "telx-frontend-git-staging.vercel.app";
    expect(siteOrigin()).toBe("https://telx-frontend-git-staging.vercel.app");
  });

  it("falls back to localhost only outside Vercel", () => {
    expect(siteOrigin()).toBe("http://localhost:3000/");
  });
});

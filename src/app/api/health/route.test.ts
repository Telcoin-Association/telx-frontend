/**
 * @jest-environment node
 */
import { buildHealth } from "../../../server/pools/health";
import { withEnv } from "../../../server/pools/testing";
import { GET } from "./route";

jest.mock("../../../server/pools/health", () => ({ buildHealth: jest.fn() }));
const buildHealthMock = buildHealth as jest.MockedFunction<typeof buildHealth>;

const SECRET = "health-secret";

const get = (authorization?: string) => GET(new Request("http://localhost/api/health", { headers: authorization ? { authorization } : undefined }));

describe("GET /api/health", () => {
  let restoreEnv = () => {};

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    restoreEnv = withEnv({ HEALTH_CHECK_SECRET: SECRET });
  });

  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  it("returns 200 with the report when every gating key is fresh", async () => {
    buildHealthMock.mockResolvedValueOnce({ ok: true, now: 1, keys: {} });

    const res = await get(`Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, now: 1, keys: {} });
  });

  it("returns 503 when a gating key is stale", async () => {
    buildHealthMock.mockResolvedValueOnce({ ok: false, now: 1, keys: {} });

    expect((await get(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("refuses a wrong or missing secret without reading the cache", async () => {
    expect((await get("Bearer nope")).status).toBe(401);
    expect((await get()).status).toBe(401);
    expect(buildHealthMock).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when HEALTH_CHECK_SECRET is unset", async () => {
    restoreEnv();
    restoreEnv = withEnv({ HEALTH_CHECK_SECRET: undefined });

    const res = await get("Bearer ");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Health check is not configured" });
    expect(buildHealthMock).not.toHaveBeenCalled();
  });

  it("returns a fixed 500 body when the cache read fails", async () => {
    buildHealthMock.mockRejectedValueOnce(new Error("kv down: https://secret-host"));

    const res = await get(`Bearer ${SECRET}`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Health check failed" });
  });
});

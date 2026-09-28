/**
 * @jest-environment node
 */
import { runCronWrite } from "../../../../server/pools/cronWrite";
import { CRON_JOBS } from "../../../../server/pools/jobs";
import { withEnv } from "../../../../server/pools/testing";
import vercelJson from "../../../../../vercel.json";
import { DELETE, GET, HEAD, PATCH, POST, PUT } from "./route";

jest.mock("../../../../server/pools/cronWrite", () => ({ runCronWrite: jest.fn() }));
const runCronWriteMock = runCronWrite as jest.MockedFunction<typeof runCronWrite>;

const SECRET = "cron-secret";

function get(job: string, authorization?: string) {
  const headers = authorization === undefined ? undefined : { authorization };
  return GET(new Request(`http://localhost/api/cron/${job}`, { headers }), { params: Promise.resolve({ job }) });
}

describe("GET /api/cron/[job]", () => {
  let restoreEnv = () => {};

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    restoreEnv = withEnv({ CRON_SECRET: SECRET, VERCEL: undefined });
    runCronWriteMock.mockResolvedValue({
      status: 200,
      body: { ok: true, updated: true, key: "k", pools: 1, indexedAt: null, hasIndexingErrors: false, warnings: [] },
    });
  });

  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  it("runs an allowlisted job with the right secret", async () => {
    const res = await get("balancer-history", `Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true });
    expect(runCronWriteMock).toHaveBeenCalledWith(CRON_JOBS["balancer-history"]);
  });

  it("refuses a missing or wrong secret without running anything", async () => {
    for (const authorization of [undefined, "Bearer wrong", SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`]) {
      const res = await get("balancer-grouped", authorization);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(runCronWriteMock).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when CRON_SECRET is unset, on Vercel or not", async () => {
    for (const vercel of [undefined, "1"]) {
      restoreEnv();
      restoreEnv = withEnv({ CRON_SECRET: undefined, VERCEL: vercel });
      const res = await get("balancer-grouped", "Bearer ");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Cron is not configured" });
    }
    expect(runCronWriteMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a job outside the allowlist, after auth", async () => {
    for (const job of ["unknown", "toString", "__proto__", "dfx-grouped"]) {
      const res = await get(job, `Bearer ${SECRET}`);
      expect(res.status).toBe(404);
    }
    expect((await get("unknown", "Bearer wrong")).status).toBe(401);
    expect(runCronWriteMock).not.toHaveBeenCalled();
  });

  it("passes a job failure through with its fixed message", async () => {
    runCronWriteMock.mockResolvedValueOnce({ status: 500, body: { error: "Cron job failed" } });

    const res = await get("quickswap-grouped", `Bearer ${SECRET}`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Cron job failed" });
  });

  it("answers 405 to every other method", async () => {
    for (const handler of [HEAD, POST, PUT, PATCH, DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET");
    }
    expect(runCronWriteMock).not.toHaveBeenCalled();
  });
});

describe("the cron allowlist and vercel.json", () => {
  it("allows exactly the nine pool data jobs", () => {
    expect(Object.keys(CRON_JOBS).sort()).toEqual([
      "balancer-grouped",
      "balancer-history",
      "quickswap-grouped",
      "uniswap-base-grouped",
      "uniswap-base-history",
      "uniswap-ethereum-grouped",
      "uniswap-ethereum-history",
      "uniswap-polygon-grouped",
      "uniswap-polygon-history",
    ]);
  });

  it("schedules every job once: split grouped jobs every 5 minutes, history and QuickSwap hourly", () => {
    const schedules = Object.fromEntries(vercelJson.crons.map(({ path, schedule }) => [path, schedule]));

    expect(vercelJson.crons).toHaveLength(Object.keys(CRON_JOBS).length);
    for (const job of Object.keys(CRON_JOBS)) {
      const hourly = job.endsWith("-history") || job === "quickswap-grouped";
      expect([job, schedules[`/api/cron/${job}`]]).toEqual([job, hourly ? "0 * * * *" : "*/5 * * * *"]);
    }
  });

  it("maps each job to a distinct data key", () => {
    const keys = Object.values(CRON_JOBS).map(job => job.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

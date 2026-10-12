/**
 * @jest-environment node
 */
import { runHourBackfillJob } from "../../../../../server/pools/rpc/hourBackfill";
import { withEnv } from "../../../../../server/pools/testing";
import { DELETE, GET, POST } from "./route";

jest.mock("../../../../../server/pools/rpc/hourBackfill", () => ({ MAX_HOUR_LIMIT: 720, runHourBackfillJob: jest.fn() }));
const runHourBackfillJobMock = runHourBackfillJob as jest.MockedFunction<typeof runHourBackfillJob>;

const SECRET = "cron-secret";

const BODY = {
  chain: "polygon" as const,
  dryRun: true,
  from: null,
  to: null,
  hoursInWindow: 0,
  hoursMissing: 0,
  rowsMissing: 0,
  hoursToFill: 0,
  hoursFilled: 0,
  rowsWritten: 0,
  rowsKept: 0,
  next: null,
  done: true,
  warnings: [],
};

function post(chain: string, query = "", authorization: string | null = `Bearer ${SECRET}`) {
  const headers = authorization === null ? undefined : { authorization };
  return POST(new Request(`http://localhost/api/admin/hour-backfill/${chain}${query}`, { method: "POST", headers }), {
    params: Promise.resolve({ chain }),
  });
}

describe("POST /api/admin/hour-backfill/[chain]", () => {
  let restoreEnv = () => {};

  beforeEach(() => {
    jest.resetAllMocks();
    restoreEnv = withEnv({ CRON_SECRET: SECRET, VERCEL: undefined });
    runHourBackfillJobMock.mockResolvedValue({ status: 200, body: BODY });
  });

  afterEach(() => restoreEnv());

  it("runs one call for the chain and answers its counts, uncached", async () => {
    const res = await post("polygon");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual(BODY);
    expect(runHourBackfillJobMock).toHaveBeenCalledWith("polygon", { dryRun: false });
  });

  it("passes dryRun, limit and before on", async () => {
    await post("base", "?dryRun=1&limit=24&before=1790200800");
    expect(runHourBackfillJobMock).toHaveBeenCalledWith("base", { dryRun: true, limit: 24, before: 1_790_200_800 });
  });

  it("refuses a limit or before that is not a whole number in range", async () => {
    for (const query of ["?limit=0", "?limit=721", "?limit=abc", "?limit=1.5", "?before=-1", "?before=soon"]) {
      expect((await post("polygon", query)).status).toBe(400);
    }
    expect(runHourBackfillJobMock).not.toHaveBeenCalled();
  });

  it("refuses a request without the cron secret, and an unknown chain", async () => {
    expect((await post("polygon", "", null)).status).toBe(401);
    expect((await post("polygon", "", "Bearer wrong")).status).toBe(401);
    expect((await post("arbitrum")).status).toBe(404);
    expect(runHourBackfillJobMock).not.toHaveBeenCalled();
  });

  it("fails closed when the cron secret is not set", async () => {
    restoreEnv();
    restoreEnv = withEnv({ CRON_SECRET: undefined });
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect((await post("polygon")).status).toBe(500);
    expect(runHourBackfillJobMock).not.toHaveBeenCalled();
  });

  it("answers the job's status, such as 409 while a run holds the lock", async () => {
    runHourBackfillJobMock.mockResolvedValueOnce({ status: 409, body: { error: "A run for this chain is in progress" } });
    expect((await post("ethereum")).status).toBe(409);
  });

  it("allows POST only", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().headers.get("Allow")).toBe("POST");
  });
});

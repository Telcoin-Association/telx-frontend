/**
 * @jest-environment node
 */
import { runBackfillJob } from "../../../../../server/pools/rpc/backfillJob";
import { withEnv } from "../../../../../server/pools/testing";
import { DELETE, GET, POST } from "./route";

jest.mock("../../../../../server/pools/rpc/backfillJob", () => ({ runBackfillJob: jest.fn() }));
const runBackfillJobMock = runBackfillJob as jest.MockedFunction<typeof runBackfillJob>;

const SECRET = "cron-secret";

function post(chain: string, query = "", authorization: string | null = `Bearer ${SECRET}`) {
  const headers = authorization === null ? undefined : { authorization };
  return POST(new Request(`http://localhost/api/admin/rpc-backfill/${chain}${query}`, { method: "POST", headers }), {
    params: Promise.resolve({ chain }),
  });
}

describe("POST /api/admin/rpc-backfill/[chain]", () => {
  let restoreEnv = () => {};

  beforeEach(() => {
    jest.resetAllMocks();
    restoreEnv = withEnv({ CRON_SECRET: SECRET, VERCEL: undefined });
    runBackfillJobMock.mockResolvedValue({ status: 200, body: { done: false, nextBlock: 11, finalizedBlock: 20, chunks: 1, warnings: [] } });
  });

  afterEach(() => restoreEnv());

  it("runs one backfill call for the chain and answers its progress, uncached", async () => {
    const res = await post("polygon");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ done: false, nextBlock: 11, finalizedBlock: 20, chunks: 1, warnings: [] });
    expect(runBackfillJobMock).toHaveBeenCalledWith("polygon", { reset: false });
  });

  it("passes reset=1 on", async () => {
    await post("base", "?reset=1");
    expect(runBackfillJobMock).toHaveBeenCalledWith("base", { reset: true });
  });

  it("refuses a request without the cron secret, and an unknown chain", async () => {
    expect((await post("polygon", "", null)).status).toBe(401);
    expect((await post("polygon", "", "Bearer wrong")).status).toBe(401);
    expect((await post("arbitrum")).status).toBe(404);
    expect(runBackfillJobMock).not.toHaveBeenCalled();
  });

  it("answers the job's status, such as 409 while a run holds the lock", async () => {
    runBackfillJobMock.mockResolvedValueOnce({ status: 409, body: { error: "A run for this chain is in progress" } });
    const res = await post("ethereum");
    expect(res.status).toBe(409);
  });

  it("allows POST only", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().headers.get("Allow")).toBe("POST");
  });
});

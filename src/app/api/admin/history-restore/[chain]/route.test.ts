/**
 * @jest-environment node
 */
import { restoreHistory } from "../../../../../server/pools/history/restore";
import { withEnv } from "../../../../../server/pools/testing";
import { DELETE, GET, POST } from "./route";

jest.mock("../../../../../server/pools/history/restore", () => ({ restoreHistory: jest.fn() }));
const restoreHistoryMock = restoreHistory as jest.MockedFunction<typeof restoreHistory>;

const SECRET = "cron-secret";
const COUNTS = { written: 0, kept: 0 };

function post(chain: string, query = "", authorization: string | null = `Bearer ${SECRET}`) {
  const headers = authorization === null ? undefined : { authorization };
  return POST(new Request(`http://localhost/api/admin/history-restore/${chain}${query}`, { method: "POST", headers }), {
    params: Promise.resolve({ chain }),
  });
}

describe("POST /api/admin/history-restore/[chain]", () => {
  let restoreEnv = () => {};

  beforeEach(() => {
    jest.resetAllMocks();
    restoreEnv = withEnv({ CRON_SECRET: SECRET, VERCEL: undefined });
    restoreHistoryMock.mockResolvedValue({
      status: 200,
      body: { ok: true, chain: "base", day: "2026-09-30", files: 2, merklDays: COUNTS, poolDays: COUNTS, positionChanges: COUNTS },
    });
  });

  afterEach(() => restoreEnv());

  it("restores the newest export without a day, and the given day's with one", async () => {
    const res = await post("base");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(restoreHistoryMock).toHaveBeenLastCalledWith("base", null);

    await post("base", "?day=2026-09-30");
    expect(restoreHistoryMock).toHaveBeenLastCalledWith("base", Date.UTC(2026, 8, 30) / 1000);
  });

  it("refuses a malformed day, an unknown chain and a wrong secret without restoring", async () => {
    for (const query of ["?day=2026-9-30", "?day=2026-02-30", "?day=yesterday"]) expect((await post("base", query)).status).toBe(400);
    expect((await post("arbitrum")).status).toBe(404);
    expect((await post("base", "", "Bearer wrong")).status).toBe(401);
    expect((await post("base", "", null)).status).toBe(401);
    expect(restoreHistoryMock).not.toHaveBeenCalled();
  });

  it("passes the restore's answer through", async () => {
    restoreHistoryMock.mockResolvedValueOnce({ status: 404, body: { error: "No export for that day" } });
    const res = await post("polygon", "?day=2026-01-01");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "No export for that day" });
  });

  it("answers 405 to the other methods", () => {
    for (const handler of [GET, DELETE]) expect(handler().status).toBe(405);
  });
});

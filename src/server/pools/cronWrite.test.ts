/**
 * @jest-environment node
 */
import { z } from "zod";

import { runCronWrite } from "./cronWrite";
import type { SubgraphFetch } from "./graph";
import { fakeRedis } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

const KEY = "active-uniswap-base-grouped:hourly:v2";
const STATUS_KEY = `status:${KEY}`;
const schema = z.array(z.object({ id: z.string(), value: z.number() })).nonempty();

const fetched = (groups: unknown[], extra: Partial<SubgraphFetch<unknown>> = {}): SubgraphFetch<unknown> => ({
  groups,
  indexedAt: null,
  hasIndexingErrors: false,
  warnings: [],
  ...extra,
});

function run(fetch: () => Promise<SubgraphFetch<unknown>>) {
  return runCronWrite({ key: KEY, fetch, schema, label: "Uniswap base hourly" });
}

/** Keys passed to hset, in call order. */
const hsetKeys = () => kvMock.hset.mock.calls.map(([key]) => key);

describe("runCronWrite", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes only the status hash when the fetch throws, and answers with a fixed message", async () => {
    const res = await run(async () => {
      throw new Error("Uniswap base hourly: subgraph did not return pools 0xa");
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Cron job failed" });
    expect(hsetKeys()).toEqual([STATUS_KEY]);
    expect(kvMock.hset).toHaveBeenCalledWith(STATUS_KEY, {
      lastError: "Uniswap base hourly: subgraph did not return pools 0xa",
      lastErrorAt: expect.any(Number),
    });
    expect(kvMock.hdel).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("did not return pools 0xa"));
  });

  it("returns 400 without validation details and records them on the status hash", async () => {
    const res = await run(async () => fetched([{ id: "0xa", value: "not a number" }], { indexedAt: 1 }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid data from subgraph" });
    expect(hsetKeys()).toEqual([STATUS_KEY]);
    expect(kvMock.hset.mock.calls[0][1].lastError).toContain("Uniswap base hourly: invalid data from subgraph");
    expect(kvMock.hdel).not.toHaveBeenCalled();
  });

  it("rejects an empty payload", async () => {
    const res = await run(async () => fetched([]));

    expect(res.status).toBe(400);
    expect(hsetKeys()).toEqual([STATUS_KEY]);
  });

  it("writes the data hash and clears the error fields on success", async () => {
    const res = await run(async () => fetched([{ id: "0xa", value: 1, extra: "dropped" }], { indexedAt: 1_700_000_000_000, hasIndexingErrors: true }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      updated: true,
      key: KEY,
      pools: 1,
      indexedAt: 1_700_000_000_000,
      hasIndexingErrors: true,
      warnings: [],
    });
    expect(hsetKeys()).toEqual([KEY, STATUS_KEY]);
    expect(kvMock.hset).toHaveBeenNthCalledWith(1, KEY, {
      fetchedAt: expect.any(Number),
      indexedAt: 1_700_000_000_000,
      hasIndexingErrors: true,
      data: '[{"id":"0xa","value":1}]',
    });
    expect(kvMock.hset).toHaveBeenNthCalledWith(2, STATUS_KEY, { lastSuccessAt: expect.any(Number) });
    expect(kvMock.hdel).toHaveBeenCalledWith(STATUS_KEY, "lastError", "lastErrorAt", "warnings");
  });

  it("writes the data and keeps the fetch's warnings on the status hash and in the response", async () => {
    const warning = "Uniswap base hourly: subgraph did not return archived pools 0xb";
    const res = await run(async () => fetched([{ id: "0xa", value: 1 }], { warnings: [warning] }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, warnings: [warning] });
    expect(hsetKeys()).toEqual([KEY, STATUS_KEY]);
    expect(kvMock.hset).toHaveBeenNthCalledWith(2, STATUS_KEY, { lastSuccessAt: expect.any(Number), warnings: JSON.stringify([warning]) });
    expect(console.warn).toHaveBeenCalledWith(warning);
  });

  it("still answers 200 when only the status hash update fails after a good write", async () => {
    kvMock.hdel.mockRejectedValueOnce(new Error("hdel down"));

    const res = await run(async () => fetched([{ id: "0xa", value: 1 }]));

    expect(res.status).toBe(200);
    expect(hsetKeys()[0]).toBe(KEY);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("status hash"));
  });

  it("returns 500 and records the failure when the cache write fails", async () => {
    kvMock.hset.mockRejectedValueOnce(new Error("kv down"));
    const res = await run(async () => fetched([{ id: "0xa", value: 1 }]));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Cron job failed" });
    expect(hsetKeys()).toEqual([KEY, STATUS_KEY]);
    expect(kvMock.hset.mock.calls[1][1]).toMatchObject({ lastError: expect.stringContaining("kv down") });
  });
});

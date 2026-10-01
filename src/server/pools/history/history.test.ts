/**
 * @jest-environment node
 */
import { memoryBlobs, memoryRedis, withEnv } from "../testing";
import { MAX_DAYS_PER_RUN, NOT_CONFIGURED, runHistoryExport } from "./export";
import { restoreHistory } from "./restore";
import { EXPORT_STATUS_KEY, type HistoryFile } from "./store";

const DAY = 86_400;
const D1 = Date.UTC(2026, 8, 28) / 1000; // 2026-09-28
const D2 = D1 + DAY;
const D3 = D2 + DAY;
const POOL = "0xpool";

let redis = memoryRedis();
let blobs = memoryBlobs();

/** A clock at noon UTC on `day`. */
const at = (day: number) => () => (day + DAY / 2) * 1000;
const deps = (day: number) => ({ redis: redis as never, blobs, now: at(day) });
const file = (chain: string, label: string) => JSON.parse(blobs.files.get(`history/${chain}/${label}.json`)!) as HistoryFile;
const change = (t: number) => JSON.stringify({ t, tickLower: -60, tickUpper: 60, d: "1000" });

async function seed() {
  await redis.hset(`merkl-rewards:base:day:${POOL}`, { [D1]: JSON.stringify({ status: "LIVE", apr: 12.5, at: 1 }) });
  await redis.hset(`rpc:base:day:${POOL}`, { [D1]: JSON.stringify({ swaps: 2, volumeUSD: 10, feesUSD: 0.1, lpFeesUSD: 0.1, tvlUSD: 500 }) });
  await redis.hset(`rpc:base:pos:${POOL}`, { "7:100:0": change(D1 - 5 * DAY), "7:200:0": change(D1 + 60), "8:300:1": change(D2 + 60) });
  await redis.hset(`rpc:polygon:day:${POOL}`, { [D1]: JSON.stringify({ swaps: 1, volumeUSD: 1, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 9 }) });
  // Keys the export must leave out.
  await redis.hset("rpc:base:b5m:0xpool", { 1: "{}" });
  await redis.hset("merkl-rewards:base:v1", { data: "{}" });
}

beforeEach(async () => {
  redis = memoryRedis();
  blobs = memoryBlobs();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  await seed();
});

afterEach(() => jest.restoreAllMocks());

describe("runHistoryExport", () => {
  it("skips with 200 and warns once while no Blob store is connected", async () => {
    const restoreEnv = withEnv({ BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: undefined });
    try {
      const first = await runHistoryExport({ redis: redis as never });
      const second = await runHistoryExport({ redis: redis as never });
      expect(first).toEqual({ status: 200, body: { ok: true, updated: false, skipped: NOT_CONFIGURED } });
      expect(second).toEqual(first);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(redis.hashes.has(EXPORT_STATUS_KEY)).toBe(false);
    } finally {
      restoreEnv();
    }
  });

  it("writes yesterday's file per chain with every day hash and the position changes so far", async () => {
    const result = await runHistoryExport(deps(D2));

    expect(result).toEqual({
      status: 200,
      body: { ok: true, updated: true, days: ["2026-09-28"], files: ["history/base/2026-09-28.json", "history/ethereum/2026-09-28.json", "history/polygon/2026-09-28.json"] },
    });
    const base = file("base", "2026-09-28");
    expect(base).toMatchObject({ version: 1, chain: "base", day: "2026-09-28", exportedAt: at(D2)() });
    expect(base.merklDays).toEqual({ [POOL]: { [D1]: { status: "LIVE", apr: 12.5, at: 1 } } });
    expect(base.poolDays).toEqual({ [POOL]: { [D1]: { swaps: 2, volumeUSD: 10, feesUSD: 0.1, lpFeesUSD: 0.1, tvlUSD: 500 } } });
    // The first file holds every change before the end of its day; today's change waits for its own file.
    expect(base.positionChanges.from).toBeNull();
    expect(base.positionChanges.to).toBe(D2);
    expect(Object.keys(base.positionChanges.pools[POOL]).sort()).toEqual(["7:100:0", "7:200:0"]);
    expect(file("polygon", "2026-09-28").poolDays[POOL]).toBeDefined();
    expect(file("ethereum", "2026-09-28")).toMatchObject({ merklDays: {}, poolDays: {}, positionChanges: { pools: {} } });
    expect(Object.fromEntries(redis.hashes.get(EXPORT_STATUS_KEY)!)).toEqual({ firstDay: String(D1), lastDay: String(D1), lastExportAt: String(at(D2)()) });
  });

  it("is idempotent: a second run the same day rewrites the same file", async () => {
    await runHistoryExport(deps(D2));
    const before = new Map(blobs.files);
    await runHistoryExport(deps(D2));
    expect(blobs.files).toEqual(before);
  });

  it("gives the next day only its own position changes", async () => {
    await runHistoryExport(deps(D2));
    await runHistoryExport(deps(D3));

    const second = file("base", "2026-09-29");
    expect(second.positionChanges).toEqual({ from: D2, to: D3, pools: { [POOL]: { "8:300:1": JSON.parse(change(D2 + 60)) } } });
    // Rewriting the first day keeps it the first file, with the changes before it.
    await runHistoryExport({ ...deps(D3), now: at(D2) });
    expect(file("base", "2026-09-28").positionChanges.from).toBeNull();
  });

  it("catches up on missed days, oldest first, at most MAX_DAYS_PER_RUN per run", async () => {
    await runHistoryExport(deps(D2));
    const later = D1 + (MAX_DAYS_PER_RUN + 5) * DAY;

    const first = await runHistoryExport(deps(later));
    expect(first.body).toMatchObject({ days: expect.arrayContaining(["2026-09-29"]) });
    expect((first.body as { days: string[] }).days).toHaveLength(MAX_DAYS_PER_RUN);
    const second = await runHistoryExport(deps(later));
    expect((second.body as { days: string[] }).days).toHaveLength(4);
    expect(await blobs.list("history/base/")).toHaveLength(MAX_DAYS_PER_RUN + 5);
  });

  it("fails with 500 and a fixed message, without moving the status, when a write fails", async () => {
    blobs.write = async () => {
      throw new Error("Blob write failed for https://store.private.blob.vercel-storage.com");
    };
    const result = await runHistoryExport(deps(D2));
    expect(result).toEqual({ status: 500, body: { error: "History export failed" } });
    expect(redis.hashes.has(EXPORT_STATUS_KEY)).toBe(false);
  });
});

describe("restoreHistory", () => {
  beforeEach(async () => {
    await runHistoryExport(deps(D2));
    await runHistoryExport(deps(D3));
  });

  it("writes back a lost chain's day rows and every position change", async () => {
    const saved = new Map([...redis.hashes].map(([key, hash]) => [key, new Map(hash)]));
    for (const key of [...redis.hashes.keys()]) if (key.startsWith("rpc:base:") || key.startsWith("merkl-rewards:base:day:")) redis.hashes.delete(key);

    const result = await restoreHistory("base", null, { redis: redis as never, blobs });

    expect(result).toMatchObject({ status: 200, body: { ok: true, chain: "base", day: "2026-09-29", files: 2 } });
    for (const key of [`merkl-rewards:base:day:${POOL}`, `rpc:base:day:${POOL}`, `rpc:base:pos:${POOL}`]) {
      expect([key, Object.fromEntries(redis.hashes.get(key)!)]).toEqual([key, Object.fromEntries(saved.get(key)!)]);
    }
  });

  it("never overwrites a row Redis holds, so a newer row survives and a repeat writes nothing", async () => {
    const newer = JSON.stringify({ swaps: 9, volumeUSD: 99, feesUSD: 1, lpFeesUSD: 1, tvlUSD: 700 });
    await redis.hset(`rpc:base:day:${POOL}`, { [D1]: newer });
    redis.hashes.get(`merkl-rewards:base:day:${POOL}`)!.clear();

    const result = await restoreHistory("base", null, { redis: redis as never, blobs });

    expect(redis.hashes.get(`rpc:base:day:${POOL}`)!.get(String(D1))).toBe(newer);
    expect(result.body).toMatchObject({ merklDays: { written: 1, kept: 0 }, poolDays: { written: 0, kept: 1 } });
    const repeat = await restoreHistory("base", null, { redis: redis as never, blobs });
    expect(repeat.body).toMatchObject({ merklDays: { written: 0 }, poolDays: { written: 0 }, positionChanges: { written: 0 } });
  });

  it("restores up to a given day, and answers 404 for a day without an export", async () => {
    redis.hashes.delete(`rpc:base:pos:${POOL}`);
    const result = await restoreHistory("base", D1, { redis: redis as never, blobs });
    expect(result.body).toMatchObject({ day: "2026-09-28", files: 1 });
    expect([...redis.hashes.get(`rpc:base:pos:${POOL}`)!.keys()].sort()).toEqual(["7:100:0", "7:200:0"]);

    expect(await restoreHistory("base", D3 + DAY, { redis: redis as never, blobs })).toEqual({ status: 404, body: { error: "No export for that day" } });
  });
});

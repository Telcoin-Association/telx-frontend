import "server-only";

import { describeError } from "@/app/api/backendHelpers/errors";

import { getRedis } from "../redis";
import type { Chain } from "../registry";
import {
  HISTORY_FILE_VERSION,
  historyPath,
  historyPrefixes,
  isHistoryExportConfigured,
  vercelBlobs,
  type HashDump,
  type HistoryBlobs,
  type HistoryFile,
  type HistoryRedis,
} from "./store";

export type HistoryRestoreDeps = { redis: HistoryRedis; blobs: HistoryBlobs };

type Counts = { written: number; kept: number };

export type HistoryRestoreResult =
  | { status: 200; body: { ok: true; chain: Chain; day: string; files: number; merklDays: Counts; poolDays: Counts; positionChanges: Counts } }
  | { status: 404 | 500 | 503; body: { error: string } };

const encode = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * Writes each field of `dump` that its key does not hold yet. A field Redis already has is kept: Redis only
 * ever holds the export's rows or newer ones, since the export copies Redis and the crons keep rewriting
 * today's row.
 */
async function restoreMissing(redis: HistoryRedis, prefix: string, dump: HashDump, counts: Counts): Promise<void> {
  for (const [poolId, fields] of Object.entries(dump)) {
    const key = `${prefix}${poolId}`;
    const existing = (await redis.hgetall<Record<string, unknown>>(key)) ?? {};
    const missing: Record<string, string> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (field in existing) counts.kept += 1;
      else missing[field] = encode(value);
    }
    if (Object.keys(missing).length) {
      await redis.hset(key, missing);
      counts.written += Object.keys(missing).length;
    }
  }
}

async function readFile(blobs: HistoryBlobs, path: string): Promise<HistoryFile> {
  const text = await blobs.read(path);
  if (text === null) throw new Error(`${path} is missing`);
  const file = JSON.parse(text) as HistoryFile;
  if (file.version !== HISTORY_FILE_VERSION) throw new Error(`${path} has version ${String(file.version)}`);
  return file;
}

/**
 * Writes a chain's history back into Redis from its Blob export, without overwriting any field Redis holds:
 * the Merkl and pool day rows from the file of `day` (the newest file when omitted), and the position changes
 * of every file up to and including it, since each file holds only its own day's changes.
 */
export async function restoreHistory(chain: Chain, day: number | null, deps?: Partial<HistoryRestoreDeps>): Promise<HistoryRestoreResult> {
  if (!deps?.blobs && !isHistoryExportConfigured()) return { status: 503, body: { error: "History export is not configured" } };
  const redis = deps?.redis ?? (getRedis() as unknown as HistoryRedis);
  const blobs = deps?.blobs ?? vercelBlobs;

  try {
    const paths = await blobs.list(`history/${chain}/`);
    const target = day === null ? paths.at(-1) : historyPath(chain, day);
    if (!target || !paths.includes(target)) return { status: 404, body: { error: "No export for that day" } };

    const prefixes = historyPrefixes(chain);
    const latest = await readFile(blobs, target);
    const merklDays: Counts = { written: 0, kept: 0 };
    const poolDays: Counts = { written: 0, kept: 0 };
    const positionChanges: Counts = { written: 0, kept: 0 };
    await restoreMissing(redis, prefixes.merklDays, latest.merklDays, merklDays);
    await restoreMissing(redis, prefixes.poolDays, latest.poolDays, poolDays);

    const upTo = paths.filter(path => path <= target);
    for (const path of upTo) {
      const file = path === target ? latest : await readFile(blobs, path);
      await restoreMissing(redis, prefixes.positions, file.positionChanges.pools, positionChanges);
    }
    return { status: 200, body: { ok: true, chain, day: latest.day, files: upTo.length, merklDays, poolDays, positionChanges } };
  } catch (err) {
    console.error(`History restore of ${chain} failed: ${describeError(err)}`);
    return { status: 500, body: { error: "History restore failed" } };
  }
}

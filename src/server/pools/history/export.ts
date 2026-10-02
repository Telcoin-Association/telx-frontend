import "server-only";

import { describeError } from "@/app/api/backendHelpers/errors";

import { getRedis } from "../redis";
import type { Chain } from "../registry";
import { DAY, dayStart } from "../rpc/buckets";
import {
  EXPORT_STATUS_KEY,
  HISTORY_CHAINS,
  HISTORY_FILE_VERSION,
  dayLabel,
  historyPath,
  historyPrefixes,
  isHistoryExportConfigured,
  nextDay,
  parseStatus,
  scanKeys,
  vercelBlobs,
  type HashDump,
  type HistoryBlobs,
  type HistoryFile,
  type HistoryRedis,
} from "./store";

/** A run that is behind writes at most this many days; the next runs write the rest. */
export const MAX_DAYS_PER_RUN = 14;

export type HistoryExportDeps = { redis: HistoryRedis; blobs: HistoryBlobs; now: () => number };

export type HistoryExportResult =
  | { status: 200; body: { ok: true; updated: false; skipped: string } }
  | { status: 200; body: { ok: true; updated: true; days: string[]; files: string[] } }
  | { status: 500; body: { error: string } };

export const NOT_CONFIGURED = "history export not configured";

let warnedNotConfigured = false;

/** Every hash under `prefix`, by the pool id that follows the prefix. */
async function dumpHashes(redis: HistoryRedis, prefix: string): Promise<HashDump> {
  const keys = await scanKeys(redis, prefix);
  const values = await Promise.all(keys.map(key => redis.hgetall(key)));
  return Object.fromEntries(keys.map((key, i) => [key.slice(prefix.length), values[i] ?? {}]));
}

/** The position changes whose time `t` is in `[from, to)`; a null `from` has no lower bound. */
function changesBetween(positions: HashDump, from: number | null, to: number): HashDump {
  const pools: HashDump = {};
  for (const [poolId, fields] of Object.entries(positions)) {
    const picked: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      const t = (value as { t?: unknown } | null)?.t;
      if (typeof t === "number" && (from === null || t >= from) && t < to) picked[field] = value;
    }
    if (Object.keys(picked).length) pools[poolId] = picked;
  }
  return pools;
}

/**
 * The `history-export` cron job, daily. Writes the files of every complete UTC day not exported yet, oldest
 * first and at most MAX_DAYS_PER_RUN per run, then records the last one in EXPORT_STATUS_KEY. A run with
 * nothing new rewrites yesterday's files, which holds the same changes. Each day's files are written for every
 * chain before the status moves past it, so a failed run leaves the next one to write that day again.
 *
 * Without a Blob store it answers 200 skipped, with one warning per instance, so an unconfigured deployment
 * never fails the cron.
 */
export async function runHistoryExport(deps?: Partial<HistoryExportDeps>): Promise<HistoryExportResult> {
  if (!deps?.blobs && !isHistoryExportConfigured()) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      console.warn("History export: no Blob store is connected (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN); skipping");
    }
    return { status: 200, body: { ok: true, updated: false, skipped: NOT_CONFIGURED } };
  }
  const redis = deps?.redis ?? (getRedis() as unknown as HistoryRedis);
  const blobs = deps?.blobs ?? vercelBlobs;
  const now = deps?.now ?? Date.now;

  try {
    const status = parseStatus(await redis.hgetall<Record<string, unknown>>(EXPORT_STATUS_KEY));
    const yesterday = dayStart(Math.floor(now() / 1000)) - DAY;
    const first = status.lastDay === null ? yesterday : Math.min(nextDay(status.lastDay), yesterday);
    const days: number[] = [];
    for (let day = first; day <= yesterday && days.length < MAX_DAYS_PER_RUN; day += DAY) days.push(day);
    const firstDay = status.firstDay ?? days[0];

    const dumps = await Promise.all(
      HISTORY_CHAINS.map(async (chain): Promise<[Chain, { merklDays: HashDump; poolDays: HashDump; positions: HashDump }]> => {
        const prefixes = historyPrefixes(chain);
        const [merklDays, poolDays, positions] = await Promise.all([
          dumpHashes(redis, prefixes.merklDays),
          dumpHashes(redis, prefixes.poolDays),
          dumpHashes(redis, prefixes.positions),
        ]);
        return [chain, { merklDays, poolDays, positions }];
      }),
    );

    const files: string[] = [];
    for (const day of days) {
      const from = day === firstDay ? null : day;
      const to = nextDay(day);
      await Promise.all(
        dumps.map(async ([chain, dump]) => {
          const file: HistoryFile = {
            version: HISTORY_FILE_VERSION,
            chain,
            day: dayLabel(day),
            exportedAt: now(),
            merklDays: dump.merklDays,
            poolDays: dump.poolDays,
            positionChanges: { from, to, pools: changesBetween(dump.positions, from, to) },
          };
          const path = historyPath(chain, day);
          await blobs.write(path, JSON.stringify(file));
          files.push(path);
        }),
      );
      await redis.hset(EXPORT_STATUS_KEY, { firstDay, lastDay: Math.max(day, status.lastDay ?? day), lastExportAt: now() });
    }
    return { status: 200, body: { ok: true, updated: true, days: days.map(dayLabel), files: files.sort() } };
  } catch (err) {
    console.error(`History export failed: ${describeError(err)}`);
    return { status: 500, body: { error: "History export failed" } };
  }
}

import "server-only";

import { get, list, put } from "@vercel/blob";

import type { Chain } from "../registry";
import { DAY } from "../rpc/buckets";

/**
 * Daily history export to a private Vercel Blob store. Redis holds history that is costly or impossible to
 * rebuild: the Merkl daily snapshots exist nowhere else, and the pool day rows and position changes take a
 * full RPC backfill. One file per chain per UTC day, `history/<chain>/<YYYY-MM-DD>.json`, holds:
 *
 * - `merklDays`: every `merkl-rewards:<chain>:day:<poolId>` hash in full, by pool id;
 * - `poolDays`: every `rpc:<chain>:day:<poolId>` hash in full, by pool id;
 * - `positionChanges`: the `rpc:<chain>:pos:<poolId>` fields whose change time `t` falls in
 *   `[from, to)`. `from` is the file's day, or null on the first file ever written, which holds every change
 *   before its day too, so the files together hold every position change without gaps or overlaps.
 *
 * Field values are the stored rows, parsed from their JSON. A file is rewritten whole when its day is
 * exported again, so the export is idempotent.
 */

export const HISTORY_CHAINS: readonly Chain[] = ["polygon", "base", "ethereum"];

export const HISTORY_FILE_VERSION = 1;

export type HashDump = Record<string, Record<string, unknown>>;

export type HistoryFile = {
  version: typeof HISTORY_FILE_VERSION;
  chain: Chain;
  /** The file's UTC day, `YYYY-MM-DD`. */
  day: string;
  /** When the file was written, unix ms. */
  exportedAt: number;
  merklDays: HashDump;
  poolDays: HashDump;
  /** Unix seconds; `from` is null on the first file. */
  positionChanges: { from: number | null; to: number; pools: HashDump };
};

/** The key prefixes the export reads, each followed by a pool id. */
export const historyPrefixes = (chain: Chain) => ({
  merklDays: `merkl-rewards:${chain}:day:`,
  poolDays: `rpc:${chain}:day:`,
  positions: `rpc:${chain}:pos:`,
});

/**
 * The export's progress: `firstDay` and `lastDay` (UTC day starts, unix seconds) of the files written so far,
 * and `lastExportAt` (unix ms) of the last run that wrote one.
 */
export const EXPORT_STATUS_KEY = "history-export:status";

export type ExportStatus = { firstDay: number | null; lastDay: number | null; lastExportAt: number | null };

/** The health check flags an export older than this once the store is configured. */
export const EXPORT_STALE_AFTER_SECONDS = 36 * 3600;

export const dayLabel = (day: number) => new Date(day * 1000).toISOString().slice(0, 10);

/** The UTC day start of a `YYYY-MM-DD` label, or null when it is not one. */
export function dayOfLabel(label: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return null;
  const ms = Date.parse(`${label}T00:00:00Z`);
  return Number.isFinite(ms) && dayLabel(ms / 1000) === label ? ms / 1000 : null;
}

export const historyPath = (chain: Chain, day: number) => `history/${chain}/${dayLabel(day)}.json`;

export const nextDay = (day: number) => day + DAY;

/** The Redis commands the export and the restore use. The Upstash client satisfies it. */
export type HistoryRedis = {
  scan(cursor: string, options: { match: string; count: number }): Promise<[string | number, string[]]>;
  hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
  hset(key: string, values: Record<string, unknown>): Promise<unknown>;
};

/** Every key matching `<prefix>*`. */
export async function scanKeys(redis: HistoryRedis, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${prefix}*`, count: 500 });
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== "0");
  return [...new Set(keys)].sort();
}

export function parseStatus(raw: Record<string, unknown> | null): ExportStatus {
  const numberOf = (value: unknown) => {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  return { firstDay: numberOf(raw?.firstDay), lastDay: numberOf(raw?.lastDay), lastExportAt: numberOf(raw?.lastExportAt) };
}

/**
 * A store connected to the project through OIDC sets `BLOB_STORE_ID`; one connected with a static token sets
 * `BLOB_READ_WRITE_TOKEN`. The SDK reads either.
 */
export const isHistoryExportConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

/** The Blob operations the export and the restore use; tests pass an in-memory store. */
export type HistoryBlobs = {
  write(path: string, body: string): Promise<void>;
  /** The file's text, or null when there is none. */
  read(path: string): Promise<string | null>;
  /** The paths under `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
};

/** The private Vercel Blob store connected to the project. */
export const vercelBlobs: HistoryBlobs = {
  async write(path, body) {
    await put(path, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  },
  async read(path) {
    // Uncached, so that a file rewritten in the last minute is read as written.
    const result = await get(path, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return new Response(result.stream).text();
  },
  async list(prefix) {
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      paths.push(...page.blobs.map(blob => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return paths.sort();
  },
};


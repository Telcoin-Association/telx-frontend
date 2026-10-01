import "server-only";

import { z } from "zod";

import { recordFailure, recordSuccess, writeSnapshot } from "./cache";

/** Freshness of a fetched payload: `indexedAt` is the time of the block it was read at (unix ms). */
export type Freshness = { indexedAt: number | null; hasIndexingErrors: boolean };

/** What a cron job's fetch returns: the rows to write, with their freshness and any warnings to keep. */
export type SourceFetch<G> = Freshness & { groups: G[]; warnings: string[] };

// Keeps a status hash (and /api/health) readable when every row of a payload fails validation.
const MAX_ERROR_LENGTH = 1000;

export type CronWriteOptions = {
  key: string; // data key to write
  fetch: () => Promise<SourceFetch<unknown>>;
  schema: z.ZodType<unknown[]>;
  label: string; // names the job in logs and error messages
  /**
   * Runs after the data key is written, with the validated rows and the write time (unix ms), to keep a record
   * derived from them. A failure is logged as a warning and never fails the job, since the data is in place.
   */
  afterWrite?: (data: unknown[], fetchedAt: number) => Promise<void>;
};

export type CronWriteSuccess = {
  ok: true;
  updated: true;
  key: string;
  pools: number;
  indexedAt: number | null;
  hasIndexingErrors: boolean;
  warnings: string[];
};

/** Errors carry a fixed message; the details go to the logs and the status hash only. */
export type CronWriteResult = { status: 200; body: CronWriteSuccess } | { status: 400 | 500; body: { error: string } };

const INVALID_DATA = "Invalid data from source";
const JOB_FAILED = "Cron job failed";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fail({ key, label }: CronWriteOptions, status: 400 | 500, message: string): Promise<CronWriteResult> {
  console.error(`${label}: ${message}`);
  try {
    await recordFailure(key, message.slice(0, MAX_ERROR_LENGTH));
  } catch (err) {
    console.error(`${label}: could not record the failure`, err);
  }
  return { status, body: { error: status === 400 ? INVALID_DATA : JOB_FAILED } };
}

/**
 * Shared cron write: fetch, validate, then write the data key and its status hash. On any failure
 * the data key is left as it was, the status hash gets `lastError`/`lastErrorAt`, and the result is
 * 400 (validation) or 500. Warnings from the fetch are logged and kept on the status hash.
 */
export async function runCronWrite(options: CronWriteOptions): Promise<CronWriteResult> {
  const { key, fetch, schema, label } = options;

  let result: SourceFetch<unknown>;
  try {
    result = await fetch();
  } catch (err) {
    return fail(options, 500, messageOf(err));
  }

  const validation = schema.safeParse(result.groups);
  if (!validation.success) {
    return fail(options, 400, `${label}: invalid data. ${z.prettifyError(validation.error)}`);
  }

  const warnings = result.warnings ?? [];
  for (const warning of warnings) console.warn(warning);

  const fetchedAt = Date.now();
  try {
    await writeSnapshot(key, {
      fetchedAt,
      indexedAt: result.indexedAt,
      hasIndexingErrors: result.hasIndexingErrors,
      data: validation.data,
    });
  } catch (err) {
    return fail(options, 500, `${label}: could not write the cache. ${messageOf(err)}`);
  }
  if (options.afterWrite) {
    try {
      await options.afterWrite(validation.data, fetchedAt);
    } catch (err) {
      console.warn(`${label}: data written, but its follow-up write failed. ${messageOf(err)}`);
    }
  }
  try {
    await recordSuccess(key, warnings);
  } catch (err) {
    // The data is in place; only the status hash is behind.
    console.warn(`${label}: cache written but the status hash was not updated. ${messageOf(err)}`);
  }

  return {
    status: 200,
    body: {
      ok: true,
      updated: true,
      key,
      pools: validation.data.length,
      indexedAt: result.indexedAt,
      hasIndexingErrors: result.hasIndexingErrors,
      warnings,
    },
  };
}

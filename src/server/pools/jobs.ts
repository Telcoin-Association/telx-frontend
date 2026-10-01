import "server-only";

import { runCronWrite, type CronWriteOptions } from "./cronWrite";
import { runHistoryExport, type HistoryExportResult } from "./history/export";
import { MERKL_JOBS } from "./merkl/store";
import { runRpcJob, type RpcJobResult } from "./rpc/job";

/**
 * The cron jobs that write through runCronWrite, one per data key, served at /api/cron/<job>: the
 * `merkl-rewards-*` jobs (src/server/pools/merkl), every 5 minutes. The schedules live in vercel.json.
 */
export const CRON_JOBS = {
  ...MERKL_JOBS,
} satisfies Record<string, CronWriteOptions>;

/** The Uniswap v4 RPC pipeline jobs, every 5 minutes, each writing `active-uniswap-<chain>-grouped:v3`. */
export const RPC_JOBS = {
  "uniswap-polygon-rpc": "polygon",
  "uniswap-base-rpc": "base",
  "uniswap-ethereum-rpc": "ethereum",
} as const;

/** The daily export of the Redis history to Vercel Blob (src/server/pools/history). */
export const HISTORY_EXPORT_JOB = "history-export";

export type CronJob = keyof typeof CRON_JOBS | keyof typeof RPC_JOBS | typeof HISTORY_EXPORT_JOB;

const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function isCronJob(job: string): job is CronJob {
  return has(CRON_JOBS, job) || has(RPC_JOBS, job) || job === HISTORY_EXPORT_JOB;
}

export function runJob(job: CronJob): Promise<RpcJobResult | HistoryExportResult> {
  if (job === HISTORY_EXPORT_JOB) return runHistoryExport();
  if (has(RPC_JOBS, job)) return runRpcJob(RPC_JOBS[job as keyof typeof RPC_JOBS]);
  return runCronWrite(CRON_JOBS[job as keyof typeof CRON_JOBS]);
}

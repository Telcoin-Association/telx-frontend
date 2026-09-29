import "server-only";

import { dailyKey, hourlyKey, quickswapKey } from "./cache";
import { runCronWrite, type CronWriteOptions } from "./cronWrite";
import { MERKL_JOBS } from "./merkl/store";
import { runRpcJob, type RpcJobResult } from "./rpc/job";
import {
  BalancerDailyResponseSchema,
  BalancerHourlyResponseSchema,
  QuickswapGroupedResponseSchema,
  UniswapDailyResponseSchema,
  UniswapHourlyResponseSchema,
} from "./schemas";
import { fetchBalancerHistory, fetchBalancerHourly } from "./subgraphs/balancer";
import { fetchQuickswapGrouped } from "./subgraphs/quickswap";
import { fetchUniswapHistory, fetchUniswapHourly } from "./subgraphs/uniswap";

/**
 * The cron jobs that write through runCronWrite, one per data key, served at /api/cron/<job>. The schedules
 * live in vercel.json: the `*-grouped` split jobs every 5 minutes, the `*-history` jobs and
 * `quickswap-grouped` hourly, and the `merkl-rewards-*` jobs (src/server/pools/merkl) every 10 minutes.
 */
export const CRON_JOBS = {
  "uniswap-base-grouped": {
    key: hourlyKey("uniswap-base"),
    fetch: () => fetchUniswapHourly("base"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap base hourly",
  },
  "uniswap-polygon-grouped": {
    key: hourlyKey("uniswap-polygon"),
    fetch: () => fetchUniswapHourly("polygon"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap polygon hourly",
  },
  "uniswap-ethereum-grouped": {
    key: hourlyKey("uniswap-ethereum"),
    fetch: () => fetchUniswapHourly("ethereum"),
    schema: UniswapHourlyResponseSchema,
    label: "Uniswap ethereum hourly",
  },
  "balancer-grouped": {
    key: hourlyKey("balancer"),
    fetch: () => fetchBalancerHourly(),
    schema: BalancerHourlyResponseSchema,
    label: "Balancer hourly",
  },
  "uniswap-base-history": {
    key: dailyKey("uniswap-base"),
    fetch: () => fetchUniswapHistory("base"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap base history",
  },
  "uniswap-polygon-history": {
    key: dailyKey("uniswap-polygon"),
    fetch: () => fetchUniswapHistory("polygon"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap polygon history",
  },
  "uniswap-ethereum-history": {
    key: dailyKey("uniswap-ethereum"),
    fetch: () => fetchUniswapHistory("ethereum"),
    schema: UniswapDailyResponseSchema,
    label: "Uniswap ethereum history",
  },
  "balancer-history": {
    key: dailyKey("balancer"),
    fetch: () => fetchBalancerHistory(),
    schema: BalancerDailyResponseSchema,
    label: "Balancer history",
  },
  "quickswap-grouped": {
    key: quickswapKey,
    fetch: () => fetchQuickswapGrouped(),
    schema: QuickswapGroupedResponseSchema,
    label: "QuickSwap",
  },
  ...MERKL_JOBS,
} satisfies Record<string, CronWriteOptions>;

/** The Uniswap v4 RPC pipeline jobs, every 5 minutes, each writing `active-uniswap-<chain>-grouped:v3`. */
export const RPC_JOBS = {
  "uniswap-polygon-rpc": "polygon",
  "uniswap-base-rpc": "base",
  "uniswap-ethereum-rpc": "ethereum",
} as const;

export type CronJob = keyof typeof CRON_JOBS | keyof typeof RPC_JOBS;

const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function isCronJob(job: string): job is CronJob {
  return has(CRON_JOBS, job) || has(RPC_JOBS, job);
}

export function runJob(job: CronJob): Promise<RpcJobResult> {
  if (has(RPC_JOBS, job)) return runRpcJob(RPC_JOBS[job as keyof typeof RPC_JOBS]);
  return runCronWrite(CRON_JOBS[job as keyof typeof CRON_JOBS]);
}

import "server-only";

import { randomUUID } from "node:crypto";

import { describeError } from "@/app/api/backendHelpers/errors";
import type { RpcChain } from "@/lib/rpc";

import { statusKey } from "../cache";
import { runCronWrite, type CronWriteResult } from "../cronWrite";
import { getRedis } from "../redis";
import { UniswapGroupedResponseSchema } from "../schemas";
import { CHAINS } from "./chains";
import { rpcClient } from "./client";
import { fetchMerklTelPrice } from "./merkl";
import { runChain, type RunDeps, type RunReport } from "./runChain";
import { acquireLock, releaseLock, v3Key, type RpcRedis } from "./store";

export type RpcJobResult = CronWriteResult | { status: 200; body: { ok: true; updated: false; skipped: string } };

/**
 * The `uniswap-<chain>-rpc` cron job: takes the chain's lock (a run that finds it held answers 200 skipped),
 * runs the pipeline, and writes the payload to `active-uniswap-<chain>-grouped:v3` through runCronWrite, which
 * validates it and keeps the status hash. The run report goes to the status hash as `lastRun`.
 */
export async function runRpcJob(chain: RpcChain, deps?: Partial<RunDeps>): Promise<RpcJobResult> {
  const redis = deps?.redis ?? (getRedis() as unknown as RpcRedis);
  const runId = randomUUID();
  const label = `Uniswap ${chain} RPC`;
  const key = v3Key(chain);

  if (!(await acquireLock(redis, chain, runId))) {
    return { status: 200, body: { ok: true, updated: false, skipped: "a previous run still holds the lock" } };
  }
  let report: RunReport | null = null;
  try {
    const result = await runCronWrite({
      key,
      label,
      schema: UniswapGroupedResponseSchema,
      fetch: async () => {
        try {
          const run = await runChain(chain, {
            client: deps?.client ?? rpcClient(chain),
            redis,
            now: deps?.now,
            config: deps?.config,
            pools: deps?.pools,
            merklTel: deps?.merklTel ?? (() => fetchMerklTelPrice(CHAINS[chain].chainId)),
          });
          report = run.report;
          return { groups: run.pools, indexedAt: run.asOf * 1000, hasIndexingErrors: false, warnings: run.warnings };
        } catch (err) {
          // Only a redacted description leaves this function: an RPC error's message can carry the Alchemy URL.
          throw new Error(`${label}: ${describeError(err)}`);
        }
      },
    });
    if (report) {
      try {
        await redis.hset(statusKey(key), { lastRun: JSON.stringify(report) });
      } catch (err) {
        console.warn(`${label}: could not record the run report. ${describeError(err)}`);
      }
    }
    return result;
  } finally {
    await releaseLock(redis, chain, runId).catch(() => {});
  }
}

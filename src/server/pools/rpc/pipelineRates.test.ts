/**
 * @jest-environment node
 */
import { memoryRedis } from "../testing";
import { PIPELINE_RATE_MAX_AGE_SECONDS, pipelineRates } from "./pipelineRates";
import { stateKey, type RpcRedis } from "./store";

const EUSD = "0x14913815bcfde78baead2111f463d038ac9c2949";
const EMXN = "0x68727e573d21a49c767c3c86a92d9f24bd933c99";
const TEL = "0x7e13b43065380acdec1c2d138c579cbbbafa0731";
const NOW = 1_790_700_000;

async function seed(prices: Record<string, unknown> | null, timestamp: number | null = NOW - 60) {
  const redis = memoryRedis() as unknown as RpcRedis;
  const state: Record<string, unknown> = { block: 1 };
  if (timestamp !== null) state.timestamp = timestamp;
  if (prices) state.prices = JSON.stringify({ tokens: prices, telRoutes: [], impliedEusd: null });
  await redis.hset(stateKey("polygon"), state);
  return redis;
}

describe("pipelineRates", () => {
  it("returns eUSD and eMXN from the latest Polygon prices, shaped like the Telcoin rates", async () => {
    const redis = await seed({
      [EUSD]: { usd: 1, source: "fixed" },
      [EMXN]: { usd: 0.0548, source: "feed" },
      [TEL]: { usd: 0.0023, source: "pools" },
    });
    await expect(pipelineRates(redis, NOW)).resolves.toEqual({ EUSD: { USD: "1" }, EMXN: { USD: "0.0548" } });
  });

  it("leaves out a price the pipeline flagged stale", async () => {
    const redis = await seed({ [EUSD]: { usd: 1, source: "fixed" }, [EMXN]: { usd: 0.05, source: "last", stale: true } });
    await expect(pipelineRates(redis, NOW)).resolves.toEqual({ EUSD: { USD: "1" } });
  });

  it("returns nothing when the state is too old, has no timestamp or no prices, or is missing", async () => {
    const prices = { [EUSD]: { usd: 1, source: "fixed" } };
    await expect(pipelineRates(await seed(prices, NOW - PIPELINE_RATE_MAX_AGE_SECONDS - 1), NOW)).resolves.toEqual({});
    await expect(pipelineRates(await seed(prices, null), NOW)).resolves.toEqual({});
    await expect(pipelineRates(await seed(null), NOW)).resolves.toEqual({});
    await expect(pipelineRates(memoryRedis() as unknown as RpcRedis, NOW)).resolves.toEqual({});
  });

  it("leaves out zero, negative and non-finite prices", async () => {
    const redis = await seed({ [EUSD]: { usd: 0, source: "fixed" }, [EMXN]: { usd: -1, source: "feed" } });
    await expect(pipelineRates(redis, NOW)).resolves.toEqual({});
  });
});

/**
 * @jest-environment node
 */
import { writeSnapshot } from "./cache";
import { readAllGrouped } from "./groupedRead";
import { v3Key } from "./rpc/store";
import { withEnv } from "./testing";

/**
 * The pool cache round trip through the real `@upstash/redis` clients, with only the HTTP endpoint faked: the
 * cron writes through the auto-serializing client (`writeSnapshot`), and GET /api/pools reads through the raw
 * pipelined client (`readAllGrouped`), which parses the `[field, value, ...]` reply itself. The fake endpoint
 * stores every value as a string, as Redis does, and base64-encodes replies when the client asks for it, so a
 * change in either client's encoding shows up here rather than in production.
 */

const URL_BASE = "https://upstash.example.test";
const hashes = new Map<string, Map<string, string>>();

const asRedisString = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

function run(command: unknown[]): unknown {
  const [name, key, ...args] = command as [string, string, ...unknown[]];
  switch (String(name).toLowerCase()) {
    case "hset": {
      const hash = hashes.get(key) ?? new Map<string, string>();
      for (let i = 0; i < args.length; i += 2) hash.set(String(args[i]), asRedisString(args[i + 1]));
      hashes.set(key, hash);
      return args.length / 2;
    }
    case "hgetall":
      return [...(hashes.get(key) ?? new Map()).entries()].flat();
    default:
      throw new Error(`fake Upstash: unsupported command ${name}`);
  }
}

const base64 = (value: unknown): unknown =>
  typeof value === "string" ? Buffer.from(value, "utf8").toString("base64") : Array.isArray(value) ? value.map(base64) : value;

async function fakeUpstash(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const encode = headers.get("upstash-encoding") === "base64" ? base64 : (value: unknown) => value;
  const body = JSON.parse(String(init?.body));
  if (url === `${URL_BASE}/pipeline`) {
    return Response.json((body as unknown[][]).map(command => ({ result: encode(run(command)) })));
  }
  if (url === URL_BASE || url === `${URL_BASE}/`) return Response.json({ result: encode(run(body as unknown[])) });
  return new Response("not found", { status: 404 });
}

let restoreEnv: () => void;
const realFetch = global.fetch;

beforeAll(() => {
  restoreEnv = withEnv({ KV_REST_API_URL: URL_BASE, KV_REST_API_TOKEN: "test-token" });
  global.fetch = jest.fn(fakeUpstash) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
  restoreEnv();
});

describe("pool cache through the real Upstash clients", () => {
  it("reads back what the cron wrote, numbers, booleans and nested JSON included", async () => {
    const now = Date.now();
    const pool = {
      id: "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d",
      pool: { id: "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d", feesUSD: 12.5 },
      poolSnapshots: [{ periodStartUnix: 1_790_000_000, volumeUSD: 1_234.5, feesUSD: 4.3 }],
      threeMonthLiquidityData: [{ timestamp: 1_790_000_000, tvlUSD: 146_287.1, feesUSD: 0, volumeUSD: 0 }],
      metrics: { tvlUSD: 146_287.1, volume24h: 319_800.97, fees24h: 1_117.89, window: "trailing-24h" },
    };
    await writeSnapshot(v3Key("polygon"), { fetchedAt: now - 60_000, indexedAt: now - 90_000, hasIndexingErrors: false, data: [pool] });

    const body = await readAllGrouped(["uniswap-polygon"]);

    expect(body.failed).toEqual({});
    const group = body.groups["uniswap-polygon"];
    expect(group).toMatchObject({ fetchedAt: now - 60_000, indexedAt: now - 90_000, hasIndexingErrors: false });
    expect(group?.data).toHaveLength(1);
    expect(group?.data?.[0]).toMatchObject({
      id: pool.id,
      pool: pool.pool,
      poolSnapshots: pool.poolSnapshots,
      threeMonthLiquidityData: pool.threeMonthLiquidityData,
      metrics: pool.metrics,
    });

    // Both clients really went through the endpoint, one request each (the client batches even a single command
    // onto /pipeline), and both asked for base64 replies, which the fake then sent.
    const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    for (const [url] of calls) expect(String(url).startsWith(URL_BASE)).toBe(true);
    for (const [, init] of calls) expect(new Headers(init.headers).get("upstash-encoding")).toBe("base64");
  });
});

/**
 * @jest-environment node
 */
import { Redis } from "@upstash/redis";
import { DEFAULT_DEADLINE_MS, POOLS_READ_DEADLINE_MS, REDIS_RETRY, getPoolsReadRedis, getRedis } from "./redis";

jest.mock("@upstash/redis", () => ({ Redis: jest.fn().mockImplementation(options => ({ options })) }));
const RedisMock = Redis as unknown as jest.Mock;

type Options = { signal: () => AbortSignal; retry: { retries: number; backoff: (retryCount: number) => number } };

/** Calls the `signal` option the client was built with and returns the timeout it asked for. */
function deadlineOf(options: Options): number {
  const timeout = jest.spyOn(AbortSignal, "timeout");
  const signal = options.signal();
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);
  const [ms] = timeout.mock.calls[0];
  timeout.mockRestore();
  return ms;
}

describe("getRedis", () => {
  const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };

  afterAll(() => {
    process.env.KV_REST_API_URL = saved.url;
    process.env.KV_REST_API_TOKEN = saved.token;
  });

  // The clients are cached for the life of the module, so these run in order: the failed calls must not
  // leave a client behind.
  it("throws a clear error and creates no client when the credentials are missing", () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    expect(() => getRedis()).toThrow("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
    expect(() => getPoolsReadRedis()).toThrow("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it("creates one client from the storage variables with deserialization on, one short retry and a long deadline", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";

    const first = getRedis();
    const second = getRedis();

    expect(second).toBe(first);
    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisMock).toHaveBeenCalledWith({
      url: "https://example.upstash.io",
      token: "token",
      automaticDeserialization: true,
      enableTelemetry: false,
      retry: REDIS_RETRY,
      signal: expect.any(Function),
    });
    expect(deadlineOf(RedisMock.mock.calls[0][0])).toBe(DEFAULT_DEADLINE_MS);
  });

  it("creates a separate read client for /api/pools with raw replies and the short deadline", () => {
    RedisMock.mockClear();

    const first = getPoolsReadRedis();
    const second = getPoolsReadRedis();

    expect(second).toBe(first);
    expect(first).not.toBe(getRedis());
    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisMock).toHaveBeenCalledWith({
      url: "https://example.upstash.io",
      token: "token",
      automaticDeserialization: false,
      enableTelemetry: false,
      retry: REDIS_RETRY,
      signal: expect.any(Function),
    });
    expect(deadlineOf(RedisMock.mock.calls[0][0])).toBe(POOLS_READ_DEADLINE_MS);
  });

  it("gives each command a new signal, so one expired deadline does not abort later commands", () => {
    const options: Options = RedisMock.mock.calls[0][0];
    expect(options.signal()).not.toBe(options.signal());
  });

  it("retries once after 100 ms, and gives writes more time than the page reads", () => {
    expect(REDIS_RETRY.retries).toBe(1);
    expect(REDIS_RETRY.backoff()).toBe(100);
    expect(POOLS_READ_DEADLINE_MS).toBeLessThanOrEqual(5_000);
    expect(DEFAULT_DEADLINE_MS).toBeGreaterThan(POOLS_READ_DEADLINE_MS);
  });
});

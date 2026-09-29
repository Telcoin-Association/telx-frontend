/**
 * @jest-environment node
 */
import { Redis } from "@upstash/redis";
import { getRedis } from "./redis";

jest.mock("@upstash/redis", () => ({ Redis: jest.fn().mockImplementation(options => ({ options })) }));
const RedisMock = Redis as unknown as jest.Mock;

describe("getRedis", () => {
  const saved = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };

  afterAll(() => {
    process.env.KV_REST_API_URL = saved.url;
    process.env.KV_REST_API_TOKEN = saved.token;
  });

  // The client is cached for the life of the module, so these run in order: the failed call must not
  // leave a client behind.
  it("throws a clear error and creates no client when the credentials are missing", () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    expect(() => getRedis()).toThrow("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it("creates one client from the storage variables with deserialization on and reuses it", () => {
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
    });
  });
});

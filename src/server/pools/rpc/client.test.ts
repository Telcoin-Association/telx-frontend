/**
 * @jest-environment node
 */
import { withEnv } from "../testing";
import { rpcClient } from "./client";

const KEY = "secret-alchemy-key";

function respond(status: number, body: unknown) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("rpcClient", () => {
  let restoreEnv = () => {};
  const realFetch = global.fetch;

  beforeEach(() => {
    restoreEnv = withEnv({ ALCHEMY_ID: KEY, NEXT_PUBLIC_ORIGIN: "https://www.telx.network" });
  });

  afterEach(() => {
    global.fetch = realFetch;
    restoreEnv();
  });

  it("throws without ALCHEMY_ID", () => {
    restoreEnv();
    restoreEnv = withEnv({ ALCHEMY_ID: undefined });
    expect(() => rpcClient("polygon")).toThrow("ALCHEMY_ID is not set");
  });

  it("calls Alchemy for the chain with the key and the allowlisted Origin", async () => {
    const fetchMock = respond(200, { jsonrpc: "2.0", id: 0, result: "0x10" });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(rpcClient("polygon", { retryCount: 0 }).request({ method: "eth_blockNumber" })).resolves.toBe("0x10");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://polygon-mainnet.g.alchemy.com/v2/${KEY}`);
    expect(new Headers(init.headers).get("Origin")).toBe("https://www.telx.network");
  });

  it("surfaces a 429 with the chain, the method and the status, without the key", async () => {
    global.fetch = respond(429, { error: "Too Many Requests" }) as unknown as typeof fetch;

    const error = await rpcClient("base", { retryCount: 0 })
      .request({ method: "eth_getLogs", params: [] })
      .catch((err: Error) => err);

    expect(String(error)).toMatch(/^Error: base eth_getLogs: .*HTTP 429/);
    expect(String(error)).not.toContain(KEY);
  });

  it("surfaces a JSON-RPC error such as -32600 with its code and message", async () => {
    global.fetch = respond(200, {
      jsonrpc: "2.0",
      id: 0,
      error: { code: -32600, message: "Unauthorized: origin not allowed" },
    }) as unknown as typeof fetch;

    const error = await rpcClient("ethereum", { retryCount: 0 })
      .request({ method: "eth_call", params: [] })
      .catch((err: Error) => err);

    expect(String(error)).toContain("ethereum eth_call:");
    expect(String(error)).toContain("code -32600");
    expect(String(error)).toContain("origin not allowed");
    expect(String(error)).not.toContain(KEY);
  });
});

/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { PREVIEW_AUTH_COOKIE, previewAuthToken } from "@/helpers/previewAuth";
import { POST } from "./route";

const PREVIEW_SECRET = "reviewer:s3cret";
const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

function rpcRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://preview.telx.network/api/rpc/polygon", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
}

const call = (request: NextRequest) => POST(request, { params: Promise.resolve({ chain: "polygon" }) });

const fetchMock = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  process.env.ALCHEMY_ID = "test-key";
  delete process.env.PREVIEW_BASIC_AUTH;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.PREVIEW_BASIC_AUTH;
});

describe("POST /api/rpc/[chain] preview gate", () => {
  it("does not check preview auth when PREVIEW_BASIC_AUTH is unset", async () => {
    const res = await call(rpcRequest());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("when PREVIEW_BASIC_AUTH is set", () => {
    beforeEach(() => {
      process.env.PREVIEW_BASIC_AUTH = PREVIEW_SECRET;
    });

    it("answers 401 without a login dialog and never reaches Alchemy without credentials", async () => {
      const res = await call(rpcRequest());
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects wrong credentials", async () => {
      const res = await call(rpcRequest({ authorization: basic("reviewer:wrong") }));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("forwards a request that carries the remember-me cookie", async () => {
      const token = await previewAuthToken(PREVIEW_SECRET);
      const res = await call(rpcRequest({ cookie: `${PREVIEW_AUTH_COOKIE}=${token}` }));
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("forwards a request that carries valid Basic credentials", async () => {
      const res = await call(rpcRequest({ authorization: basic(PREVIEW_SECRET) }));
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("POST /api/rpc/[chain] upstream request", () => {
  it("forwards the validated body with an abort signal", async () => {
    await call(rpcRequest());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards only the method that was validated when a key is duplicated", async () => {
    const raw = '{"jsonrpc":"2.0","id":1,"method":"debug_traceTransaction","method":"eth_blockNumber","params":[]}';
    await call(
      new NextRequest("https://www.telx.network/api/rpc/polygon", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: raw,
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).not.toContain("debug_traceTransaction");
    expect(JSON.parse(init.body).method).toBe("eth_blockNumber");
  });

  it("aborts and answers 502 when response headers take longer than the timeout", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    );

    const pending = call(rpcRequest());
    await jest.advanceTimersByTimeAsync(10_000);
    const res = await pending;

    expect(res.status).toBe(502);
    error.mockRestore();
    jest.useRealTimers();
  });
});

describe("POST /api/rpc/[chain] upstream failure", () => {
  it("answers 502 with a fixed body and logs without the key", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("fetch failed for https://polygon-mainnet.g.alchemy.com/v2/test-key"));

    const res = await call(rpcRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream RPC request failed" });
    expect(error.mock.calls.flat().join(" ")).not.toContain("test-key");
    error.mockRestore();
  });
});

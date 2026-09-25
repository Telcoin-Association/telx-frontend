/**
 * @jest-environment node
 */
import { RPC_MAX_BATCH } from "@/lib/rpc";
import { ALLOWED_RPC_METHODS, crossOriginRejection, rpcProxyRejection } from "./rpcProxy";

const request = (method: string, id: string | number = 1) => ({ jsonrpc: "2.0", id, method, params: [] });

describe("rpcProxyRejection", () => {
  it("forwards a single allowed request", () => {
    expect(rpcProxyRejection(request("eth_call"))).toBeNull();
  });

  it("rejects a disallowed method and echoes the request id", () => {
    expect(rpcProxyRejection(request("eth_sendRawTransaction", 7))).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "Method not supported by this proxy: eth_sendRawTransaction" },
    });
  });

  it("rejects Alchemy enhanced APIs", () => {
    expect(rpcProxyRejection(request("alchemy_getAssetTransfers"))).toMatchObject({ error: { code: -32601 } });
  });

  it("rejects a request without a string method", () => {
    expect(rpcProxyRejection({ jsonrpc: "2.0", id: 1 })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid request" },
    });
    expect(rpcProxyRejection("eth_call")).toMatchObject({ id: null });
    expect(rpcProxyRejection(null)).toMatchObject({ error: { code: -32600 } });
  });

  it("forwards a batch of allowed requests", () => {
    expect(rpcProxyRejection([request("eth_gasPrice", 1), request("eth_getTransactionReceipt", 2)])).toBeNull();
  });

  it("rejects a whole batch when one entry is disallowed, mirroring the ids", () => {
    const responses = rpcProxyRejection([request("eth_call", "a"), request("eth_sendRawTransaction", "b")]);
    expect(responses).toEqual([
      {
        jsonrpc: "2.0",
        id: "a",
        error: { code: -32600, message: "Batch rejected: Method not supported by this proxy: eth_sendRawTransaction" },
      },
      {
        jsonrpc: "2.0",
        id: "b",
        error: { code: -32601, message: "Method not supported by this proxy: eth_sendRawTransaction" },
      },
    ]);
  });

  it("forwards a batch of exactly RPC_MAX_BATCH requests", () => {
    const batch = Array.from({ length: RPC_MAX_BATCH }, (_, id) => request("eth_chainId", id));
    expect(rpcProxyRejection(batch)).toBeNull();
  });

  it("rejects a batch longer than RPC_MAX_BATCH with a single error", () => {
    const batch = Array.from({ length: RPC_MAX_BATCH + 1 }, (_, id) => request("eth_chainId", id));
    expect(rpcProxyRejection(batch)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: `Batch too large: ${RPC_MAX_BATCH + 1} requests (limit ${RPC_MAX_BATCH})` },
    });
  });

  it("rejects an empty batch", () => {
    expect(rpcProxyRejection([])).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  });

  it("never allows signing, broadcasting or subscriptions", () => {
    for (const method of ["eth_sendTransaction", "eth_sign", "eth_signTypedData_v4", "eth_subscribe", "eth_accounts"]) {
      expect(ALLOWED_RPC_METHODS.has(method)).toBe(false);
    }
  });
});

describe("crossOriginRejection", () => {
  it("allows a same-origin request", () => {
    expect(crossOriginRejection(new Headers({ "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("denies any other Sec-Fetch-Site value even when Origin matches", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const headers = new Headers({ "sec-fetch-site": site, origin: "https://telx.network", host: "telx.network" });
      expect(crossOriginRejection(headers)).toContain(site);
    }
  });

  it("allows a request without Sec-Fetch-Site when the Origin host equals the host", () => {
    expect(crossOriginRejection(new Headers({ origin: "https://telx.network", host: "telx.network" }))).toBeNull();
    expect(crossOriginRejection(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBeNull();
  });

  it("denies an Origin host that differs from the host", () => {
    const headers = new Headers({ origin: "https://evil.example", host: "telx.network" });
    expect(crossOriginRejection(headers)).toBe("origin host does not match");
    expect(crossOriginRejection(new Headers({ origin: "http://localhost:3001", host: "localhost:3000" }))).not.toBeNull();
  });

  it("prefers the first x-forwarded-host entry over host", () => {
    const forwarded = { origin: "https://telx.network", host: "internal.vercel.app" };
    expect(crossOriginRejection(new Headers({ ...forwarded, "x-forwarded-host": "telx.network" }))).toBeNull();
    expect(crossOriginRejection(new Headers({ ...forwarded, "x-forwarded-host": " telx.network , proxy.example" }))).toBeNull();
    expect(crossOriginRejection(new Headers({ ...forwarded, "x-forwarded-host": "proxy.example, telx.network" }))).toBe(
      "origin host does not match"
    );
    expect(
      crossOriginRejection(new Headers({ origin: "https://internal.vercel.app", host: "internal.vercel.app", "x-forwarded-host": "telx.network" }))
    ).toBe("origin host does not match");
  });

  it("denies an unparsable Origin", () => {
    expect(crossOriginRejection(new Headers({ origin: "null", host: "telx.network" }))).toBe("unparsable Origin header");
    expect(crossOriginRejection(new Headers({ origin: "telx.network", host: "telx.network" }))).not.toBeNull();
  });

  it("denies a request with neither Sec-Fetch-Site nor Origin", () => {
    expect(crossOriginRejection(new Headers({ host: "telx.network" }))).toBe("missing Origin header");
    expect(crossOriginRejection(new Headers())).toBe("missing Origin header");
  });

  it("compares hosts case-insensitively", () => {
    expect(crossOriginRejection(new Headers({ origin: "https://TELX.network", host: "telx.NETWORK" }))).toBeNull();
    expect(crossOriginRejection(new Headers({ origin: "https://telx.network", "x-forwarded-host": "TelX.Network" }))).toBeNull();
  });
});

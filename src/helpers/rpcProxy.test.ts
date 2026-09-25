/**
 * @jest-environment node
 */
import { ALLOWED_RPC_METHODS, rpcProxyRejection } from "./rpcProxy";

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
    expect(rpcProxyRejection(request("alchemy_getAssetTransfers"))?.error.code).toBe(-32601);
  });

  it("rejects a request without a string method", () => {
    expect(rpcProxyRejection({ jsonrpc: "2.0", id: 1 })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid request" },
    });
    expect(rpcProxyRejection("eth_call")?.id).toBeNull();
    expect(rpcProxyRejection(null)?.error.code).toBe(-32600);
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

  it("rejects an empty batch", () => {
    expect(rpcProxyRejection([])).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  });

  it("never allows signing, broadcasting or subscriptions", () => {
    for (const method of ["eth_sendTransaction", "eth_sign", "eth_signTypedData_v4", "eth_subscribe", "eth_accounts"]) {
      expect(ALLOWED_RPC_METHODS.has(method)).toBe(false);
    }
  });
});

import { isRpcChain, rpcProxyUrl } from "./rpc";

describe("rpcProxyUrl in the browser", () => {
  it("returns an absolute same-origin URL so ethers accepts it", () => {
    expect(rpcProxyUrl("polygon")).toBe(`${window.location.origin}/api/rpc/polygon`);
  });
});

describe("isRpcChain", () => {
  it("accepts the proxied chains and rejects anything else", () => {
    for (const chain of ["ethereum", "polygon", "base"]) {
      expect(isRpcChain(chain)).toBe(true);
    }
    expect(isRpcChain("solana")).toBe(false);
  });
});

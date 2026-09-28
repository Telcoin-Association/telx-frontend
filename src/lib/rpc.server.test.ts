/**
 * @jest-environment node
 */
import { rpcProxyUrl } from "./rpc";

describe("rpcProxyUrl during server rendering", () => {
  it("returns the bare path when there is no window", () => {
    expect(rpcProxyUrl("polygon")).toBe("/api/rpc/polygon");
  });
});

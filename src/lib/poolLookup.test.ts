import { findLoadedPool, registryChainsFor, registryPoolIds } from "./poolLookup";

const registry = [
  { attributes: { pool_address: "0xAbC", blockchain: "polygon", protocol: "dfx" } },
  { attributes: { pool_address: "0xv4", blockchain: "polygon", protocol: "uniswap" } },
  { attributes: { pool_address: "0xv4", blockchain: "base", protocol: "uniswap" } },
  { attributes: { pool_address: "0xhidden", blockchain: "ethereum", protocol: "uniswap", hidden: true } },
];

describe("registryChainsFor", () => {
  it("lists the chains an id is shown on, whatever the id's case", () => {
    expect(registryChainsFor("0xabc", registry)).toEqual(["polygon"]);
    expect(registryChainsFor("0xV4", registry)).toEqual(["polygon", "base"]);
  });

  it("is empty for an unknown or hidden id", () => {
    expect(registryChainsFor("0xdead", registry)).toEqual([]);
    expect(registryChainsFor("0xhidden", registry)).toEqual([]);
  });

  it("gives each shown id once as a static param", () => {
    expect(registryPoolIds(registry)).toEqual(["0xAbC", "0xv4"]);
  });
});

describe("findLoadedPool", () => {
  const legacy = { poolContractAddress: "0xAbC", blockchain: "polygon" };
  const v4Polygon = { poolContractAddress: "0xv4", blockchain: "polygon" };
  const v4Base = { poolContractAddress: "0xv4", blockchain: "base" };
  const loaded = [legacy, v4Polygon, v4Base];

  it("finds a legacy pool from a lowercased link", () => {
    expect(findLoadedPool("0xabc", undefined, loaded)).toEqual({ kind: "found", pool: legacy });
  });

  it("finds a Uniswap pool on the named chain", () => {
    expect(findLoadedPool("0xv4", "base", loaded)).toEqual({ kind: "found", pool: v4Base });
  });

  it("finds a pool on its only chain without ?chain=", () => {
    expect(findLoadedPool("0xv4", undefined, [v4Base])).toEqual({ kind: "found", pool: v4Base });
  });

  it("offers the chains when an id loaded on several is opened without ?chain=", () => {
    expect(findLoadedPool("0xv4", undefined, loaded)).toEqual({ kind: "choose", chains: ["polygon", "base"] });
  });

  it("offers the chains a pool is on when the named chain is not one of them", () => {
    expect(findLoadedPool("0xv4", "ethereum", loaded)).toEqual({ kind: "choose", chains: ["polygon", "base"] });
  });

  it("is missing when nothing loaded matches", () => {
    expect(findLoadedPool("0xdead", undefined, loaded)).toEqual({ kind: "missing" });
    expect(findLoadedPool("0xabc", undefined, [])).toEqual({ kind: "missing" });
  });
});

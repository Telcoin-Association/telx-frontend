/**
 * @jest-environment node
 */
import { DEFAULT_GROUP_SOURCES, gatingKeysOf, resolveGroupSources } from "./source";

jest.mock("../redis", () => ({ getRedis: jest.fn() }));

describe("group sources", () => {
  it("serves Polygon from v3 and Base and Ethereum from both sources by default", () => {
    expect(DEFAULT_GROUP_SOURCES).toEqual({ "uniswap-polygon": "v3", "uniswap-base": "mixed", "uniswap-ethereum": "mixed" });
    expect(resolveGroupSources(null)).toEqual(DEFAULT_GROUP_SOURCES);
  });

  it("takes every source value from config:grouped-source and ignores other values and groups", () => {
    expect(
      resolveGroupSources({ "uniswap-polygon": "mixed", "uniswap-base": "v2", "uniswap-ethereum": "v4", balancer: "v3", quickswap: "mixed" }),
    ).toEqual({ "uniswap-polygon": "mixed", "uniswap-base": "v2", "uniswap-ethereum": "mixed" });
  });

  it("gates a mixed group on its v3 key", () => {
    expect([gatingKeysOf("v2"), gatingKeysOf("v3"), gatingKeysOf("mixed")]).toEqual(["v2", "v3", "v3"]);
  });
});

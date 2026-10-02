import { ALL_POOL_COLUMNS, poolListColumns, poolRowGrid } from "./poolColumns";

describe("poolListColumns", () => {
  it("drops Status and Protocol when every pool is active and on the same protocol version", () => {
    const pools = [
      { deprecated: false, protocol: "uniswap", protocolVersion: "v4" },
      { deprecated: false, protocol: "Uniswap", protocolVersion: "v4" },
    ];
    expect(poolListColumns(pools)).toEqual({ status: false, protocol: false });
  });

  it("keeps Status when any pool is archived", () => {
    expect(poolListColumns([{ deprecated: true, protocol: "uniswap", protocolVersion: "v4" }, { deprecated: false, protocol: "uniswap", protocolVersion: "v4" }]).status).toBe(true);
  });

  it("keeps Protocol when protocols or versions differ", () => {
    expect(poolListColumns([{ protocol: "uniswap", protocolVersion: "v4" }, { protocol: "balancer", protocolVersion: "v2" }]).protocol).toBe(true);
    expect(poolListColumns([{ protocol: "uniswap", protocolVersion: "v3" }, { protocol: "uniswap", protocolVersion: "v4" }]).protocol).toBe(true);
  });

  it("drops both for an empty list", () => {
    expect(poolListColumns([])).toEqual({ status: false, protocol: false });
  });
});

describe("poolRowGrid", () => {
  const tracks = (grid: string) => grid.split(" ").map(cls => cls.slice(cls.indexOf("[") + 1, -1).split("_").length);

  it("gives one track per shown column, at both widths", () => {
    expect(tracks(poolRowGrid(ALL_POOL_COLUMNS))).toEqual([9, 9]);
    expect(tracks(poolRowGrid({ status: true, protocol: false }))).toEqual([8, 8]);
    expect(tracks(poolRowGrid({ status: false, protocol: true }))).toEqual([8, 8]);
    expect(tracks(poolRowGrid({ status: false, protocol: false }))).toEqual([7, 7]);
  });
});

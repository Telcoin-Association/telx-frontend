import {
  buildTokenOptions,
  EMPTY_TOKEN_FILTER,
  filterPoolsByTokens,
  isTokenFilterActive,
  matchesTokenQuery,
  poolTokenKeys,
  readPoolListUrlState,
  tokenKeyOf,
  writePoolListUrlState,
} from "./poolTokenFilter";

const pool = (id: string, tickers: string[], blockchain = "polygon") => ({ id, blockchain, assets: tickers.map((ticker) => ({ ticker, weight: 50 })) });

const wethTel = pool("weth-tel", ["WETH", "TEL"]);
const ethTel = pool("eth-tel", ["ETH", "TEL"], "base");
const eusdTel = pool("eusd-tel", ["eUSD", "TEL"]);
const eusdEmxn = pool("eusd-emxn", ["eUSD", "eMXN"]);
const usdcE = pool("usdce-tel", ["USDC.e", "TEL"]);
const usdc = pool("usdc-tel", ["USDC", "TEL"]);
const pools = [wethTel, ethTel, eusdTel, eusdEmxn, usdcE, usdc];

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe("token keys", () => {
  it("groups native and wrapped gas tokens and lower-cases the rest", () => {
    expect(tokenKeyOf("WETH")).toBe("eth");
    expect(tokenKeyOf("ETH")).toBe("eth");
    expect(tokenKeyOf("WMATIC")).toBe("pol");
    expect(tokenKeyOf("eUSD")).toBe("eusd");
    expect(tokenKeyOf("USDC.e")).toBe("usdc.e");
  });

  it("lists a pool's distinct keys", () => {
    expect(poolTokenKeys(pool("x", ["ETH", "WETH", "TEL"]))).toEqual(["eth", "tel"]);
    expect(poolTokenKeys({ assets: null })).toEqual([]);
  });
});

describe("buildTokenOptions", () => {
  it("builds one option per token from the pools, most common first, with counts", () => {
    expect(buildTokenOptions(pools)).toEqual([
      { key: "tel", label: "TEL", ticker: "TEL", count: 5 },
      { key: "eth", label: "ETH / WETH", ticker: "WETH", count: 2 },
      { key: "eusd", label: "eUSD", ticker: "eUSD", count: 2 },
      { key: "emxn", label: "eMXN", ticker: "eMXN", count: 1 },
      { key: "usdc", label: "USDC", ticker: "USDC", count: 1 },
      { key: "usdc.e", label: "USDC.e", ticker: "USDC.e", count: 1 },
    ]);
  });

  it("counts a pool once even when two of its assets share a group", () => {
    expect(buildTokenOptions([pool("x", ["ETH", "WETH"])])).toEqual([{ key: "eth", label: "ETH / WETH", ticker: "ETH", count: 1 }]);
  });
});

describe("matchesTokenQuery", () => {
  it("matches symbols case-insensitively, so usdc finds USDC and USDC.e", () => {
    expect(ids(pools.filter((p) => matchesTokenQuery(p, "usdc")))).toEqual(["usdce-tel", "usdc-tel"]);
    expect(ids(pools.filter((p) => matchesTokenQuery(p, "TeL")))).toEqual(["weth-tel", "eth-tel", "eusd-tel", "usdce-tel", "usdc-tel"]);
  });

  it("matches full names and group labels", () => {
    expect(ids(pools.filter((p) => matchesTokenQuery(p, "peso")))).toEqual(["eusd-emxn"]);
    expect(ids(pools.filter((p) => matchesTokenQuery(p, "telcoin")))).toEqual(["weth-tel", "eth-tel", "eusd-tel", "usdce-tel", "usdc-tel"]);
    expect(ids(pools.filter((p) => matchesTokenQuery(p, "ether")))).toEqual(["weth-tel", "eth-tel"]);
  });

  it("matches everything for blank text", () => {
    expect(pools.every((p) => matchesTokenQuery(p, "  "))).toBe(true);
  });
});

describe("filterPoolsByTokens", () => {
  it("shows pools with any selected token", () => {
    expect(ids(filterPoolsByTokens(pools, { query: "", tokens: ["eth", "emxn"], matchAll: false }))).toEqual(["weth-tel", "eth-tel", "eusd-emxn"]);
  });

  it("shows only pools with every selected token when matching all", () => {
    expect(ids(filterPoolsByTokens(pools, { query: "", tokens: ["eth", "tel"], matchAll: true }))).toEqual(["weth-tel", "eth-tel"]);
    expect(filterPoolsByTokens(pools, { query: "", tokens: ["eth", "emxn"], matchAll: true })).toEqual([]);
  });

  it("combines the search text with the checkboxes", () => {
    expect(ids(filterPoolsByTokens(pools, { query: "usdc", tokens: ["tel"], matchAll: false }))).toEqual(["usdce-tel", "usdc-tel"]);
  });

  it("returns every pool with no filter", () => {
    expect(filterPoolsByTokens(pools, EMPTY_TOKEN_FILTER)).toHaveLength(pools.length);
    expect(isTokenFilterActive(EMPTY_TOKEN_FILTER)).toBe(false);
    expect(isTokenFilterActive({ query: "", tokens: ["tel"], matchAll: false })).toBe(true);
  });
});

describe("URL state", () => {
  it("round-trips search, tokens, match mode and chain, keeping other parameters", () => {
    const state = { query: "usdc", tokens: ["eth", "tel"], matchAll: true, chain: "base" as const };
    const written = writePoolListUrlState("view=archive", state);
    expect(written).toBe("view=archive&q=usdc&tokens=eth%2Ctel&match=all&chain=base");
    expect(readPoolListUrlState(`?${written}`)).toEqual(state);
  });

  it("leaves defaults out, so an unfiltered list has a clean URL", () => {
    expect(writePoolListUrlState("q=old&tokens=tel&chain=base", { query: " ", tokens: [], matchAll: true, chain: "all" })).toBe("");
    expect(writePoolListUrlState("", { query: "", tokens: ["tel"], matchAll: true, chain: "all" })).toBe("tokens=tel");
  });

  it("ignores unknown chains and repeated tokens", () => {
    expect(readPoolListUrlState("?chain=solana&tokens=TEL,tel,,eth")).toEqual({ query: "", tokens: ["tel", "eth"], matchAll: false, chain: "all" });
  });
});

import { POOL_CHAIN_FILTERS, type PoolChainFilter } from "./poolOrder";

/** A pool as the token filter reads it: its chain and its assets' tickers. */
export type TokenFilterablePool = {
  blockchain?: string | null;
  assets?: ReadonlyArray<{ ticker?: string | null } | null | undefined> | null;
};

/**
 * Tickers that the filter treats as one token. Native and wrapped versions of a chain's gas token share a checkbox,
 * since an LP looking for ETH pools wants the WETH pools too. TEL and TEL3 already share the ticker "TEL".
 */
const TOKEN_GROUPS: ReadonlyArray<{ key: string; label: string; tickers: readonly string[] }> = [
  { key: "eth", label: "ETH / WETH", tickers: ["eth", "weth"] },
  { key: "pol", label: "POL / MATIC", tickers: ["pol", "wpol", "matic", "wmatic"] },
];

const GROUP_BY_TICKER = new Map(TOKEN_GROUPS.flatMap((group) => group.tickers.map((ticker) => [ticker, group] as const)));

/** Full names for the tokens in TELx pools, so a search for "telcoin" or "peso" finds them as well as the symbol. */
const TOKEN_NAMES: Record<string, string> = {
  tel: "Telcoin",
  eth: "Ether",
  weth: "Wrapped Ether",
  pol: "Polygon",
  wpol: "Wrapped POL",
  matic: "Polygon Matic",
  wmatic: "Wrapped Matic",
  usdc: "USD Coin",
  "usdc.e": "Bridged USD Coin",
  usdt: "Tether USD",
  eusd: "US Dollar Digital Cash",
  emxn: "Mexican Peso Digital Cash",
  wbtc: "Wrapped Bitcoin",
  bal: "Balancer",
  dfx: "DFX Finance",
  quick: "QuickSwap",
  aave: "Aave",
};

const normalise = (ticker: string | null | undefined) => (ticker ?? "").trim().toLowerCase();

/** The filter key a ticker belongs to: its group's key, or the ticker itself in lower case. */
export function tokenKeyOf(ticker: string | null | undefined): string {
  const lower = normalise(ticker);
  return GROUP_BY_TICKER.get(lower)?.key ?? lower;
}

/** The distinct filter keys of a pool's assets. */
export function poolTokenKeys(pool: TokenFilterablePool): string[] {
  const keys = (pool.assets ?? []).map((asset) => tokenKeyOf(asset?.ticker)).filter(Boolean);
  return [...new Set(keys)];
}

/** One checkbox in the Tokens filter. `ticker` is the symbol whose logo the option shows. */
export type TokenOption = { key: string; label: string; ticker: string; count: number };

/**
 * The tokens that appear in `pools`, one option per filter key, with the number of pools containing each. Ordered
 * by that count, most common first, then by label.
 */
export function buildTokenOptions(pools: readonly TokenFilterablePool[]): TokenOption[] {
  const options = new Map<string, TokenOption>();
  for (const pool of pools) {
    const seen = new Set<string>();
    for (const asset of pool.assets ?? []) {
      const ticker = (asset?.ticker ?? "").trim();
      const key = tokenKeyOf(ticker);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const group = GROUP_BY_TICKER.get(ticker.toLowerCase());
      const existing = options.get(key);
      if (existing) existing.count += 1;
      else options.set(key, { key, label: group?.label ?? ticker, ticker, count: 1 });
    }
  }
  return [...options.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** True when any of the pool's tickers, their full names or their group label contains `query`. */
export function matchesTokenQuery(pool: TokenFilterablePool, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (pool.assets ?? []).some((asset) => {
    const ticker = normalise(asset?.ticker);
    if (!ticker) return false;
    const group = GROUP_BY_TICKER.get(ticker);
    return [ticker, TOKEN_NAMES[ticker] ?? "", group?.label ?? ""].some((text) => text.toLowerCase().includes(needle));
  });
}

export type TokenFilter = { query: string; tokens: readonly string[]; matchAll: boolean };

export const EMPTY_TOKEN_FILTER: TokenFilter = { query: "", tokens: [], matchAll: false };

/**
 * The pools matching the search text and the token checkboxes. With several tokens chosen, a pool matches when it
 * contains any of them, or all of them with `matchAll`.
 */
export function filterPoolsByTokens<T extends TokenFilterablePool>(pools: readonly T[], filter: TokenFilter): T[] {
  return pools.filter((pool) => {
    if (!matchesTokenQuery(pool, filter.query)) return false;
    if (filter.tokens.length === 0) return true;
    const keys = new Set(poolTokenKeys(pool));
    return filter.matchAll ? filter.tokens.every((token) => keys.has(token)) : filter.tokens.some((token) => keys.has(token));
  });
}

/** True when the token filter narrows the list at all. */
export function isTokenFilterActive(filter: TokenFilter): boolean {
  return filter.query.trim() !== "" || filter.tokens.length > 0;
}

/** The filter state a pool list keeps in the page URL, so a filtered view can be shared and survives a reload. */
export type PoolListUrlState = TokenFilter & { chain: PoolChainFilter };

/**
 * Reads the list state from a query string: `q` (search text), `tokens` (comma separated filter keys), `match=all`
 * and `chain`. Unknown chains fall back to all.
 */
export function readPoolListUrlState(search: string): PoolListUrlState {
  const params = new URLSearchParams(search);
  const chain = (params.get("chain") ?? "all").toLowerCase();
  const tokens = (params.get("tokens") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return {
    query: params.get("q") ?? "",
    tokens: [...new Set(tokens)],
    matchAll: params.get("match") === "all",
    chain: (POOL_CHAIN_FILTERS as readonly string[]).includes(chain) ? (chain as PoolChainFilter) : "all",
  };
}

/**
 * Writes the list state into `search`, keeping any other parameters, and leaving out values at their defaults so an
 * unfiltered list has a clean URL. Returns the query string without the leading "?".
 */
export function writePoolListUrlState(search: string, state: PoolListUrlState): string {
  const params = new URLSearchParams(search);
  const set = (name: string, value: string | null) => (value ? params.set(name, value) : params.delete(name));
  set("q", state.query.trim() || null);
  set("tokens", state.tokens.length > 0 ? state.tokens.join(",") : null);
  set("match", state.matchAll && state.tokens.length > 1 ? "all" : null);
  set("chain", state.chain === "all" ? null : state.chain);
  return params.toString();
}

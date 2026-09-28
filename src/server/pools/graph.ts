import "server-only";

import { ApolloClient, HttpLink, InMemoryCache, type DocumentNode } from "@apollo/client";

import type { RegistryPool } from "./registry";

const GATEWAY_URL = "https://gateway.thegraph.com/api/subgraphs/id";

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 20;

/** The part of an Apollo client that runQuery uses. Tests pass a plain object. */
export type GraphClient = {
  query(options: {
    query: DocumentNode;
    variables?: Record<string, unknown>;
    fetchPolicy?: "no-cache";
    errorPolicy?: "all";
  }): Promise<{
    data?: unknown;
    errors?: ReadonlyArray<{ message: string }>;
    error?: { message: string };
  }>;
};

/** `_meta` as every query selects it: `_meta { block { number timestamp } hasIndexingErrors }`. */
export type GraphMeta = {
  block?: { number?: number | null; timestamp?: number | null } | null;
  hasIndexingErrors?: boolean | null;
};

export type Freshness = {
  indexedAt: number | null; // ms, from _meta.block.timestamp
  hasIndexingErrors: boolean;
};

/**
 * What every fetcher returns: grouped pools, how fresh the subgraph was, and warnings about problems
 * that did not stop the fetch (an archived pool the subgraph no longer returns, a fallback taken).
 */
export type SubgraphFetch<G> = Freshness & { groups: G[]; warnings: string[] };

/** Thrown by paginateById when MAX_PAGES full pages are not enough. */
export class PageLimitError extends Error {
  constructor(pageSize: number) {
    super(`paginateById: more than ${MAX_PAGES} pages of ${pageSize} rows`);
    this.name = "PageLimitError";
  }
}

export function createGraphClient(subgraphId: string): GraphClient {
  // Read here, not at module load, so modules that import this can load without the key.
  const key = process.env.GRAPH_STUDIO_KEY;
  if (!key) throw new Error("GRAPH_STUDIO_KEY is not set");

  return new ApolloClient({
    link: new HttpLink({
      uri: `${GATEWAY_URL}/${subgraphId}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: "no-cache", errorPolicy: "all" },
    },
  });
}

/** Runs one query. Throws on any GraphQL error, even when partial data came back. */
export async function runQuery<T>(client: GraphClient, query: DocumentNode, variables: Record<string, unknown>, label: string): Promise<T> {
  let result: Awaited<ReturnType<GraphClient["query"]>>;
  try {
    result = await client.query({ query, variables, fetchPolicy: "no-cache", errorPolicy: "all" });
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const messages = result.errors?.length ? result.errors.map(err => err.message) : result.error ? [result.error.message] : [];
  if (messages.length) {
    throw new Error(`${label}: ${messages.join("; ")}`);
  }
  if (!result.data) {
    throw new Error(`${label}: subgraph returned no data`);
  }
  return result.data as T;
}

/**
 * Compares the registry pools of a group with the pools the subgraph returned (ids compared lowercase).
 * Throws naming every missing active pool, since those are what the site shows. Missing archived pools
 * do not stop the fetch; they come back as a warning.
 */
export function checkPoolsPresent(
  expected: readonly Pick<RegistryPool, "id" | "active">[],
  pools: ReadonlyArray<{ id?: unknown } | null> | null | undefined,
  label: string,
): string[] {
  const found = new Set((pools ?? []).map(pool => (typeof pool?.id === "string" ? pool.id.toLowerCase() : "")));
  const missing = expected.filter(pool => !found.has(pool.id.toLowerCase()));
  const missingActive = missing.filter(pool => pool.active).map(pool => pool.id);
  const missingArchived = missing.filter(pool => !pool.active).map(pool => pool.id);

  if (missingActive.length) {
    throw new Error(`${label}: subgraph did not return pools ${missingActive.join(", ")}`);
  }
  return missingArchived.length ? [`${label}: subgraph did not return archived pools ${missingArchived.join(", ")}`] : [];
}

export function readMeta(data: { _meta?: GraphMeta | null } | null | undefined): Freshness {
  const timestamp = data?._meta?.block?.timestamp;
  return {
    indexedAt: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp * 1000 : null,
    hasIndexingErrors: data?._meta?.hasIndexingErrors === true,
  };
}

/**
 * Fetches pages ordered by `id` asc with an `id_gt` cursor until a page comes back short.
 * Throws PageLimitError rather than return a truncated list when MAX_PAGES full pages are not enough.
 */
export async function paginateById<T extends { id?: unknown }>(fetchPage: (cursorId: string) => Promise<T[]>, pageSize: number = PAGE_SIZE): Promise<T[]> {
  const rows: T[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(cursor);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;

    const lastId = batch[batch.length - 1]?.id;
    if (typeof lastId !== "string" || lastId === "") {
      throw new Error("paginateById: row without an id; cannot continue the cursor");
    }
    cursor = lastId;
  }
  throw new PageLimitError(pageSize);
}

/**
 * Runs a query whose `rowsKey` selection pages by id (`id_gt: $cursor`, `first: $first`). The query
 * is re-run per page; the other selections are taken from the first page. Freshness is the oldest
 * block seen and any indexing error on any page.
 */
export async function runPaginatedQuery<T extends object>(
  client: GraphClient,
  query: DocumentNode,
  variables: Record<string, unknown>,
  rowsKey: keyof T & string,
  label: string,
  pageSize: number = PAGE_SIZE,
): Promise<Freshness & { data: T }> {
  const pages: T[] = [];
  const rows = await paginateById(async cursor => {
    const page = await runQuery<T>(client, query, { ...variables, cursor, first: pageSize }, label);
    const batch = (page as Record<string, unknown>)[rowsKey];
    if (!Array.isArray(batch)) {
      throw new Error(`${label}: subgraph returned no ${rowsKey}`);
    }
    pages.push(page);
    return batch as { id?: unknown }[];
  }, pageSize);

  const metas = pages.map(page => readMeta(page as { _meta?: GraphMeta | null }));
  const indexedAts = metas.flatMap(meta => (meta.indexedAt === null ? [] : [meta.indexedAt]));
  return {
    data: { ...pages[0], [rowsKey]: rows },
    indexedAt: indexedAts.length ? Math.min(...indexedAts) : null,
    hasIndexingErrors: metas.some(meta => meta.hasIndexingErrors),
  };
}

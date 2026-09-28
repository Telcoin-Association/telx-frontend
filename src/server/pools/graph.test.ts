/**
 * @jest-environment node
 */
import { gql } from "@apollo/client";

import { MAX_PAGES, PageLimitError, checkPoolsPresent, createGraphClient, paginateById, readMeta, runPaginatedQuery, runQuery, type GraphClient } from "./graph";
import { fakeClient, withEnv } from "./testing";

const QUERY = gql`
  query {
    pools {
      id
    }
  }
`;

describe("createGraphClient", () => {
  let restoreEnv = () => {};
  afterEach(() => restoreEnv());

  it("throws when GRAPH_STUDIO_KEY is not set", () => {
    restoreEnv = withEnv({ GRAPH_STUDIO_KEY: "" });
    expect(() => createGraphClient("abc")).toThrow("GRAPH_STUDIO_KEY is not set");
  });

  it("builds a client usable by runQuery when the key is set", () => {
    restoreEnv = withEnv({ GRAPH_STUDIO_KEY: "key" });
    const client: GraphClient = createGraphClient("abc");
    expect(typeof client.query).toBe("function");
  });
});

describe("runQuery", () => {
  it("returns data and asks for no-cache with all errors", async () => {
    const { client, query } = fakeClient({ data: { pools: [{ id: "0xa" }] } });
    await expect(runQuery(client, QUERY, { a: 1 }, "test")).resolves.toEqual({ pools: [{ id: "0xa" }] });
    expect(query).toHaveBeenCalledWith({ query: QUERY, variables: { a: 1 }, fetchPolicy: "no-cache", errorPolicy: "all" });
  });

  it("throws on GraphQL errors even when partial data came back", async () => {
    const { client } = fakeClient({
      data: { pools: [{ id: "0xa" }] },
      errors: [{ message: "indexer behind" }, { message: "bad block" }],
    });
    await expect(runQuery(client, QUERY, {}, "Uniswap base")).rejects.toThrow("Uniswap base: indexer behind; bad block");
  });

  it("throws on an ApolloError when errors is absent", async () => {
    const { client } = fakeClient({ data: { pools: [] }, error: { message: "boom" } });
    await expect(runQuery(client, QUERY, {}, "x")).rejects.toThrow("x: boom");
  });

  it("throws when no data came back", async () => {
    const { client } = fakeClient({ data: undefined });
    await expect(runQuery(client, QUERY, {}, "x")).rejects.toThrow("x: subgraph returned no data");
  });

  it("labels network failures", async () => {
    const query = (jest.fn() as jest.MockedFunction<GraphClient["query"]>).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(runQuery({ query }, QUERY, {}, "Balancer")).rejects.toThrow("Balancer: fetch failed");
  });
});

describe("checkPoolsPresent", () => {
  const active = (id: string) => ({ id, active: true });
  const archived = (id: string) => ({ id, active: false });

  it("passes when every requested id came back, ignoring case", () => {
    expect(checkPoolsPresent([active("0xabc"), archived("0xdef")], [{ id: "0xABC" }, { id: "0xdef" }], "x")).toEqual([]);
  });

  it("names every missing active id", () => {
    expect(() => checkPoolsPresent([active("0xa"), active("0xb"), active("0xc")], [{ id: "0xb" }], "Quickswap")).toThrow(
      "Quickswap: subgraph did not return pools 0xa, 0xc",
    );
  });

  it("returns a warning instead of throwing when only archived pools are missing", () => {
    expect(checkPoolsPresent([active("0xa"), archived("0xb"), archived("0xc")], [{ id: "0xa" }], "Uniswap base hourly")).toEqual([
      "Uniswap base hourly: subgraph did not return archived pools 0xb, 0xc",
    ]);
  });

  it("throws for a missing active pool even when archived pools are missing too, naming only the active one", () => {
    expect(() => checkPoolsPresent([active("0xa"), archived("0xb")], [], "x")).toThrow(/^x: subgraph did not return pools 0xa$/);
  });

  it("treats a missing pools list as nothing returned", () => {
    expect(() => checkPoolsPresent([active("0xa")], undefined, "x")).toThrow("0xa");
    expect(checkPoolsPresent([archived("0xa")], null, "x")).toHaveLength(1);
  });
});

describe("readMeta", () => {
  it("converts the block timestamp to ms", () => {
    expect(readMeta({ _meta: { block: { number: 1, timestamp: 1_700_000_000 }, hasIndexingErrors: true } })).toEqual({
      indexedAt: 1_700_000_000_000,
      hasIndexingErrors: true,
    });
  });

  it("returns null indexedAt when the block has no timestamp", () => {
    expect(readMeta({ _meta: { block: { number: 1, timestamp: null }, hasIndexingErrors: false } })).toEqual({
      indexedAt: null,
      hasIndexingErrors: false,
    });
    expect(readMeta({})).toEqual({ indexedAt: null, hasIndexingErrors: false });
  });
});

describe("paginateById", () => {
  const rows = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `row-${String(from + i).padStart(5, "0")}` }));

  it("stops after a short first page", async () => {
    const fetchPage = jest.fn(async () => rows(0, 3));
    await expect(paginateById(fetchPage, 5)).resolves.toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith("");
  });

  it("follows the last id of each full page", async () => {
    const pages = [rows(0, 2), rows(2, 2), rows(4, 1)];
    const fetchPage = jest.fn(async (_cursor: string) => pages.shift() ?? []);
    const all = await paginateById(fetchPage, 2);
    expect(all.map((row) => row.id)).toEqual(rows(0, 5).map((row) => row.id));
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual(["", "row-00001", "row-00003"]);
  });

  it("asks once more after an exactly full page", async () => {
    const pages = [rows(0, 2), []];
    const fetchPage = jest.fn(async () => pages.shift() ?? []);
    await expect(paginateById(fetchPage, 2)).resolves.toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("throws a PageLimitError instead of truncating after the page cap", async () => {
    let n = 0;
    const fetchPage = jest.fn(async () => rows(n++ * 2, 2));
    const result = paginateById(fetchPage, 2);
    await expect(result).rejects.toThrow(`more than ${MAX_PAGES} pages`);
    await expect(result).rejects.toBeInstanceOf(PageLimitError);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("throws when a full page ends in a row without an id", async () => {
    await expect(paginateById(async () => [{ id: "a" }, {}], 2)).rejects.toThrow("row without an id");
  });
});

describe("runPaginatedQuery", () => {
  const meta = (timestamp: number | null, hasIndexingErrors = false) => ({
    block: { number: 1, timestamp },
    hasIndexingErrors,
  });

  it("pages the rows selection, keeps the first page's other selections, and folds freshness", async () => {
    const { client, query } = fakeClient(
      { data: { pools: [{ id: "0xa" }], rows: [{ id: "1" }, { id: "2" }], _meta: meta(200) } },
      { data: { pools: [{ id: "0xb" }], rows: [{ id: "3" }], _meta: meta(100, true) } },
    );

    const result = await runPaginatedQuery<{ pools: { id: string }[]; rows: { id: string }[] }>(
      client,
      QUERY,
      { poolIds: ["0xa"] },
      "rows",
      "x",
      2,
    );

    expect(query.mock.calls.map(([options]) => options.variables)).toEqual([
      { poolIds: ["0xa"], cursor: "", first: 2 },
      { poolIds: ["0xa"], cursor: "2", first: 2 },
    ]);
    expect(result.data.pools).toEqual([{ id: "0xa" }]);
    expect(result.data.rows).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(result.indexedAt).toBe(100_000);
    expect(result.hasIndexingErrors).toBe(true);
  });

  it("uses a page size of 1000 by default", async () => {
    const { client, query } = fakeClient({ data: { rows: [], _meta: meta(null) } });
    const result = await runPaginatedQuery<{ rows: unknown[] }>(client, QUERY, {}, "rows", "x");
    expect(query.mock.calls[0][0].variables).toEqual({ cursor: "", first: 1000 });
    expect(result.indexedAt).toBeNull();
  });

  it("throws when the rows selection is missing", async () => {
    const { client } = fakeClient({ data: { pools: [] } });
    await expect(runPaginatedQuery<{ rows?: unknown[] }>(client, QUERY, {}, "rows", "x")).rejects.toThrow(
      "x: subgraph returned no rows",
    );
  });
});

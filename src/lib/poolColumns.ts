/** Which optional columns a pool list shows beside the pool, its figures and its rewards. */
export type PoolListColumns = { status: boolean; protocol: boolean };

/** Every column, for lists that can mix active and archived pools or several protocols. */
export const ALL_POOL_COLUMNS: PoolListColumns = { status: true, protocol: true };

type ColumnFields = { deprecated?: unknown; protocol?: unknown; protocolVersion?: unknown };

/**
 * The columns worth showing for `pools`: Status only when some pool is archived, and Protocol only when the pools
 * differ in protocol or version. A column that reads the same on every row says nothing, so it gives its space to
 * the figures. Callers pass the whole list rather than a filtered view, so the columns don't change as filters do.
 */
export function poolListColumns(pools: readonly ColumnFields[]): PoolListColumns {
  const protocols = new Set(pools.map(pool => `${String(pool.protocol ?? "").toLowerCase()}:${String(pool.protocolVersion ?? "")}`));
  return {
    status: pools.some(pool => pool.deprecated === true),
    protocol: protocols.size > 1,
  };
}

// Grid templates for each column set, written out in full so Tailwind generates every class.
const GRIDS = {
  "status,protocol":
    "grid-cols-[0.3fr_1fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr] lg:grid-cols-[0.4fr_2.5fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]",
  status: "grid-cols-[0.3fr_1fr_0.5fr_1fr_1fr_1fr_1fr_1fr] lg:grid-cols-[0.4fr_2.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]",
  protocol: "grid-cols-[0.3fr_1fr_0.5fr_1fr_1fr_1fr_1fr_1fr] lg:grid-cols-[0.4fr_2.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]",
  none: "grid-cols-[0.3fr_1.2fr_1fr_1fr_1fr_1fr_1.2fr] lg:grid-cols-[0.4fr_2.5fr_1fr_1fr_1fr_1fr_1.2fr]",
} as const;

/** The row and header grid for a column set, shared by the header, the rows and the loading skeleton. */
export function poolRowGrid(columns: PoolListColumns): string {
  if (columns.status && columns.protocol) return GRIDS["status,protocol"];
  if (columns.status) return GRIDS.status;
  if (columns.protocol) return GRIDS.protocol;
  return GRIDS.none;
}

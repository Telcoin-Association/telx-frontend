import type { Position } from "./positions";
import { orderPoolAssets, positionStatus, positionUsdValue, type PoolAsset, type UsdRates } from "./positionView";

/**
 * Pure helpers behind the Portfolio summary: position value and subscription counts across pools, and
 * sums of per-chain amounts where some chains may be unknown. Nothing here reads the chain or the network.
 */

/** One pool's positions, with the pool assets in any order (they are sorted into currency order here). */
export type PoolPositionsGroup = { assets: PoolAsset[] | undefined; positions: Position[] };

export type PositionsSummary = {
  /** Summed USD value of the open positions that could be priced, or null when none could. */
  valueUsd: number | null;
  /** Open positions left out of `valueUsd` because neither of their currencies has a rate. */
  unpriced: number;
  /** Open positions, and how many of them are subscribed. Closed positions count in neither. */
  open: number;
  subscribed: number;
};

export function summarizePositions(groups: readonly PoolPositionsGroup[], rates: UsdRates | undefined): PositionsSummary {
  let valueUsd: number | null = null;
  let unpriced = 0;
  let open = 0;
  let subscribed = 0;
  for (const { assets, positions } of groups) {
    const [asset0, asset1] = orderPoolAssets(assets);
    for (const position of positions) {
      const status = positionStatus(position);
      if (status === "closed") continue;
      open += 1;
      if (status === "subscribed") subscribed += 1;
      const usd = positionUsdValue(position, asset0, asset1, rates);
      if (usd === null) unpriced += 1;
      else valueUsd = (valueUsd ?? 0) + usd;
    }
  }
  return { valueUsd, unpriced, open, subscribed };
}

export type KnownSum = {
  /** Sum of the known values, or null when every value is unknown. */
  total: number | null;
  /** True when at least one value is unknown, so `total` leaves something out. */
  partial: boolean;
};

/** Sums amounts where null means "could not be read", keeping track of whether any were left out. */
export function sumKnown(values: readonly (number | null | undefined)[]): KnownSum {
  let total: number | null = null;
  let partial = false;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      partial = true;
      continue;
    }
    total = (total ?? 0) + value;
  }
  return { total, partial };
}

/** An amount read from a string or number, or null when it is missing or not a number. */
export function amountOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

const telFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "1,234.57 TEL" */
export function formatTel(amount: number): string {
  return `${telFormat.format(amount)} TEL`;
}

/**
 * Window events that connect parts of the pool page rendered far apart: the Add liquidity tab in the chart card,
 * and the positions list further down.
 */

/** The URL hash that opens the Add liquidity tab, for links from elsewhere on the page or the site. */
export const ADD_LIQUIDITY_HASH = "#add-liquidity";

const OPEN_ADD_LIQUIDITY = "telx:open-add-liquidity";
const POSITION_ADDED = "telx:position-added";

/** Asks the chart card to open its Add liquidity tab and scroll it into view. */
export function openAddLiquidity(): void {
  window.dispatchEvent(new Event(OPEN_ADD_LIQUIDITY));
}

export function onOpenAddLiquidity(listener: () => void): () => void {
  window.addEventListener(OPEN_ADD_LIQUIDITY, listener);
  return () => window.removeEventListener(OPEN_ADD_LIQUIDITY, listener);
}

/** Tells the positions list a new position was confirmed at `blockNumber`. */
export function announcePositionAdded(blockNumber: number): void {
  window.dispatchEvent(new CustomEvent<number>(POSITION_ADDED, { detail: blockNumber }));
}

export function onPositionAdded(listener: (blockNumber: number) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<number>).detail);
  window.addEventListener(POSITION_ADDED, handler);
  return () => window.removeEventListener(POSITION_ADDED, handler);
}

/** Shown where an archived pool's live figures (TVL, volume, fees, charts) would be. */
export const ARCHIVED_POOL_NOTE = "Archived pool, no live data";

/** Help text for the note: why the figures are missing, and that stakes and rewards are still reachable. */
export const ARCHIVED_POOL_HELP =
  "This pool no longer earns TELx rewards, so its live figures are not tracked. Stakes can still be withdrawn and earned rewards claimed.";

/**
 * Whether a pool is archived: inactive in the registry. Archived pools carry no live figures, and their pages
 * show ARCHIVED_POOL_NOTE instead.
 */
export function isArchivedPool(contract: { active?: boolean } | null | undefined): boolean {
  return contract?.active === false;
}

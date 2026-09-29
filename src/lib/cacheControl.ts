/**
 * Cache-Control for a successful response whose body is the same for every visitor: the CDN serves
 * it for 30 seconds and then serves the stale copy for up to 5 minutes while it revalidates.
 * Error responses use `no-store` so a failure is never cached.
 */
export const SHARED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=300";

/**
 * Cache-Control for a shared response in which a read failed (a transient cache error). It is still
 * cached at the edge to keep repeat requests off the function, but only briefly and without serving it
 * stale, so the next successful read shows up within seconds.
 */
export const PARTIAL_CACHE_CONTROL = "public, s-maxage=10";

/**
 * Cache-Control for a shared response that changes every block, such as the position transfer feed:
 * cached at the edge for one block and served stale for up to three more while it revalidates.
 */
export function perBlockCacheControl(blockTimeMs: number): string {
  const block = Math.max(1, Math.round(blockTimeMs / 1000));
  return `public, s-maxage=${block}, stale-while-revalidate=${block * 3}`;
}

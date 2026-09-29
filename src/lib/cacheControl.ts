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
 * The Cache-Control to send with a shared response. On a password-protected preview (PREVIEW_BASIC_AUTH
 * set) the CDN must not cache it, because the cache key ignores the login cookie and a cached copy would
 * reach visitors who never logged in. Production gets `value` unchanged.
 */
export function sharedCacheControl(value: string): string {
  return process.env.PREVIEW_BASIC_AUTH ? "private, no-store" : value;
}

/**
 * Cache-Control for a successful response whose body is the same for every visitor: the CDN serves
 * it for 30 seconds and then serves the stale copy for up to 5 minutes while it revalidates.
 * Error responses use `no-store` so a failure is never cached.
 */
export const SHARED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=300";

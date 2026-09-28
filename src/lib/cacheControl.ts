/**
 * Cache-Control for a successful response whose body is the same for every visitor: the CDN serves
 * it for 30 seconds and then serves the stale copy for up to 5 minutes while it revalidates.
 * Error responses use `no-store` so a failure is never cached.
 */
export const SHARED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=300";

/**
 * Cache-Control for a shared response that is missing part of its data. A group can stay unavailable
 * for hours (a stalled subgraph), so the response is still cached at the edge to keep repeat requests
 * off the function, but only briefly and without serving it stale, so a recovered group shows up within
 * seconds.
 */
export const PARTIAL_CACHE_CONTROL = "public, s-maxage=10";

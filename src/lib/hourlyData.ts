/**
 * How far hourly data reaches, shared by the server that stores and serves it and the pages that describe it.
 */

/** Days the RPC cron keeps each pool's hourly closing rows. */
export const HOURLY_RETENTION_DAYS = 30;

/** A position opened at most this many days ago gets hourly history points, while the hourly rows cover it. */
export const HOURLY_HISTORY_DAYS = 14;

/** Days of hourly rows the Analytics hourly series covers. */
export const HOURLY_ANALYTICS_DAYS = 7;

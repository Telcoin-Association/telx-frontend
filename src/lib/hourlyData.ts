/**
 * How far hourly data reaches, shared by the server that stores and serves it and the pages that describe it.
 */

/**
 * Days the RPC cron keeps each pool's hourly closing rows. Position histories show hourly points for these days
 * and daily points before them.
 */
export const HOURLY_RETENTION_DAYS = 30;

/** Days of hourly rows the Analytics hourly series covers. */
export const HOURLY_ANALYTICS_DAYS = 7;

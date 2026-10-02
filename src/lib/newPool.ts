const NEW_POOL_WINDOW_SECONDS = 7 * 86400;

/** True for a pool created in the last week, which the pool lists mark "New". `createdAt` is in seconds. */
export function isNewPool(createdAt: unknown, nowMs: number = Date.now()): boolean {
  return typeof createdAt === "number" && nowMs / 1000 - createdAt < NEW_POOL_WINDOW_SECONDS;
}

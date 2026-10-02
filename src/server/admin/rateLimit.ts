import "server-only";

/**
 * A fixed-window request limit per key on one server instance. Each instance counts on its own, so this
 * only stops a burst from one client; the Vercel Firewall is the shared limit.
 */
export function createRateLimit({ limit, windowMs, maxKeys = 1_000, now = Date.now }: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    /** True when the request is allowed, and counts it. */
    take(key: string): boolean {
      const at = now();
      let entry = windows.get(key);
      if (!entry || at - entry.start >= windowMs) {
        windows.delete(key);
        entry = { start: at, count: 0 };
        windows.set(key, entry);
        while (windows.size > maxKeys) windows.delete(windows.keys().next().value as string);
      }
      entry.count++;
      return entry.count <= limit;
    },
  };
}

/** The client's address as Vercel forwards it, or a shared key when there is none. */
export function clientKey(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

import type { Context, Next } from "hono";

interface RateLimitOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, options.windowMs).unref();

  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? c.req.header("x-real-ip")
      ?? "unknown";

    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || entry.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }

    entry.count++;

    if (entry.count > options.maxRequests) {
      return c.json(
        { error: "Too many requests, please try again later" },
        429,
      );
    }

    await next();
  };
}

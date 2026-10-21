// Per-client rate limiting behind one small port, so the Worker can use Cloudflare's rate-limit binding (whose
// availability on the Free plan is unconfirmed) or an in-memory window, and seam 2 can drive either deterministically.

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one request for `key` (the client's IP) and says whether it may be served. */
  limit(key: string): Promise<RateLimitResult>;
}

/** The shape of a Workers `ratelimits` binding (`env.RATE_LIMITER`). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Adapts the Workers rate-limit binding. The binding gives no retry time of its own, so the hint is its period: the
 * longest a client can have to wait (`period` is 10 or 60 seconds in wrangler.jsonc).
 */
export function bindingRateLimiter(binding: RateLimitBinding, periodSeconds: 10 | 60): RateLimiter {
  return {
    async limit(key) {
      const { success } = await binding.limit({ key });
      return success ? { allowed: true } : { allowed: false, retryAfterSeconds: periodSeconds };
    },
  };
}

export interface MemoryRateLimitOptions {
  /** Requests allowed per key in one window. */
  limit: number;
  periodSeconds: number;
  /** Clock in milliseconds; injected so tests control time. */
  now?: () => number;
}

/**
 * A fixed window per key, opened by the key's first request. Per isolate only (each Workers isolate counts on its
 * own), so it is a fallback and a test double, not an accurate quota.
 */
export function memoryRateLimiter({ limit, periodSeconds, now = Date.now }: MemoryRateLimitOptions): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  const period = periodSeconds * 1000;
  return {
    async limit(key) {
      const at = now();
      let window = windows.get(key);
      if (!window || at - window.start >= period) {
        // Drop windows that have closed, so the map does not grow with every client ever seen.
        for (const [k, w] of windows) if (at - w.start >= period) windows.delete(k);
        window = { start: at, count: 0 };
        windows.set(key, window);
      }
      window.count++;
      if (window.count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.ceil((window.start + period - at) / 1000) };
    },
  };
}

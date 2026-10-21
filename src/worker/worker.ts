// The deployed Worker, apart from the Cloudflare runtime: the API handler over a dataset, wired to the bindings in
// wrangler.jsonc when they are bound. main.ts builds one at global scope; seam 2 builds them with fake bindings.
import type { Dataset } from "../schema/dataset.ts";
import { createHandler } from "./handler.ts";
import { bindingRateLimiter, memoryRateLimiter, type RateLimitBinding } from "./rate-limit.ts";

/** The bindings wrangler.jsonc declares; each may be missing (see docs/deploy.md, "If the first deploy fails"). */
export interface Env {
  /** wrangler.jsonc `ratelimits`; its `simple` limit and period must equal RATE_LIMIT. */
  RATE_LIMITER?: RateLimitBinding;
}

/**
 * Requests per client (IP) per period. The single source of these numbers: wrangler.jsonc `ratelimits[0].simple`
 * repeats them for the binding, and the in-memory fallback uses them directly.
 */
export const RATE_LIMIT = { limit: 120, periodSeconds: 60 } as const;

export interface Worker {
  fetch(request: Request): Promise<Response>;
}

/**
 * Builds the dataset's indexes once, so no request pays for them (a request has 10 ms of CPU on Free).
 * Clients are limited by the Workers rate-limit binding when it is bound, otherwise by an in-memory window per isolate
 * (each isolate counts on its own, so it is looser, but never absent).
 */
export function createWorker(dataset: Dataset, env: Env): Worker {
  const rateLimiter = env.RATE_LIMITER
    ? bindingRateLimiter(env.RATE_LIMITER, RATE_LIMIT.periodSeconds)
    : memoryRateLimiter(RATE_LIMIT);
  return { fetch: createHandler(dataset, { rateLimiter }) };
}

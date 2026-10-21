// The served API: HTTP request in, response out, over a built dataset (test seam 2).
import type { Dataset } from "../schema/dataset.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { createSearch } from "./search.ts";
import { createViews, notFound, type View } from "./views.ts";

export interface HandlerOptions {
  /** Per-client limit; none means unlimited (tests, local runs). The client is its `CF-Connecting-IP`. */
  rateLimiter?: RateLimiter;
}

/**
 * Cache headers for the CDN. The dataset changes at most once a day and a deploy replaces it, so successful answers
 * are cached an hour at the edge and five minutes by clients; misses briefly; rate-limit answers never, or the CDN
 * would serve one client's 429 to everyone.
 */
const CACHE_OK = "public, max-age=300, s-maxage=3600";
const CACHE_MISS = "public, max-age=60";

type Format = "json" | "md";

export function createHandler(dataset: Dataset, options: HandlerOptions = {}): (request: Request) => Promise<Response> {
  const views = createViews(dataset);
  // One entry per endpoint; captured path segments arrive percent-decoded.
  const routes: [RegExp, (...segments: string[]) => View][] = [
    [/^\/v1\/norms$/, () => views.norms()],
    [/^\/v1\/norms\/([^/]+)$/, (norm) => views.norm(norm)],
    [/^\/v1\/norms\/([^/]+)\/structure$/, (norm) => views.structure(norm)],
    [/^\/v1\/provisions\/([^/]+)\/([^/]+)$/, (norm, id) => views.provision(norm, id)],
    [/^\/v1\/status$/, () => views.status()],
  ];
  // Search reads its query string, so it sits outside the path-only route table.
  const search = createSearch(dataset);

  return async (request) => {
    const url = new URL(request.url);
    const asked = url.searchParams.get("format") ?? "json";
    const format: Format = asked === "md" ? "md" : "json";

    if (options.rateLimiter) {
      const verdict = await options.rateLimiter.limit(request.headers.get("cf-connecting-ip") ?? "unknown");
      if (!verdict.allowed) return rateLimited(verdict.retryAfterSeconds, format);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return respond({ status: 405, json: { error: "method_not_allowed" }, md: () => "Método não permitido / Method not allowed.\n" }, format, {
        allow: "GET, HEAD",
      });
    }
    if (asked !== "json" && asked !== "md") {
      const message = "format must be json or md";
      return respond({ status: 400, json: { error: "bad_request", message }, md: () => `${message}\n` }, "json");
    }

    const view = url.pathname === "/v1/search" ? search(url.searchParams) : route(routes, url.pathname);
    const response = respond(view, format);
    return request.method === "HEAD" ? new Response(null, response) : response;
  };
}

function route(routes: [RegExp, (...segments: string[]) => View][], pathname: string): View {
  for (const [pattern, view] of routes) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    try {
      return view(...match.slice(1).map((segment) => decodeURIComponent(segment)));
    } catch (error) {
      if (error instanceof URIError) break;
      throw error;
    }
  }
  // The path is never echoed: request input does not reach a response body.
  return notFound();
}

function respond(view: View, format: Format, extra: Record<string, string> = {}): Response {
  const headers = {
    "cache-control": view.status === 200 ? CACHE_OK : CACHE_MISS,
    "access-control-allow-origin": "*",
    ...extra,
  };
  if (format === "md") {
    return new Response(view.md(), { status: view.status, headers: { ...headers, "content-type": "text/markdown; charset=utf-8" } });
  }
  return Response.json(view.json, { status: view.status, headers });
}

function rateLimited(retryAfter: number, format: Format): Response {
  const view: View = {
    status: 429,
    json: { error: "rate_limited", retryAfter },
    md: () => `Limite de requisições excedido / Rate limit exceeded: tente de novo em / retry in ${retryAfter} s.\n`,
  };
  return respond(view, format, { "cache-control": "no-store", "retry-after": String(retryAfter) });
}

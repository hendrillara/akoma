// The live adapter of the `Source` port (ADR 0001): plain anonymous GETs from the runner, an honest browser-compatible
// UA with no contact or personal identifier, conditional requests for the pre-filter, one request at a time with a
// pause between them, and a few retries on network errors and 5xx/429. It requests only https URLs on the hosts in
// `ALLOWED_HOSTS`, and follows a redirect only to such a URL (at most three); anything else fails the request. Never called from tests (seam 1 replays
// recorded captures); the daily job and its dry run use it.
//
// It serves pages exactly as fetched: the daily job wraps it in `redacting` (redact.ts), which removes the page
// metadata that could name a person (LEGIN's author fields) before anything reads or keeps the bytes.
import { readFileSync } from "node:fs";
import type { Encoding, Probe, RawSnapshot, Source, Validators } from "./source.ts";

export interface HttpSourceOptions {
  /** Pause between two requests, in milliseconds. Default 2 s. */
  intervalMs?: number;
  /** Per attempt, in milliseconds. Default 60 s (Planalto's compiled CF page is 1.5 MB). */
  timeoutMs?: number;
  /** Retries after a network error, a 5xx or a 429. Default 2. */
  retries?: number;
  /** Replaces the network (never used by the tests; there for a manual check). */
  fetch?: typeof fetch;
  /** One line per request (the workflow log). */
  log?: (line: string) => void;
}

/** The only hosts the job ever requests (the manifests' sources and the acts' Planalto pages), over https only. */
export const ALLOWED_HOSTS = new Set(["www.planalto.gov.br", "normas.leg.br", "www2.camara.leg.br"]);
/** Redirects followed per request, each to an allowed host over https; any other redirect fails the request. */
const MAX_REDIRECTS = 3;

/** Why `url` may not be requested, or `undefined` when it may. */
function refused(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a URL";
  }
  if (parsed.protocol !== "https:") return "not https";
  if (!ALLOWED_HOSTS.has(parsed.hostname) || parsed.port !== "" || parsed.username || parsed.password) return `host ${parsed.hostname} is not allowed`;
  return undefined;
}

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
/** ADR 0001: honest and browser-compatible; Planalto resets non-browser user agents. */
export const USER_AGENT = `Mozilla/5.0 (compatible; akoma/${version})`;

type Fetched = { status: "ok"; snapshot: RawSnapshot } | { status: "not-modified" } | { status: "failed"; error: string };

export function httpSource({ intervalMs = 2_000, timeoutMs = 60_000, retries = 2, fetch: fetchImpl = fetch, log = () => {} }: HttpSourceOptions = {}): Source {
  const served = new Map<string, RawSnapshot>();
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;

  /** One request at a time, `intervalMs` apart: `build()` asks for several pages at once. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        last = Date.now();
      }
    });
    queue = next.catch(() => {});
    return next;
  };

  /** One GET, following at most MAX_REDIRECTS redirects, each to an allowed host over https. */
  const follow = async (url: string, conditional: Record<string, string>): Promise<Response> => {
    let at = url;
    for (let hop = 0; ; hop++) {
      const why = refused(at);
      if (why) throw new Refused(`refused ${at}: ${why}`);
      const response = await fetchImpl(at, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...conditional },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (location === null) return response;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Refused(`too many redirects from ${url}`);
      at = new URL(location, at).href;
    }
  };

  const request = (url: string, conditional: Record<string, string>): Promise<Fetched> =>
    serial(async () => {
      let error = "";
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt) await sleep(5_000 * 3 ** (attempt - 1));
        const started = Date.now();
        try {
          const response = await follow(url, conditional);
          const body = new Uint8Array(await response.arrayBuffer());
          log(`GET ${url} → ${response.status} (${body.byteLength} B, ${Date.now() - started} ms)`);
          if (response.status === 304) return { status: "not-modified" };
          if (response.ok) return { status: "ok", snapshot: snapshot(url, response, body) };
          error = `HTTP ${response.status}`;
          if (response.status !== 429 && response.status < 500) break;
        } catch (e) {
          const cause = (e as { cause?: { code?: string; message?: string } }).cause;
          error = `${(e as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ""}`;
          if (e instanceof Refused) break;
          log(`GET ${url} → ${error} (${Date.now() - started} ms)`);
        }
      }
      return { status: "failed", error };
    });

  return {
    async get(url) {
      const cached = served.get(url);
      if (cached) return cached;
      const result = await request(url, {});
      if (result.status !== "ok") return undefined;
      served.set(url, result.snapshot);
      return result.snapshot;
    },
    async probe(url: string, validators: Validators): Promise<Probe> {
      const conditional: Record<string, string> = {
        ...(validators.etag && { "if-none-match": validators.etag }),
        ...(validators.lastModified && { "if-modified-since": validators.lastModified }),
      };
      const result = await request(url, conditional);
      if (result.status === "failed") return { status: "unavailable", error: result.error };
      if (result.status === "not-modified") return { status: "not-modified" };
      served.set(url, result.snapshot);
      return { status: "modified", snapshot: result.snapshot };
    },
  };
}

function snapshot(url: string, response: Response, body: Uint8Array): RawSnapshot {
  const headers: Record<string, string> = {};
  for (const name of ["etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const type = response.headers.get("content-type") ?? "";
  const encoding = encodingOf(type, body);
  const date = response.headers.get("date");
  const retrievedAt = (date && !Number.isNaN(Date.parse(date)) ? new Date(date) : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const contentType = type.split(";")[0]!.trim().toLowerCase();
  return { url, body, headers, encoding, retrievedAt, ...(contentType && { contentType }) };
}

/** The declared charset; else a `<meta>` charset; else windows-1252, what Planalto serves without declaring it. */
function encodingOf(contentType: string, body: Uint8Array): Encoding {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? (/json/i.test(contentType) ? "utf-8" : undefined);
  const head = Buffer.from(body.subarray(0, 4096)).toString("latin1");
  const meta = declared ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  return meta && /^utf-?8$/i.test(meta) ? "utf-8" : "windows-1252";
}

/** A request the adapter will not make (a host or scheme outside the allowlist, a redirect there): never retried. */
class Refused extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

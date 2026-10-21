// The port every source of raw pages implements: live HTTP (ADR 0001) or recorded fixtures.

export type Encoding = "windows-1252" | "utf-8";

export interface RawSnapshot {
  url: string;
  /** Exact bytes as served; decoding is the parser's job. */
  body: Uint8Array;
  /** Lower-cased response headers that matter for change detection (etag, last-modified). */
  headers: Record<string, string>;
  encoding: Encoding;
  /** When the response was retrieved: an ISO 8601 instant, or a date when only the capture day is known. */
  retrievedAt: string;
  /** The response's media type, lower-cased without parameters, when it was served live (recorded captures omit it). */
  contentType?: string;
}

/** What the previous fetch of a page returned, for a conditional request. */
export interface Validators {
  etag?: string;
  lastModified?: string;
}

/**
 * A conditional check of one page (the daily job's pre-filter): `not-modified` when the validators still hold (HTTP
 * 304), `modified` with the new snapshot, `unavailable` when the page could not be fetched.
 */
export type Probe = { status: "not-modified" } | { status: "modified"; snapshot: RawSnapshot } | { status: "unavailable"; error: string };

export interface Source {
  /** The page as served now; `undefined` when it cannot be fetched (unreachable, an HTTP error, not recorded). */
  get(url: string): Promise<RawSnapshot | undefined>;
  /** A conditional request with the validators of the previous fetch; without it, a check is a plain `get`. */
  probe?(url: string, validators: Validators): Promise<Probe>;
}

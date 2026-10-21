// The port every source of raw pages implements: live HTTP (ADR 0001) or recorded fixtures.

export type Encoding = "windows-1252" | "utf-8";

export interface RawSnapshot {
  url: string;
  /** Exact bytes as served; decoding is the parser's job. */
  body: Uint8Array;
  /** Lower-cased response headers that matter for change detection (etag, last-modified). */
  headers: Record<string, string>;
  encoding: Encoding;
}

export interface Source {
  get(url: string): Promise<RawSnapshot | undefined>;
}

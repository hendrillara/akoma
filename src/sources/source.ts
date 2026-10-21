// The port every source of raw pages implements: live HTTP, recorded fixtures, or R2.

export interface RawSnapshot {
  url: string;
  /** Exact bytes as served; decoding is the parser's job. */
  body: Uint8Array;
  /** Lower-cased response headers that matter for change detection (etag, last-modified). */
  headers: Record<string, string>;
  encoding: string;
}

export interface Source {
  get(url: string): Promise<RawSnapshot | undefined>;
}

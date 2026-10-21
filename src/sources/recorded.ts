// Replays captured responses from fixture folders, each described by its index.json.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Encoding, RawSnapshot, Source } from "./source.ts";

interface FixtureIndex {
  /** Capture day, used as the retrieval time of files whose exact retrieval instant was not recorded. */
  capturedOn: string;
  snapshots: {
    file: string;
    url: string;
    encoding: Encoding;
    headers: Record<string, string>;
    sha256: string;
    /** Exact retrieval instant (e.g. from the response's Date header), when recorded. */
    retrievedAt?: string;
  }[];
}

/**
 * One source over several captures, e.g. the CF of one day and an amending act fetched the next. When two captures
 * record the same URL, the later folder wins, so a scenario folder can stand in for one page of a base capture.
 */
export async function recordedSource(...folders: URL[]): Promise<Source> {
  const byUrl = new Map<string, RawSnapshot>();
  for (const folder of folders) await load(folder, byUrl);

  return {
    async get(url) {
      return byUrl.get(url);
    },
  };
}

async function load(folder: URL, byUrl: Map<string, RawSnapshot>): Promise<void> {
  const index = JSON.parse(await readFile(new URL("index.json", folder), "utf8")) as FixtureIndex;
  for (const entry of index.snapshots) {
    const body = new Uint8Array(await readFile(new URL(entry.file, folder)));
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`Fixture ${entry.file}: checksum mismatch (expected ${entry.sha256}, got ${sha256})`);
    }
    byUrl.set(entry.url, {
      url: entry.url,
      body,
      headers: entry.headers,
      encoding: entry.encoding,
      retrievedAt: entry.retrievedAt ?? index.capturedOn,
    });
  }
}

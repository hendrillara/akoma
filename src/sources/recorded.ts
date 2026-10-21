// Replays captured responses from a fixture folder described by its index.json.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RawSnapshot, Source } from "./source.ts";

interface FixtureIndex {
  capturedOn: string;
  snapshots: {
    file: string;
    url: string;
    encoding: string;
    headers: Record<string, string>;
    sha256: string;
    bytes: number;
  }[];
}

export async function recordedSource(folder: URL): Promise<Source> {
  const index = JSON.parse(await readFile(new URL("index.json", folder), "utf8")) as FixtureIndex;
  const byUrl = new Map<string, RawSnapshot>();

  for (const entry of index.snapshots) {
    const body = new Uint8Array(await readFile(new URL(entry.file, folder)));
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`Fixture ${entry.file}: checksum mismatch (expected ${entry.sha256}, got ${sha256})`);
    }
    byUrl.set(entry.url, { url: entry.url, body, headers: entry.headers, encoding: entry.encoding });
  }

  return {
    async get(url) {
      return byUrl.get(url);
    },
  };
}

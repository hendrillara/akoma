// Seam 1: the build pipeline, end to end (raw snapshots + manifests in, dataset out).
import { describe, expect, it } from "vitest";
import { build } from "../src/pipeline/build.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);

describe("build", () => {
  it("yields an empty dataset when no norm manifests are registered", async () => {
    const dataset = await build({ manifests: [], source: await recordedSource(fixtures) });

    expect(dataset.norms).toEqual([]);
  });
});

// Guards seam 1's inputs: a fixture re-encoded by an editor or git must fail, not feed the build.
describe("recorded fixtures", () => {
  it("refuse to load when a file's bytes no longer match its recorded checksum", async () => {
    const tampered = new URL("./fixtures/tampered/", import.meta.url);

    await expect(recordedSource(tampered)).rejects.toThrow(/checksum/);
  });
});

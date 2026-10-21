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

describe("recorded source", () => {
  it("replays the captured Planalto CF page byte for byte, with its headers", async () => {
    const source = await recordedSource(fixtures);

    const snapshot = await source.get(
      "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm",
    );

    expect(snapshot?.body.byteLength).toBe(1507134);
    expect(snapshot?.headers.etag).toBe('"16f927-65e33e3582f2c"');
  });

  it("returns nothing for a URL that was never captured", async () => {
    const source = await recordedSource(fixtures);

    expect(await source.get("https://www.planalto.gov.br/nao-existe.htm")).toBeUndefined();
  });

  it("rejects a fixture whose bytes no longer match its recorded checksum", async () => {
    const tampered = new URL("./fixtures/tampered/", import.meta.url);

    await expect(recordedSource(tampered)).rejects.toThrow(/checksum/);
  });
});

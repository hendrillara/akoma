// Seam 1: change detection between two builds over recorded fixtures, and the change report a refresh PR carries.
// Both datasets always come out of build(); the scenario pages are documented edits of the recorded compiled CF page
// (test/fixtures/refresh/README.md), so every expected value below is read from the base fixture or from those edits.
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges, renderChangeReport, type ChangeReport } from "../src/pipeline/changes.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const page = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm";
const recorded = new URL("../fixtures/2026-10-20/", import.meta.url);
// The amending acts the CF/ADCT manifests read for deferred vigência (EC 132; EC 141 is in the 2026-10-20 capture).
const acts = new URL("../fixtures/2026-10-21/", import.meta.url);
const scenario = (name: string) => new URL(`./fixtures/refresh/${name}/`, import.meta.url);

/** A build from the recorded captures, with a scenario folder's page standing in for the recorded one. */
async function buildFrom(folder: URL, datasetVersion: string): Promise<Dataset> {
  return build({ manifests: [cf, adct], source: await recordedSource(recorded, acts, folder), datasetVersion });
}

async function indexedSha256(folder: URL, url: string): Promise<string> {
  const index = JSON.parse(await readFile(new URL("index.json", folder), "utf8"));
  return index.snapshots.find((s: { url: string }) => s.url === url).sha256;
}

let previous: Dataset;

beforeAll(async () => {
  previous = await buildFrom(recorded, "2026.10.21-test");
});

describe("change detection: an ETag and Last-Modified change with identical content", () => {
  let next: Dataset;
  let report: ChangeReport;

  beforeAll(async () => {
    // Same page bytes except the token the F5 WAF injects into every response; new headers, new retrieval time.
    next = await buildFrom(scenario("etag-only"), "2026.10.22-test");
    report = detectChanges(previous, next);
  });

  it("served different bytes under different headers", async () => {
    expect(await indexedSha256(scenario("etag-only"), page)).not.toBe(await indexedSha256(recorded, page));
    expect(next.provisions[0]?.provenance).toMatchObject({ retrievedAt: "2026-10-22T01:30:00Z", datasetVersion: "2026.10.22-test" });
  });

  it("yields no change", () => {
    expect(report.changes).toEqual([]);
  });

  it("records the page's moved headers and its unchanged content once the injected script is set aside", () => {
    expect(report.pages).toEqual([{ url: page, etag: "changed", lastModified: "changed", content: "same" }]);
  });

  it("renders a report saying nothing changed", () => {
    expect(renderChangeReport(report)).toBe(
      [
        "## Change report",
        "",
        "No dispositivo changed.",
        "",
        "| Page | ETag | Last-Modified | Content (without scripts) |",
        "| --- | --- | --- | --- |",
        `| ${page} | changed | changed | same |`,
        "",
      ].join("\n"),
    );
  });
});

describe("change detection: a simulated EC 142 that changes, inserts and revokes dispositivos", () => {
  let report: ChangeReport;
  const ec142 = (art: number) => ({
    citation: "Emenda Constitucional nº 142, de 2026",
    type: "emenda_constitucional",
    number: "142",
    year: 2026,
    href: `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc142.htm#art${art}`,
  });

  beforeAll(async () => {
    report = detectChanges(previous, await buildFrom(scenario("ec142"), "2026.10.23-test"));
  });

  it("lists every edited dispositivo, in page order, with what changed and the act behind it", () => {
    expect(
      report.changes.map((c) => ({ kind: c.kind, norm: c.norm, id: c.id, fields: c.fields, acts: c.amendments.map((a) => a.annotation) })),
    ).toEqual([
      {
        kind: "changed",
        norm: "cf",
        id: "art6_cpt",
        fields: ["text", "amendments"],
        acts: ["Redação dada pela Emenda Constitucional nº 142, de 2026"],
      },
      // Renumbered: LexML gives the parágrafo único and § 1º the same id, so only the label, path and annotations move.
      {
        kind: "changed",
        norm: "cf",
        id: "art6_par1",
        fields: ["label", "path", "amendments"],
        acts: ["Renumerado do parágrafo único, pela Emenda Constitucional nº 142, de 2026"],
      },
      { kind: "added", norm: "cf", id: "art6_par2", fields: [], acts: ["Incluído pela Emenda Constitucional nº 142, de 2026"] },
      {
        kind: "revoked",
        norm: "cf",
        id: "art7_cpt_inc14",
        fields: ["text", "status", "amendments"],
        acts: ["Redação dada pela Emenda Constitucional nº 142, de 2026"],
      },
      // Same wording, one new "Vide" note: invisible to the text-only contentHash, visible here.
      { kind: "changed", norm: "cf", id: "art7_cpt_inc18", fields: ["references"], acts: [] },
      {
        kind: "revoked",
        norm: "cf",
        id: "art7_cpt_inc27",
        fields: ["text", "status", "amendments"],
        acts: ["Revogado pela Emenda Constitucional nº 142, de 2026"],
      },
    ]);
  });

  it("attributes each change to the amending act and the EC article the page links to", () => {
    const acts = Object.fromEntries(report.changes.map((c) => [c.id, c.amendments]));
    expect(acts["art6_cpt"]).toEqual([
      { effect: "wording", annotation: "Redação dada pela Emenda Constitucional nº 142, de 2026", act: ec142(1) },
    ]);
    expect(acts["art6_par1"]).toEqual([
      { effect: "renumbered", annotation: "Renumerado do parágrafo único, pela Emenda Constitucional nº 142, de 2026", act: ec142(1) },
    ]);
    expect(acts["art6_par2"]).toEqual([
      { effect: "inserted", annotation: "Incluído pela Emenda Constitucional nº 142, de 2026", act: ec142(1) },
    ]);
    expect(acts["art7_cpt_inc14"]).toEqual([
      { effect: "wording", annotation: "Redação dada pela Emenda Constitucional nº 142, de 2026", act: ec142(2) },
    ]);
    expect(acts["art7_cpt_inc27"]).toEqual([
      { effect: "revoked", annotation: "Revogado pela Emenda Constitucional nº 142, de 2026", act: ec142(3) },
    ]);
  });

  it("keeps the records before and after each change", () => {
    const art7inc27 = report.changes.find((c) => c.id === "art7_cpt_inc27")!;
    expect(art7inc27.before).toMatchObject({ text: "proteção em face da automação, na forma da lei;", status: "in_force" });
    expect(art7inc27.after).toMatchObject({ text: "", status: "revoked", label: "inciso XXVII" });
    const art6par2 = report.changes.find((c) => c.id === "art6_par2")!;
    expect(art6par2.before).toBeUndefined();
  });

  it("sees the page's headers and content change", () => {
    expect(report.pages).toEqual([{ url: page, etag: "changed", lastModified: "changed", content: "changed" }]);
  });

  it("renders as readable Markdown for a PR body", () => {
    const path6 = "Título II › Capítulo II › Art. 6º";
    const path7 = "Título II › Capítulo II › Art. 7º";
    expect(renderChangeReport(report)).toBe(
      [
        "## Change report",
        "",
        "6 dispositivos changed: 1 added, 3 changed, 2 revoked.",
        "",
        "| Page | ETag | Last-Modified | Content (without scripts) |",
        "| --- | --- | --- | --- |",
        `| ${page} | changed | changed | changed |`,
        "",
        "### Added (1)",
        "",
        `- **cf \`art6_par2\`** · ${path6} › § 2º`,
        "  - Act: Incluído pela Emenda Constitucional nº 142, de 2026",
        "  - Text: O cuidado é direito de todos e dever do Estado, da família e da sociedade, na forma da lei.",
        "",
        "### Changed (3)",
        "",
        `- **cf \`art6_cpt\`** · ${path6} › caput`,
        "  - Act: Redação dada pela Emenda Constitucional nº 142, de 2026",
        "  - Text before: São direitos sociais a educação, a saúde, a alimentação, o trabalho, a moradia, o transporte, o lazer, a segurança, a previdência social, a proteção à maternidade e à infância, a assistência aos desamparados, na forma desta Constituição.",
        "  - Text after: São direitos sociais a educação, a saúde, a alimentação, o trabalho, a moradia, o transporte, o lazer, a segurança, a previdência social, a proteção à maternidade e à infância, a assistência aos desamparados e o cuidado, na forma desta Constituição.",
        "  - No longer cited: Redação dada pela Emenda Constitucional nº 90, de 2015",
        `- **cf \`art6_par1\`** · ${path6} › § 1º`,
        "  - Act: Renumerado do parágrafo único, pela Emenda Constitucional nº 142, de 2026",
        "  - Label: parágrafo único → § 1º",
        `- **cf \`art7_cpt_inc18\`** · ${path7} › inciso XVIII`,
        "  - Act: none cited",
        "  - References: + Vide ADI 9999",
        "",
        "### Revoked (2)",
        "",
        `- **cf \`art7_cpt_inc14\`** · ${path7} › inciso XIV`,
        "  - Act: Redação dada pela Emenda Constitucional nº 142, de 2026",
        "  - Text before: jornada de seis horas para o trabalho realizado em turnos ininterruptos de revezamento, salvo negociação coletiva;",
        "  - Text after: (revogado);",
        "  - Status: `in_force` → `revoked`",
        `- **cf \`art7_cpt_inc27\`** · ${path7} › inciso XXVII`,
        "  - Act: Revogado pela Emenda Constitucional nº 142, de 2026",
        "  - Text before: proteção em face da automação, na forma da lei;",
        "  - Text after: *(none)*",
        "  - Status: `in_force` → `revoked`",
        "",
      ].join("\n"),
    );
  });
});

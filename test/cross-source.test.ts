// Seam 1: review layer 2, cross-source agreement. Every dispositivo's primary (Planalto) text is compared with a
// secondary source (normas.leg.br for the CF and ADCT, Câmara LEGIN for the CDC) and the outcome lands in its
// provenance and in the dataset's status. Expected outcomes were worked out by hand from the recorded files (jq over
// the normas.leg.br JSON, the Planalto and LEGIN HTML read directly), never by the code under test.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cdc } from "../src/norms/cdc.ts";
import { cf } from "../src/norms/cf.ts";
import { norms } from "../src/norms/index.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges } from "../src/pipeline/changes.ts";
import { datasetFiles } from "../src/pipeline/files.ts";
import type { CrossSourceFinding, Dataset, Provision } from "../src/schema/dataset.ts";
import { crossSourceFindings } from "../src/review/cross-source.ts";
import { decide } from "../src/review/verdict.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import type { Source } from "../src/sources/source.ts";

const capture = new URL("../fixtures/2026-10-20/", import.meta.url);
const nextDay = new URL("../fixtures/2026-10-21/", import.meta.url);
const ec142 = new URL("./fixtures/refresh/ec142/", import.meta.url);
const source = () => recordedSource(capture, nextDay);
const datasetVersion = "2026.10.21-test";
const normasCf = cf.secondarySources[0]!.url;

function find(dataset: Dataset, id: string, norm = "cf"): Provision | undefined {
  return dataset.provisions.find((p) => p.norm === norm && p.id === id);
}

function findings(dataset: Dataset, norm: string): CrossSourceFinding[] {
  return dataset.status?.crossSource.find((s) => s.norm === norm)?.findings ?? [];
}

const problems = (dataset: Dataset) => dataset.status!.crossSource.flatMap((s) => s.findings).filter((f) => f.severity === "problem");

/**
 * The recorded sources with one file edited (decoded, edited as a string, served as UTF-8): a scenario input derived
 * from the real file by an edit each test spells out. Each `from` must occur exactly once, unless `all` is set.
 */
async function edited(url: string, edits: [from: string, to: string][], all = false): Promise<Source> {
  const recorded = await source();
  const original = (await recorded.get(url))!;
  let text = new TextDecoder(original.encoding).decode(original.body);
  for (const [from, to] of edits) {
    const count = text.split(from).length - 1;
    if (count === 0 || (!all && count !== 1)) throw new Error(`"${from}" occurs ${count} times in ${url}`);
    text = text.replaceAll(from, to);
  }
  const body = new TextEncoder().encode(text);
  return { get: async (u) => (u === url ? { ...original, body, encoding: "utf-8" } : recorded.get(u)) };
}

describe("CF and ADCT against normas.leg.br, from the recorded sources", () => {
  let dataset: Dataset;

  beforeAll(async () => {
    dataset = await build({ manifests: [cf, adct], source: await source(), datasetVersion });
  });

  it("records agreement when normas.leg.br prints the same wording", () => {
    // normas.leg.br art1_cpt_inc4, its only version (Original_Version): "os valores sociais do trabalho e da livre
    // iniciativa;" — the Planalto text, word for word.
    expect(find(dataset, "art1_cpt_inc4")?.provenance.secondary).toEqual({ source: "normas.leg.br", outcome: "agrees" });
  });

  it("matches by printed label, not by normas.leg.br's id, and keeps that id as an alias", () => {
    // normas.leg.br never renumbers: its node "art100_par1" is labelled "§ 5º" since EC 62/2009.
    expect(find(dataset, "art100_par5")?.aliases).toEqual(["art100_par1"]);
    // Its node "art7_par1u" is labelled "§ 1º" since EC 141 renumbered the parágrafo único.
    expect(find(dataset, "art7_par1")?.aliases).toEqual(["art7_par1u"]);
    // An id normas.leg.br shares needs no alias.
    expect(find(dataset, "art1_cpt_inc4")?.aliases).toBeUndefined();
  });

  it("passes a secondary that lacks the amending act the primary cites as stale, with a note", () => {
    // Planalto § 5º: "… apresentados até 1º de fevereiro …" (Redação dada pela Emenda Constitucional nº 136, de 2025).
    // normas.leg.br "art100_par1" ("§ 5º"): versions from EC 30/2000, EC 62/2009 and EC 114/2021 ("até 2 de abril"),
    // none from EC 136.
    expect(find(dataset, "art100_par5")?.provenance.secondary).toEqual({
      source: "normas.leg.br",
      outcome: "secondary-stale",
      note: "The primary cites Emenda Constitucional nº 136, de 2025, which normas.leg.br does not record for this dispositivo or any above it: the secondary is behind.",
    });
    expect(dataset.status?.crossSource.find((s) => s.norm === "cf")?.findings).toContainEqual({
      layer: "cross-source",
      check: "secondary-stale",
      severity: "note",
      norm: "cf",
      id: "art100_par5",
      act: "Emenda Constitucional nº 136, de 2025",
      message: expect.stringContaining("Emenda Constitucional nº 136, de 2025"),
    });
  });

  it("does not take normas.leg.br's early dating of a deferred change (EC 141, art. 7º XV) for a primary error", () => {
    // normas.leg.br "art7_cpt_inc15": Original_Version "repouso semanal remunerado, preferencialmente aos domingos;"
    // (Planalto's text in force), then a Text_Change_Version dated 2026-10-16 by EC 141 with the wording that EC 141
    // art. 10 I defers to 2026-12-17 (the build's pending entry).
    expect(find(dataset, "art7_cpt_inc15")?.provenance.secondary).toEqual({
      source: "normas.leg.br",
      outcome: "agrees",
      note: "normas.leg.br already shows the change by Emenda Constitucional nº 141, de 2026 as current, dated from its publication; it takes effect on 2026-12-17 (see pending). The wording in force matches the secondary's previous version.",
    });
  });

  it("falls back to normas.leg.br's own id for a node with no label in any version", () => {
    // CF art. 42 § 3º, reinserted by EC 101/2019: normas.leg.br's last version has name null, its earlier ones "§ 3º"
    // with another wording; the reinserted text is Planalto's word for word.
    expect(find(dataset, "art42_par3")?.provenance.secondary).toEqual({ source: "normas.leg.br", outcome: "agrees" });
  });
});

describe("every norm from the recorded sources", () => {
  let dataset: Dataset;

  beforeAll(async () => {
    dataset = await build({ manifests: norms, source: await source(), datasetVersion });
  });

  it("finds no unexplained divergence, and every reviewed known divergence still applies", () => {
    expect(problems(dataset)).toEqual([]);
    expect(decide(crossSourceFindings(dataset)).decision).toBe("merge");
    expect(dataset.status!.crossSource.flatMap((s) => s.findings).filter((f) => f.check === "known-divergence-unused")).toEqual([]);
  });

  it("gives every dispositivo its secondary-source outcome, counted per norm in the status", () => {
    for (const p of dataset.provisions) expect(p.provenance.secondary?.outcome, `${p.norm} ${p.id}`).toMatch(/^(agrees|secondary-stale|unconfirmed)$/);
    for (const status of dataset.status!.crossSource) {
      const total = Object.values(status.outcomes).reduce((a, b) => a + b, 0);
      expect(total, status.norm).toBe(dataset.provisions.filter((p) => p.norm === status.norm).length);
    }
    expect(dataset.status!.crossSource.map((s) => [s.norm, s.source?.name])).toEqual([
      ["cf", "normas.leg.br"],
      ["adct", "normas.leg.br"],
      ["cdc", "camara-legin"],
    ]);
  });

  it("passes a reviewed defect of the secondary as agreement, with its reason", () => {
    // normas.leg.br ADCT "art74_par1,emc-12-1996-08-15" (§ 1º) reads "ºA alíquota da contribuição…": the ordinal of
    // its label glued to the text. Planalto: "§ 1º A alíquota da contribuição…".
    expect(find(dataset, "art74_par1", "adct")?.provenance.secondary).toEqual({
      source: "normas.leg.br",
      outcome: "agrees",
      note: "Known divergence, reviewed: normas.leg.br leaves the ordinal mark of the label \"§ 1º\" glued to the start of the text.",
    });
    // LEGIN art. 90 ends "…inquérito civil, naquilo que não contrariar suas disposições. civil, naquilo que não
    // contrariar suas disposições." (ADR 0002: its last phrase printed twice).
    expect(find(dataset, "art90_cpt", "cdc")?.provenance.secondary).toMatchObject({ source: "camara-legin", outcome: "agrees" });
  });

  it("leaves a reviewed difference nobody could settle unconfirmed, with its reason", () => {
    // Planalto art. 18: "…disparidade com a indicações constantes…"; LEGIN: "…com as indicações…" (ADR 0002).
    expect(find(dataset, "art18_cpt", "cdc")?.provenance.secondary).toEqual({
      source: "camara-legin",
      outcome: "unconfirmed",
      note: "Known divergence, reviewed: Agreement: Planalto reads \"com a indicações\", a typo; ADR 0002.",
    });
  });

  it("compares the CDC with LEGIN by label, through Câmara's own annotation style", () => {
    // LEGIN art. 4º IX: "fomento de ações direcionadas à educação financeira e ambiental dos consumidores; (Inciso
    // acrescido pela Lei nº 14.181, de 1º/7/2021)"; Planalto prints the same wording.
    expect(find(dataset, "art4_cpt_inc9", "cdc")?.provenance.secondary).toEqual({ source: "camara-legin", outcome: "agrees" });
    // LEGIN closes art. 115's quote with "(Retificado no DOU de 10/1/2007)" after it; art. 116 is still its own article.
    expect(find(dataset, "art116_cpt", "cdc")?.provenance.secondary).toEqual({ source: "camara-legin", outcome: "agrees" });
    // LEGIN art. 54-C I: "(VETADO na Lei nº 14.181, de 1º/7/2021);", Planalto "(VETADO);".
    expect(find(dataset, "art54-3_cpt_inc1", "cdc")?.provenance.secondary).toEqual({ source: "camara-legin", outcome: "agrees" });
    // LEGIN has no ids of its own, so the CDC gets no aliases.
    expect(dataset.provisions.filter((p) => p.norm === "cdc" && p.aliases)).toEqual([]);
  });

  it("notes the vetoed insertions only LEGIN prints, without blocking", () => {
    // LEGIN: "Art. 11-A. (VETADO na Lei nº 13.425, de 30/3/2017)" and art. 39 "XV - (VETADO na Lei nº 14.368, de
    // 14/6/2022)"; Planalto prints neither.
    expect(findings(dataset, "cdc").filter((f) => f.check === "secondary-only-vetoed").map((f) => f.id)).toEqual(["art11-1_cpt", "art39_cpt_inc15"]);
  });

  it("publishes nothing from normas.leg.br but its ids as aliases, credited in the files that carry them", () => {
    const files = datasetFiles(dataset);
    const published = files.map((f) => f.content).join("\n");
    // Wordings found only in normas.leg.br (each checked absent from the Planalto pages): the ADCT art. 74 § 1º label
    // residue, art. 100 § 11's phrase that Planalto strikes, and ADCT art. 2's caput without its parentheticals.
    for (const only of ["ºA alíquota", "com autoaplicabilidade para a União", "a forma e o sistema de governo que devem vigorar"]) {
      expect(published).not.toContain(only);
    }
    for (const file of files.filter((f) => f.path.endsWith(".json") && f.path.includes("/"))) {
      const json = JSON.parse(file.content) as { norm: { attribution?: string }; provisions: Provision[] };
      const aliases = json.provisions.flatMap((p) => p.aliases ?? []);
      for (const alias of aliases) expect(alias).toMatch(/^art[\w,.-]*$/);
      if (aliases.length) expect(json.norm.attribution, file.path).toMatch(/normas\.leg\.br.*Senado Federal.*CC BY 4\.0/);
    }
    expect(files.find((f) => f.path === "cf/art100.json")!.content).toContain('"art100_par1"');
  });

  it("writes the outcome counts and the notes per norm into the status file", () => {
    const status = JSON.parse(datasetFiles(dataset).find((f) => f.path === "status.json")!.content);
    expect(status.crossSource).toEqual(dataset.status!.crossSource);
    expect(status.crossSource[0]).toMatchObject({
      norm: "cf",
      source: { name: "normas.leg.br", url: normasCf, retrievedAt: "2026-10-20" },
    });
  });

  it("leaves aliases out of change detection: they come from the secondary source", () => {
    const withoutAliases = { ...dataset, provisions: dataset.provisions.map(({ aliases: _, ...p }) => p) };
    expect(detectChanges(withoutAliases, dataset).changes).toEqual([]);
  });
});

describe("scenarios derived from the recorded sources", () => {
  it("passes amendments the secondary has not caught up with as stale (the simulated EC 142)", async () => {
    // test/fixtures/refresh/ec142: art. 6º caput reworded and § 2º inserted by an EC 142 that normas.leg.br, captured
    // on 2026-10-20, cannot know.
    const dataset = await build({ manifests: [cf, adct], source: await recordedSource(capture, nextDay, ec142), datasetVersion });
    expect(find(dataset, "art6_cpt")?.provenance.secondary).toMatchObject({ outcome: "secondary-stale" });
    expect(find(dataset, "art6_par2")?.provenance.secondary).toMatchObject({ outcome: "secondary-stale" });
    // The parágrafo único became § 1º with its wording unchanged: both are par1, and they agree.
    expect(find(dataset, "art6_par1")?.provenance.secondary).toEqual({ source: "normas.leg.br", outcome: "agrees" });
    expect(problems(dataset)).toEqual([]);
  });

  it("blocks a wording the secondary does not share when no amending act explains it", async () => {
    // One word of CF art. 1º IV changed on the Planalto page, with no annotation.
    const page = await edited(cf.primaryUrl, [["IV - os valores sociais do trabalho e da livre iniciativa;", "IV - os valores sociais do trabalho e da iniciativa;"]]);
    const dataset = await build({ manifests: [cf, adct], source: page, datasetVersion });
    expect(find(dataset, "art1_cpt_inc4")?.provenance.secondary).toEqual({
      source: "normas.leg.br",
      outcome: "unconfirmed",
      note: "The wording differs from normas.leg.br and no amending act or reviewed known divergence explains it; held for review.",
    });
    expect(problems(dataset)).toEqual([
      {
        layer: "cross-source",
        check: "divergence",
        severity: "problem",
        norm: "cf",
        id: "art1_cpt_inc4",
        message: "The wording differs from normas.leg.br and no amending act or reviewed known divergence explains it; held for review.",
      },
    ]);
    expect(decide(crossSourceFindings(dataset)).decision).toBe("needs-human");
  });

  it("blocks a dispositivo in force in the secondary that the primary build lacks", async () => {
    // CF art. 1º V dropped from the Planalto page, as a parser slip would drop it.
    const page = await edited(cf.primaryUrl, [["V - o pluralismo político.", ""]]);
    const dataset = await build({ manifests: [cf], source: page, datasetVersion });
    expect(problems(dataset)).toMatchObject([{ check: "missing-in-primary", norm: "cf", id: "art1_cpt_inc5" }]);
  });

  it("marks every dispositivo unconfirmed, never silently, when a norm has no usable secondary source", async () => {
    for (const secondarySources of [[], [{ ...cdc.secondarySources[0]!, verified: { on: "2026-10-21", usable: false, note: "test" } }]]) {
      const dataset = await build({ manifests: [{ ...cdc, secondarySources }], source: await source(), datasetVersion });
      expect(new Set(dataset.provisions.map((p) => JSON.stringify(p.provenance.secondary)))).toEqual(
        new Set([JSON.stringify({ outcome: "unconfirmed", note: "No usable secondary source is declared for this norm." })]),
      );
      expect(dataset.status!.crossSource).toEqual([
        {
          norm: "cdc",
          outcomes: { agrees: 0, "secondary-stale": 0, unconfirmed: 472 },
          findings: [
            {
              layer: "cross-source",
              check: "unconfirmed",
              severity: "note",
              norm: "cdc",
              message: "No usable secondary source is declared for this norm. Every dispositivo is unconfirmed.",
            },
          ],
        },
      ]);
    }
  });

  it("marks every dispositivo unconfirmed when the secondary source is unreachable on a run", async () => {
    // Only the Planalto capture: LEGIN's page is not in this source.
    const dataset = await build({ manifests: [cdc], source: await recordedSource(capture), datasetVersion });
    expect(find(dataset, "art1_cpt", "cdc")?.provenance.secondary).toEqual({
      source: "camara-legin",
      outcome: "unconfirmed",
      note: "The secondary source camara-legin was unavailable on this run.",
    });
    expect(problems(dataset)).toEqual([]);
  });

  describe("fails the build when the undocumented normas.leg.br API changes shape", () => {
    const shapes: [string, [string, string], RegExp][] = [
      ["its licence changes", ['"license":"https://creativecommons.org/licenses/by/4.0/"', '"license":"https://example.invalid/terms"'], /license/],
      ["a version kind is renamed", ['"Text_Change_Version"', '"TextChangeVersion"'], /unknown kind "TextChangeVersion"/],
      ["the versions move to another field", ['"workExample"', '"versions"'], /has no versions/],
      ["the printed labels move to another field", ['"name"', '"label"'], /no label this reader understands/],
      ["the wordings move to another field", ['"text"', '"body"'], /matched dispositivos agree with normas\.leg\.br/],
      ["a node kind is renamed", ["tipo.dispositivo:inciso", "tipo.dispositivo:incisos"], /legislationType/],
    ];
    it.each(shapes)("when %s", async (_, edit, error) => {
      const changed = await edited(normasCf, [edit], true);
      await expect(build({ manifests: [cf], source: changed, datasetVersion })).rejects.toThrow(error);
    });
  });
});

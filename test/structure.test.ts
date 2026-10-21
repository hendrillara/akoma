// Seam 1: the build's structure records (groupings with their names, and articles), for the outline and
// whole-article endpoints. Expected names and annotations are copied by hand from the recorded Planalto pages.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cdc } from "../src/norms/cdc.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);

let dataset: Dataset;

beforeAll(async () => {
  dataset = await build({ manifests: [cf, adct, cdc], source: await recordedSource(fixtures), datasetVersion: "2026.10.21-test" });
});

const grouping = (norm: string, id: string) => dataset.groupings?.find((g) => g.norm === norm && g.id === id);
const article = (norm: string, id: string) => dataset.articles?.find((a) => a.norm === norm && a.id === id);
const countBy = (norm: string) => {
  const counts: Record<string, number> = {};
  for (const g of dataset.groupings ?? []) if (g.norm === norm) counts[g.kind] = (counts[g.kind] ?? 0) + 1;
  return counts;
};

describe("groupings", () => {
  // Reference counts from the research notes (planalto-cf-html.md: equal to normas.leg.br; planalto-cdc-html.md).
  it("records every heading of the CF, none in the ADCT, and every heading of the CDC", () => {
    expect(countBy("cf")).toEqual({ titulo: 9, capitulo: 33, secao: 51, subsecao: 5 });
    expect(countBy("adct")).toEqual({});
    expect(countBy("cdc")).toEqual({ titulo: 6, capitulo: 13, secao: 14 });
  });

  it("gives a título and its capítulo LexML ids, their names verbatim, and the parent link", () => {
    expect(grouping("cf", "tit2")).toEqual({
      norm: "cf",
      id: "tit2",
      kind: "titulo",
      label: "Título II",
      name: "Dos Direitos e Garantias Fundamentais",
      amendments: [],
      references: [],
    });
    expect(grouping("cf", "tit2_cap1")).toMatchObject({
      kind: "capitulo",
      label: "Capítulo I",
      name: "DOS DIREITOS E DEVERES INDIVIDUAIS E COLETIVOS",
      parent: "tit2",
    });
  });

  it("joins a name printed over several blocks and keeps the heading's annotation as metadata", () => {
    const sec = grouping("cf", "tit4_cap3_sec5");
    expect(sec).toMatchObject({
      label: "Seção V",
      name: "Do Tribunal Superior do Trabalho, dos Tribunais Regionais do Trabalho e dos Juízes do Trabalho",
      parent: "tit4_cap3",
    });
    expect(sec?.amendments).toEqual([
      expect.objectContaining({
        effect: "wording",
        annotation: "Redação dada pela Emenda Constitucional nº 92, de 2016",
        act: expect.objectContaining({ type: "emenda_constitucional", number: "92", year: 2016 }),
      }),
    ]);
  });

  it("numbers a lettered seção with a suffix and keeps its name exactly as printed", () => {
    const sec = grouping("cf", "tit6_cap1_sec5-1");
    expect(sec).toMatchObject({
      label: "Seção V-A",
      // Verbatim: the page has no space after the comma.
      name: "Do Imposto de Competência Compartilhada entre Estados,Distrito Federal e Municípios",
    });
    expect(sec?.amendments.map((a) => a.annotation)).toEqual(["Incluído pela Emenda Constitucional nº 132, de 2023"]);
  });

  it("peels the bare 'Regulamento' link off a name into a reference", () => {
    const cap = grouping("cf", "tit7_cap3");
    expect(cap?.name).toBe("DA POLÍTICA AGRÍCOLA E FUNDIÁRIA E DA REFORMA AGRÁRIA");
    expect(cap?.references.map((r) => [r.kind, r.annotation])).toEqual([["regulamento", "Regulamento"]]);
  });

  it("records a subseção under its seção", () => {
    expect(grouping("cf", "tit4_cap1_sec8_sub1")).toMatchObject({
      kind: "subsecao",
      label: "Subseção I",
      name: "Disposição Geral",
      parent: "tit4_cap1_sec8",
    });
  });

  it("keeps the CDC's heading annotations instead of dropping them", () => {
    expect(grouping("cdc", "tit1_cap6-1")).toMatchObject({
      label: "Capítulo VI-A",
      name: "DA PREVENÇÃO E DO TRATAMENTO DO SUPERENDIVIDAMENTO",
      amendments: [expect.objectContaining({ effect: "inserted", annotation: "Incluído pela Lei nº 14.181, de 2021" })],
    });
    expect(grouping("cdc", "tit1_cap7")).toMatchObject({
      name: "Das Sanções Administrativas",
      references: [expect.objectContaining({ kind: "act", annotation: "Vide Lei nº 8.656, de 1993" })],
    });
    expect(grouping("cdc", "tit3_cap5")).toMatchObject({
      name: "DA CONCILIAÇÃO NO SUPERENDIVIDAMENTO",
      amendments: [expect.objectContaining({ annotation: "Incluído pela Lei nº 14.181, de 2021" })],
    });
  });
});

describe("articles", () => {
  it("records each article once, in page order: 276 in the CF, 148 in the ADCT, 130 in the CDC", () => {
    const ids = (norm: string) => (dataset.articles ?? []).filter((a) => a.norm === norm).map((a) => a.id);
    expect(ids("cf")).toHaveLength(276);
    expect(ids("adct")).toHaveLength(148);
    expect(ids("cdc")).toHaveLength(130);
    expect(ids("cf").at(0)).toBe("art1");
    expect(ids("cf").at(-1)).toBe("art250");
    expect(ids("adct").at(-1)).toBe("art138");
  });

  it("links an article to its innermost grouping", () => {
    expect(article("cf", "art5")).toEqual({ norm: "cf", id: "art5", label: "Art. 5º", grouping: "tit2_cap1" });
    expect(article("cf", "art103-1")).toEqual({ norm: "cf", id: "art103-1", label: "Art. 103-A", grouping: "tit4_cap3_sec2" });
    expect(article("cf", "art40")?.grouping).toBe("tit3_cap7_sec2");
    expect(article("cdc", "art54-1")?.grouping).toBe("tit1_cap6-1");
  });

  it("gives an ADCT article no grouping: the ADCT has no headings", () => {
    expect(article("adct", "art1")).toEqual({ norm: "adct", id: "art1", label: "Art. 1º" });
  });
});

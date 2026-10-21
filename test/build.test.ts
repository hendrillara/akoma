// Seam 1: the build pipeline, end to end (raw snapshots + manifests in, dataset out).
// Expected texts are copied by hand from the recorded Planalto pages, never produced by the parser.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { norms } from "../src/norms/index.ts";
import { build } from "../src/pipeline/build.ts";
import { datasetFiles } from "../src/pipeline/files.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
// The EC 132 page the CF/ADCT manifests read for deferred vigência was captured a day later.
const actFixtures = new URL("../fixtures/2026-10-21/", import.meta.url);
const compiledCf = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm";
const datasetVersion = "2026.10.21-test";
// The spec's notice: unofficial text, check the source, vigência not verified against STF decisions.
const STF_NOTICE =
  "Texto não oficial: confira a fonte. A vigência não é verificada contra decisões do STF. / Unofficial text: check the source. Vigência is not verified against STF decisions.";

function provision(dataset: Dataset, id: string, norm = "cf"): Provision | undefined {
  return dataset.provisions.find((p) => p.norm === norm && p.id === id);
}

describe("build", () => {
  it("yields an empty dataset when no norm manifests are registered", async () => {
    const dataset = await build({ manifests: [], source: await recordedSource(fixtures, actFixtures), datasetVersion });

    expect(dataset.norms).toEqual([]);
  });

  it("builds every registered norm from its manifest alone", async () => {
    const dataset = await build({ manifests: norms, source: await recordedSource(fixtures, actFixtures), datasetVersion });

    expect(dataset.norms.map((n) => n.key)).toEqual(["cf", "adct", "cdc"]);
    expect(provision(dataset, "art49_cpt", "cdc")?.text).toMatch(/^O consumidor pode desistir do contrato, no prazo de 7 dias/);
  });

  it("fails loudly when a norm's primary page is not in the source", async () => {
    const missing = { ...cf, primaryUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/nao-existe.htm" };

    await expect(
      build({ manifests: [missing], source: await recordedSource(fixtures, actFixtures), datasetVersion }),
    ).rejects.toThrow(/unavailable/);
  });

  it("fails loudly when a manifest's type or date disagrees with its URN", async () => {
    const typo = { ...cf, date: "1988-10-15" };

    await expect(build({ manifests: [typo], source: await recordedSource(fixtures, actFixtures), datasetVersion })).rejects.toThrow(
      /does not match type constituicao and date 1988-10-15/,
    );
  });

  describe("CF and ADCT from the compiled Planalto page", () => {
    let dataset: Dataset;

    beforeAll(async () => {
      dataset = await build({ manifests: [cf, adct], source: await recordedSource(fixtures, actFixtures), datasetVersion });
    });

    it("reads the ADCT that follows the CF on the same page as a separate norm, numbered from its own art. 1", () => {
      expect(dataset.norms.map((n) => n.key)).toEqual(["cf", "adct"]);
      expect(provision(dataset, "art2_cpt", "adct")).toMatchObject({
        norm: "adct",
        path: [{ kind: "artigo", label: "Art. 2º" }, { kind: "caput", label: "caput" }],
        text: "No dia 7 de setembro de 1993 o eleitorado definirá, através de plebiscito, a forma (república ou monarquia constitucional) e o sistema de governo (parlamentarismo ou presidencialismo) que devem vigorar no País.",
        provenance: { sourceUrl: compiledCf },
      });
      // The CF's own art. 2 is untouched by the ADCT's.
      expect(provision(dataset, "art2_cpt")?.text).toBe(
        "São Poderes da União, independentes e harmônicos entre si, o Legislativo, o Executivo e o Judiciário.",
      );
      // Both have an art. 138; each keeps its own.
      expect(provision(dataset, "art138_cpt", "adct")?.text).toMatch(/^Até 2032, qualquer criação/);
      expect(provision(dataset, "art138_cpt")?.text).toMatch(/^O decreto do estado de sítio indicará/);
    });

    it("gives an inciso its LexML id, path, verbatim text, its annotations as metadata, and provenance", () => {
      expect(provision(dataset, "art1_cpt_inc4")).toEqual({
        id: "art1_cpt_inc4",
        norm: "cf",
        kind: "inciso",
        label: "inciso IV",
        path: [
          { kind: "titulo", label: "Título I" },
          { kind: "artigo", label: "Art. 1º" },
          { kind: "inciso", label: "inciso IV" },
        ],
        text: "os valores sociais do trabalho e da livre iniciativa;",
        status: "in_force",
        amendments: [],
        // "(Vide Lei nº 13.874, de 2019)", linked to "../_Ato2019-2022/2019/Lei/L13874.htm#art1" on the page.
        references: [
          {
            kind: "act",
            annotation: "Vide Lei nº 13.874, de 2019",
            act: {
              citation: "Lei nº 13.874, de 2019",
              type: "lei",
              number: "13.874",
              year: 2019,
              href: "https://www.planalto.gov.br/ccivil_03/_Ato2019-2022/2019/Lei/L13874.htm#art1",
            },
          },
        ],
        provenance: {
          sourceUrl: compiledCf,
          // The Date header of the recorded response.
          retrievedAt: "2026-10-21T01:26:39Z",
          // SHA-256 of the UTF-8 text above, computed with shasum from the hand-copied text.
          contentHash: "sha256:9b297737a232926510d14e28c0bc7fa48fc891bc5a553e8b440902d461a9cab3",
          datasetVersion,
          notice: STF_NOTICE,
        },
      });
    });

    it("hashes each dispositivo's own text, so the hash changes only when its wording does", () => {
      // SHA-256 of the hand-copied text of art. 5º X (see the table above), computed with shasum.
      expect(provision(dataset, "art5_cpt_inc10")?.provenance.contentHash).toBe(
        "sha256:ac4a37222107e533c0f2e9e78ea6de045a0d5d5d8b0cec8a6a3ed1ee9e73e0f0",
      );
    });
  });

  // The full-history page keeps every old wording struck next to the new one; none of it may become text.
  describe("CF from the full-history Planalto page", () => {
    let dataset: Dataset;

    beforeAll(async () => {
      const fullHistory = { ...cf, primaryUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm" };
      dataset = await build({ manifests: [fullHistory], source: await recordedSource(fixtures, actFixtures), datasetVersion });
    });

    it("keeps only the wording in force when old wordings are struck before it", () => {
      // Art. 6 has three struck wordings (1988, EC 26/2000, EC 64/2010) before the one given by EC 90/2015.
      expect(provision(dataset, "art6_cpt")?.text).toBe(
        "São direitos sociais a educação, a saúde, a alimentação, o trabalho, a moradia, o transporte, o lazer, a segurança, a previdência social, a proteção à maternidade e à infância, a assistência aos desamparados, na forma desta Constituição.",
      );
    });

    it("does not attach struck wording to the dispositivo before it", () => {
      expect(provision(dataset, "art5_par4")?.text).toBe(
        "O Brasil se submete à jurisdição de Tribunal Penal Internacional a cuja criação tenha manifestado adesão.",
      );
    });

    it("drops a label whose whole wording is struck instead of minting a second dispositivo", () => {
      // "IX - <strike>tratamento favorecido para as empresas brasileiras de capital nacional…</strike>", then the EC 6/1995 wording.
      const ids = dataset.provisions.map((p) => p.id);
      expect(ids.filter((id) => id === "art170_cpt_inc9")).toHaveLength(1);
      expect(provision(dataset, "art170_cpt_inc9")?.text).toBe(
        "tratamento favorecido para as empresas de pequeno porte constituídas sob as leis brasileiras e que tenham sua sede e administração no País.",
      );
    });

    it("never carries struck-out wording in any dispositivo of arts. 1–6", () => {
      // Fragments found only in art. 6's struck wordings (1988, EC 26/2000, EC 64/2010).
      const struck = ["a saúde, o trabalho, o lazer", "a saúde, o trabalho, a moradia", "a moradia, o lazer"];
      const early = dataset.provisions.filter((p) => /^art[1-6]_/.test(p.id));
      expect(early.length).toBeGreaterThan(100);
      for (const p of early) for (const old of struck) expect(p.text).not.toContain(old);
    });
  });
});

// Parser hygiene through seam 1: a small cp1252 page built from real CDC, CLT and CC excerpts with documented edits
// (test/fixtures/hygiene/README.md), so every markup variant is exercised even where the CF has none.
describe("parser hygiene", () => {
  const hygiene = {
    key: "hygiene",
    urn: "urn:lex:br:federal:lei:1990-09-11;99999",
    type: "lei",
    date: "1990-09-11",
    title: "Hygiene fixture",
    primaryUrl: "https://example.invalid/ccivil_03/leis/hygiene.htm",
    secondarySources: [],
    knownQuirks: [],
  };
  let dataset: Dataset;
  const get = (id: string) => provision(dataset, id, "hygiene");
  const top = [
    { kind: "parte", label: "Parte Geral" },
    { kind: "livro", label: "Livro Primeiro" },
    { kind: "titulo", label: "Título I" },
  ];
  const art4a = [...top, { kind: "capitulo", label: "Capítulo I" }, { kind: "artigo", label: "Art. 4º-A" }];

  beforeAll(async () => {
    const source = await recordedSource(new URL("./fixtures/hygiene/", import.meta.url));
    dataset = await build({ manifests: [hygiene], source, datasetVersion });
  });

  it("yields exactly the dispositivos in force or marked, nothing struck and nothing after the closing formula", () => {
    expect(dataset.provisions.map((p) => p.id)).toEqual([
      "art1_cpt",
      "art2_cpt",
      "art2_par1",
      "art3_cpt",
      "art3_par1",
      "art3_par2",
      "art3_par3",
      "art3_par4",
      "art4-1_cpt",
      "art4-1_cpt_inc1",
      "art4-1_cpt_inc2",
      "art4-1_cpt_inc2_ali1",
      "art4-1_cpt_inc2_ali2",
      "art4-1_cpt_inc2_ali2_ite1",
      "art4-1_cpt_inc2_ali2_ite2",
      "art4-1_cpt_inc3",
      "art4-1_cpt_inc9",
      "art4-1_par1-1",
      "art10-2_cpt",
      "art10-2_cpt_ali1",
      "art10-2_cpt_ali2",
      "art11_cpt",
    ]);
  });

  it("decodes cp1252 bytes and numeric entities (&#146;, &#147;, &#148;, &#150;)", () => {
    expect(get("art1_cpt")?.text).toBe(
      "O presente código estabelece normas de proteção e defesa do consumidor, de ordem pública e interesse social, nos termos dos arts. 5°, inciso XXXII, 170, inciso V, da Constituição Federal e art. 48 de suas Disposições Transitórias.",
    );
    expect(get("art3_par4")?.text).toBe("A lei disporá sobre a d’água e a “defesa” do consumidor.");
    // "I &#150; reconhecimento…" and "II <0x96> ação…": both dashes are separators.
    expect(get("art4-1_cpt_inc1")?.text).toBe("reconhecimento da vulnerabilidade do consumidor no mercado de consumo;");
    expect(get("art4-1_cpt_inc2")?.text).toBe("ação governamental no sentido de proteger efetivamente o consumidor:");
  });

  it("removes <strike>, <s>, <del>, CSS line-through and nested strikes, keeping only the wording in force", () => {
    expect(get("art3_cpt")?.text).toBe(
      "Fornecedor é toda pessoa física ou jurídica, pública ou privada, nacional ou estrangeira, bem como os entes despersonalizados, que desenvolvem atividades de produção.",
    );
    expect(get("art3_par2")?.text).toBe("Serviço é qualquer atividade fornecida no mercado de consumo, mediante remuneração.");
    expect(get("art4-1_cpt")?.text).toBe(
      "A Política Nacional das Relações de Consumo tem por objetivo o atendimento das necessidades dos consumidores:",
    );
    expect(get("art4-1_cpt_inc3")).toMatchObject({
      text: "harmonização dos interesses dos participantes das relações de consumo;",
      amendments: [
        {
          effect: "wording",
          annotation: "Redação dada pela Lei nº 9.999, de 1999",
          act: { type: "lei", number: "9.999", year: 1999, href: "https://example.invalid/ccivil_03/leis/l9999.htm#art1" },
        },
      ],
    });
  });

  it("normalises ordinal variants (º, °, superscript o, \"4.º\") and letter suffixes in labels and ids", () => {
    expect(get("art1_cpt")?.path.at(-2)).toEqual({ kind: "artigo", label: "Art. 1º" });
    expect(get("art2_cpt")?.path.at(-2)).toEqual({ kind: "artigo", label: "Art. 2º" });
    expect(get("art3_par1")?.label).toBe("§ 1º");
    expect(get("art3_par2")?.label).toBe("§ 2º");
    expect(get("art3_par4")?.label).toBe("§ 4º");
    expect(get("art4-1_par1-1")).toMatchObject({ label: "§ 1º-A", text: "Os órgãos públicos são obrigados a fornecer serviços adequados." });
    expect(get("art10-2_cpt")?.path.at(-2)).toEqual({ kind: "artigo", label: "Art. 10-B" });
  });

  it("places Parte and Livro headings, itens under alíneas, and alíneas directly under a caput", () => {
    expect(get("art1_cpt")?.path).toEqual([
      ...top,
      { kind: "capitulo", label: "Capítulo I" },
      { kind: "artigo", label: "Art. 1º" },
      { kind: "caput", label: "caput" },
    ]);
    expect(get("art4-1_cpt_inc2_ali1")).toMatchObject({ label: "alínea a", text: "por iniciativa direta;" });
    expect(get("art4-1_cpt_inc2_ali2_ite1")).toMatchObject({
      kind: "item",
      label: "item 1",
      path: [...art4a, { kind: "inciso", label: "inciso II" }, { kind: "alinea", label: "alínea b" }, { kind: "item", label: "item 1" }],
      text: "de âmbito nacional;",
    });
    expect(get("art10-2_cpt_ali1")).toMatchObject({
      path: [...top, { kind: "capitulo", label: "Capítulo II" }, { kind: "artigo", label: "Art. 10-B" }, { kind: "alinea", label: "alínea a" }],
      text: "ato de improbidade;",
    });
  });

  it("publishes one canonical JSON and one Markdown mirror per article, a Markdown mirror of the whole norm, and the search index", () => {
    const files = datasetFiles(dataset);
    const paths = files.map((f) => f.path);
    expect(paths.filter((p) => p.endsWith(".json"))).toEqual([
      ...["art1", "art2", "art3", "art4-1", "art10-2", "art11"].map((a) => `hygiene/${a}.json`),
      "search-index.json",
    ]);
    expect(JSON.parse(files.find((f) => f.path === "search-index.json")!.content)).toEqual(dataset.search);
    expect(paths.filter((p) => p.endsWith(".md"))).toEqual([
      ...["art1", "art2", "art3", "art4-1", "art10-2", "art11"].map((a) => `hygiene/${a}.md`),
      "hygiene.md",
    ]);

    const json = JSON.parse(files.find((f) => f.path === "hygiene/art10-2.json")!.content);
    expect(json.article).toBe("art10-2");
    expect(json.norm).toEqual({ key: "hygiene", urn: hygiene.urn, title: hygiene.title });
    expect(json.provisions).toEqual(dataset.provisions.filter((p) => p.id.startsWith("art10-2_")));

    expect(files.find((f) => f.path === "hygiene/art10-2.md")!.content).toBe(
      [
        "<!-- Parte Geral › Livro Primeiro › Título I › Capítulo II › Art. 10-B -->",
        "**Art. 10-B** Constituem justa causa para rescisão do contrato de trabalho pelo empregador:",
        "a) ato de improbidade;",
        "b) incontinência de conduta ou mau procedimento;",
      ].join("\n\n") + "\n",
    );
    const mirror = files.find((f) => f.path === "hygiene.md")!.content;
    expect(mirror).toMatch(/^# Hygiene fixture\n\n> Texto não oficial/);
    expect(mirror).toContain(
      [
        "## Parte Geral",
        "### Livro Primeiro",
        "#### Título I",
        "##### Capítulo I",
        "**Art. 1º** O presente código estabelece normas",
      ].join("\n\n"),
    );
    expect(mirror).toContain(
      "III - harmonização dos interesses dos participantes das relações de consumo; *(Redação dada pela Lei nº 9.999, de 1999)*",
    );
    expect(mirror).toContain("##### Capítulo II\n\n**Art. 10-B** Constituem justa causa");
    expect(mirror).toContain("§ 3º (Vetado).\n");
    expect(mirror).toMatch(/\*\*Art\. 11\*\* \(Vetado\)\.\n$/);
  });

  it("keeps vetoed dispositivos with their ids and the page's own marker", () => {
    expect(get("art3_par3")).toMatchObject({ status: "vetoed", text: "(Vetado)." });
    expect(get("art4-1_cpt_inc9")).toMatchObject({ status: "vetoed", text: "(Vetado);" });
    expect(get("art11_cpt")).toMatchObject({ status: "vetoed", text: "(Vetado)." });
    expect(get("art3_cpt")?.status).toBe("in_force");
  });
});

// Quoted text of another act belongs to the dispositivo that quotes it until its closing mark; one that never closes
// would swallow the rest of the norm (test/fixtures/unclosed-quote/README.md).
describe("quoted text", () => {
  it("fails the build when a quotation never closes", async () => {
    const manifest = {
      key: "unclosed",
      urn: "urn:lex:br:federal:lei:1990-09-11;99998",
      type: "lei",
      date: "1990-09-11",
      title: "Unclosed-quote fixture",
      primaryUrl: "https://example.invalid/ccivil_03/leis/unclosed-quote.htm",
      secondarySources: [],
      knownQuirks: [],
    };
    const source = await recordedSource(new URL("./fixtures/unclosed-quote/", import.meta.url));

    await expect(build({ manifests: [manifest], source, datasetVersion })).rejects.toThrow(/Quoted text opened in art110_cpt is never closed/);
  });
});

// Guards seam 1's inputs: a fixture re-encoded by an editor or git must fail, not feed the build.
describe("recorded fixtures", () => {
  it("refuse to load when a file's bytes no longer match its recorded checksum", async () => {
    const tampered = new URL("./fixtures/tampered/", import.meta.url);

    await expect(recordedSource(tampered)).rejects.toThrow(/checksum/);
  });
});

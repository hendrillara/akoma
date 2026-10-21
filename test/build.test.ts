// Seam 1: the build pipeline, end to end (raw snapshots + manifests in, dataset out).
// Expected texts are copied by hand from the recorded Planalto pages, never produced by the parser.
import { beforeAll, describe, expect, it } from "vitest";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
const compiledCf = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm";
const datasetVersion = "2026.10.21-test";

function provision(dataset: Dataset, id: string): Provision | undefined {
  return dataset.provisions.find((p) => p.norm === "cf" && p.id === id);
}

describe("build", () => {
  it("yields an empty dataset when no norm manifests are registered", async () => {
    const dataset = await build({ manifests: [], source: await recordedSource(fixtures), datasetVersion });

    expect(dataset.norms).toEqual([]);
  });

  it("fails loudly when a norm's primary page is not in the source", async () => {
    const missing = { ...cf, primaryUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/nao-existe.htm" };

    await expect(
      build({ manifests: [missing], source: await recordedSource(fixtures), datasetVersion }),
    ).rejects.toThrow(/unavailable/);
  });

  describe("CF from the compiled Planalto page", () => {
    let dataset: Dataset;

    beforeAll(async () => {
      dataset = await build({ manifests: [cf], source: await recordedSource(fixtures), datasetVersion });
    });

    it("gives an inciso its LexML id, path, verbatim text without label or annotations, and provenance", () => {
      expect(provision(dataset, "art1_cpt_inc4")).toEqual({
        id: "art1_cpt_inc4",
        norm: "cf",
        path: [
          { kind: "titulo", label: "Título I" },
          { kind: "artigo", label: "Art. 1º" },
          { kind: "inciso", label: "inciso IV" },
        ],
        text: "os valores sociais do trabalho e da livre iniciativa;",
        provenance: {
          sourceUrl: compiledCf,
          // The Date header of the recorded response.
          retrievedAt: "2026-10-21T01:26:39Z",
          // SHA-256 of the UTF-8 text above, computed with shasum from the hand-copied text.
          contentHash: "sha256:9b297737a232926510d14e28c0bc7fa48fc891bc5a553e8b440902d461a9cab3",
          datasetVersion,
        },
      });
    });

    const titulo1 = { kind: "titulo", label: "Título I" };
    const art1 = { kind: "artigo", label: "Art. 1º" };
    const art5 = [
      { kind: "titulo", label: "Título II" },
      { kind: "capitulo", label: "Capítulo I" },
      { kind: "artigo", label: "Art. 5º" },
    ];
    const caput = { kind: "caput", label: "caput" };
    const inciso = (label: string) => ({ kind: "inciso", label: `inciso ${label}` });
    const paragrafo = (label: string) => ({ kind: "paragrafo", label });

    it.each([
      {
        id: "art1_cpt",
        path: [titulo1, art1, caput],
        text: "A República Federativa do Brasil, formada pela união indissolúvel dos Estados e Municípios e do Distrito Federal, constitui-se em Estado Democrático de Direito e tem como fundamentos:",
      },
      {
        id: "art1_par1",
        path: [titulo1, art1, paragrafo("parágrafo único")],
        text: "Todo o poder emana do povo, que o exerce por meio de representantes eleitos ou diretamente, nos termos desta Constituição.",
      },
      {
        id: "art3_cpt_inc4",
        path: [titulo1, { kind: "artigo", label: "Art. 3º" }, inciso("IV")],
        text: "promover o bem de todos, sem preconceitos de origem, raça, sexo, cor, idade e quaisquer outras formas de discriminação.",
      },
      {
        id: "art5_cpt",
        path: [...art5, caput],
        text: "Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade, nos termos seguintes:",
      },
      {
        id: "art5_cpt_inc10",
        path: [...art5, inciso("X")],
        text: "são invioláveis a intimidade, a vida privada, a honra e a imagem das pessoas, assegurado o direito a indenização pelo dano material ou moral decorrente de sua violação;",
      },
      {
        // Two trailing annotations: "(Vide Lei nº 13.105, de 2015)" and "(Vigência)".
        id: "art5_cpt_inc11",
        path: [...art5, inciso("XI")],
        text: "a casa é asilo inviolável do indivíduo, ninguém nela podendo penetrar sem consentimento do morador, salvo em caso de flagrante delito ou desastre, ou para prestar socorro, ou, durante o dia, por determinação judicial;",
      },
      {
        // Followed by alíneas a) and b), which must not leak into the inciso.
        id: "art5_cpt_inc34",
        path: [...art5, inciso("XXXIV")],
        text: "são a todos assegurados, independentemente do pagamento de taxas:",
      },
      {
        // The label is split across lines in the HTML ("LXXVIII \n- a todos").
        id: "art5_cpt_inc78",
        path: [...art5, inciso("LXXVIII")],
        text: "a todos, no âmbito judicial e administrativo, são assegurados a razoável duração do processo e os meios que garantam a celeridade de sua tramitação.",
      },
      {
        // The text is split across two positioned spans.
        id: "art5_cpt_inc79",
        path: [...art5, inciso("LXXIX")],
        text: "é assegurado, nos termos da lei, o direito à proteção dos dados pessoais, inclusive nos meios digitais.",
      },
      {
        // Three trailing annotations, the last opening its parenthesis outside the link.
        id: "art5_par3",
        path: [...art5, paragrafo("§ 3º")],
        text: "Os tratados e convenções internacionais sobre direitos humanos que forem aprovados, em cada Casa do Congresso Nacional, em dois turnos, por três quintos dos votos dos respectivos membros, serão equivalentes às emendas constitucionais.",
      },
      {
        id: "art5_par4",
        path: [...art5, paragrafo("§ 4º")],
        text: "O Brasil se submete à jurisdição de Tribunal Penal Internacional a cuja criação tenha manifestado adesão.",
      },
    ])("reads $id verbatim from the official text, with its provenance", ({ id, path, text }) => {
      expect(provision(dataset, id)).toMatchObject({
        id,
        norm: "cf",
        path,
        text,
        provenance: { sourceUrl: compiledCf, retrievedAt: "2026-10-21T01:26:39Z", datasetVersion },
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
      dataset = await build({ manifests: [fullHistory], source: await recordedSource(fixtures), datasetVersion });
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

// Guards seam 1's inputs: a fixture re-encoded by an editor or git must fail, not feed the build.
describe("recorded fixtures", () => {
  it("refuse to load when a file's bytes no longer match its recorded checksum", async () => {
    const tampered = new URL("./fixtures/tampered/", import.meta.url);

    await expect(recordedSource(tampered)).rejects.toThrow(/checksum/);
  });
});

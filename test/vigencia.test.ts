// Seam 1: deferred vigência. An amending act whose vigência clause defers some of its changes leaves the wording in
// force on the page and adds a pending wording with its start date; a build on or after that date promotes it.
// Expected texts are copied by hand from the recorded pages (the EC 141 page's art. 1 quoted block and art. 10, the
// compiled CF), and the dates follow ADR 0002, worked out by hand, never by the code under test.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges, renderChangeReport } from "../src/pipeline/changes.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import type { Source } from "../src/sources/source.ts";

const capture = new URL("../fixtures/2026-10-20/", import.meta.url);
const ecCapture = new URL("../fixtures/2026-10-21/", import.meta.url);
const source = () => recordedSource(capture, ecCapture);
const emc141 = "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm";

const ec141 = {
  citation: "Emenda Constitucional nº 141, de 2026",
  type: "emenda_constitucional",
  number: "141",
  year: 2026,
  href: emc141,
};

/**
 * The recorded pages, with one page edited (decoded, edited as a string, served as UTF-8): scenario inputs derived
 * from the real pages by edits each test spells out, instead of committing another 1.5 MB copy.
 */
async function edited(url: string, edit: (html: string) => string): Promise<Source> {
  const recorded = await source();
  const original = (await recorded.get(url))!;
  const html = new TextDecoder(original.encoding).decode(original.body);
  const changed = edit(html);
  if (changed === html) throw new Error(`the edit of ${url} changed nothing`);
  const body = new TextEncoder().encode(changed);
  return { get: async (u) => (u === url ? { ...original, body, encoding: "utf-8" } : recorded.get(u)) };
}

const compiledCf = cf.primaryUrl;

function find(dataset: Dataset, id: string, norm = "cf"): Provision | undefined {
  return dataset.provisions.find((p) => p.norm === norm && p.id === id);
}

describe("deferred vigência: EC 141/2026, art. 7º XV", () => {
  // Compiled CF: "XV - repouso semanal remunerado, preferencialmente aos domingos; (Vide Emenda Constitucional nº 141,
  // de 2026) (Vigência)". EC 141 art. 1: "XV - repouso semanal remunerado de 2 (dois) dias, um dos quais
  // preferencialmente aos domingos; (Vigência)".
  const inForce = "repouso semanal remunerado, preferencialmente aos domingos;";
  const upcoming = "repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;";
  // EC 141 art. 10, I, verbatim.
  const clause =
    "após decorridos 2 (dois) meses de sua publicação, em relação à alteração promovida pelo art. 1º desta Emenda Constitucional no inciso XV do caput do art. 7º da Constituição Federal";
  // Published in the DOU of 16.10.2026; two months counted to the corresponding day (16.12.2026), in force the day
  // after (LC 95/1998 art. 8º § 1º; ADR 0002).
  const effectiveFrom = "2026-12-17";

  describe("before the effective date", () => {
    let dataset: Dataset;

    beforeAll(async () => {
      // No clock given: the build dates itself by the CF page's retrieval day (2026-10-20 in Brasília).
      dataset = await build({ manifests: [cf, adct], source: await source(), datasetVersion: "vigencia" });
    });

    it("keeps the old wording in force and exposes the new one as pending, with its start date and act", () => {
      expect(find(dataset, "art7_cpt_inc15")).toMatchObject({
        text: inForce,
        status: "in_force",
        pending: [{ effect: "wording", text: upcoming, effectiveFrom, vigencia: clause, act: ec141 }],
      });
    });

    it("gives no pending wording to the EC 141 changes already in force at publication", () => {
      for (const id of ["art7_cpt_inc13", "art7_par1", "art7_par2", "art7_par3", "art7_cpt_inc14"]) {
        expect(find(dataset, id)?.pending, id).toBeUndefined();
      }
    });
  });

  it("still keeps it pending on the eve of the effective date", async () => {
    const dataset = await build({ manifests: [cf], source: await source(), datasetVersion: "vigencia", today: "2026-12-16" });

    expect(find(dataset, "art7_cpt_inc15")).toMatchObject({ text: inForce, pending: [{ effectiveFrom }] });
  });

  it("promotes the pending wording to in force from the effective date on", async () => {
    const dataset = await build({ manifests: [cf], source: await source(), datasetVersion: "vigencia", today: effectiveFrom });
    const xv = find(dataset, "art7_cpt_inc15")!;

    expect(xv.text).toBe(upcoming);
    expect(xv.status).toBe("in_force");
    expect(xv.pending).toBeUndefined();
    // The promotion is recorded as the act's wording change, dated: what a change report reads as "pending activated".
    expect(xv.amendments).toEqual([
      { effect: "wording", annotation: "Redação dada pela Emenda Constitucional nº 141, de 2026", act: ec141, effectiveFrom },
    ]);
    // SHA-256 of the hand-copied new wording, computed with shasum: the change signal moves with the text.
    expect(xv.provenance.contentHash).toBe("sha256:9418747eaefb72b609af710e2dd080b85dc4e356be85741f7aa8bf962469cf15");
  });

  it("shows up in the change report as \"pending activated\", with the act behind it", async () => {
    const eve = await build({ manifests: [cf], source: await source(), datasetVersion: "eve", today: "2026-12-16" });
    const day = await build({ manifests: [cf], source: await source(), datasetVersion: "day", today: effectiveFrom });
    const report = detectChanges(eve, day);

    expect(report.changes.map((c) => [c.kind, c.id])).toEqual([["pending-activated", "art7_cpt_inc15"]]);
    expect(renderChangeReport(report)).toContain(
      [
        "### Pending activated (1)",
        "",
        "- **cf `art7_cpt_inc15`** · Título II › Capítulo II › Art. 7º › inciso XV",
        "  - Act: Redação dada pela Emenda Constitucional nº 141, de 2026",
        `  - Text before: ${inForce}`,
        `  - Text after: ${upcoming}`,
        "  - Pending: wording from 2026-12-17 → none",
        "",
      ].join("\n"),
    );
    expect(renderChangeReport(report)).toContain("1 dispositivo changed: 1 pending activated.");
  });
});

// EC 132/2023 (tax reform), DOU 21.12.2023. Art. 23: "I - em 2027, em relação aos arts. 3º e 11; II - em 2033, em
// relação aos arts. 4º e 5º; e III - na data de sua publicação, em relação aos demais dispositivos." Art. 22 revokes
// "I - em 2027, o art. 195, I, "b", e IV, e § 12, da Constituição Federal; II - em 2033: a) os arts. 155, II, e §§ 2º a
// 5º, 156, III, e § 3º, 158, IV, "a", e § 1º, e 161, I, da Constituição Federal; e b) os arts. 80, II, 82, § 2º, e 83
// do Ato das Disposições Constitucionais Transitórias." Planalto marks almost none of the reworded dispositivos, so the
// pending set comes from the act. "em 2027" is read as 1 January 2027 (ADR 0002).
describe("deferred vigência: EC 132/2023, phased to 2027 and 2033", () => {
  const emc132 = "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm";
  const ec132 = { citation: "Emenda Constitucional nº 132, de 2023", type: "emenda_constitucional", number: "132", year: 2023, href: emc132 };
  const y2027 = "2027-01-01";
  const y2033 = "2033-01-01";
  const art23i = "em 2027, em relação aos arts. 3º e 11";
  const art23ii = "em 2033, em relação aos arts. 4º e 5º";

  // Every dispositivo EC 132 changes later, read by hand from its arts. 3, 4, 5 and 22: [norm, id, effect, date].
  // A revoked § or article takes everything under it along.
  const roots: [string, string, string, string][] = [
    // art. 3 (2027)
    ["cf", "art37_par17", "inserted", y2027],
    ["cf", "art37_par18", "inserted", y2027],
    ["cf", "art146_cpt_inc3_ali4", "wording", y2027],
    ["cf", "art153_cpt_inc5", "wording", y2027],
    ["cf", "art156-1_par1_inc9", "wording", y2027],
    ["cf", "art195_par9", "wording", y2027],
    ["cf", "art195_par17", "wording", y2027],
    ["cf", "art195_par19", "wording", y2027],
    ["cf", "art195_par19_inc1", "inserted", y2027],
    ["cf", "art195_par19_inc2", "inserted", y2027],
    ["cf", "art225_par1_inc8", "wording", y2027],
    ["cf", "art239_cpt", "wording", y2027],
    ["cf", "art239_par3", "wording", y2027],
    // art. 4 (2033)
    ["cf", "art146_cpt_inc3_ali4", "wording", y2033],
    ["cf", "art150_par6", "wording", y2033],
    ["cf", "art153_par6_inc4", "wording", y2033],
    ["cf", "art156-1_par1_inc9", "wording", y2033],
    ["cf", "art159_par3", "wording", y2033],
    ["cf", "art195_par17", "wording", y2033],
    ["cf", "art212-1_cpt_inc2_ali3", "wording", y2033],
    ["cf", "art225_par1_inc8", "wording", y2033],
    // art. 5 (2033, ADCT)
    ["adct", "art82_cpt", "wording", y2033],
    ["adct", "art82_par1", "wording", y2033],
    ["adct", "art82_par2", "revoked", y2033],
    ["adct", "art104_cpt_inc4", "wording", y2033],
    // art. 22 I (2027)
    ["cf", "art195_cpt_inc1_ali2", "revoked", y2027],
    ["cf", "art195_cpt_inc4", "revoked", y2027],
    ["cf", "art195_par12", "revoked", y2027],
    // art. 22 II a (2033)
    ["cf", "art155_cpt_inc2", "revoked", y2033],
    ...[2, 3, 4, 5].map((n): [string, string, string, string] => ["cf", `art155_par${n}`, "revoked", y2033]),
    ["cf", "art156_cpt_inc3", "revoked", y2033],
    ["cf", "art156_par3", "revoked", y2033],
    ["cf", "art158_cpt_inc4_ali1", "revoked", y2033],
    ["cf", "art158_par1", "revoked", y2033],
    ["cf", "art161_cpt_inc1", "revoked", y2033],
    // art. 22 II b (2033, ADCT)
    ["adct", "art80_cpt_inc2", "revoked", y2033],
    ["adct", "art83", "revoked", y2033],
  ];
  const under = (id: string, root: string) => id === root || id.startsWith(`${root}_`);
  const of132 = (p: Provision) => (p.pending ?? []).filter((e) => e.act.number === "132");

  let dataset: Dataset;

  beforeAll(async () => {
    dataset = await build({ manifests: [cf, adct], source: await source(), datasetVersion: "vigencia" });
  });

  it("stages exactly the dispositivos the act changes later, revocations reaching everything under them", () => {
    for (const [norm, id, effect, date] of roots) {
      const named = dataset.provisions.filter((p) => p.norm === norm && (effect === "revoked" ? under(p.id, id) : p.id === id));
      expect(named.length, `${norm} ${id}`).toBeGreaterThan(0);
      // A dispositivo the page already shows revoked (art. 155 § 2º VII "a) (revogada);", EC 87/2015) has nothing left to end.
      const reached = named.filter((p) => !(effect === "revoked" && p.status === "revoked"));
      for (const p of reached) {
        expect(of132(p).map((e) => [e.effect, e.effectiveFrom]), `${norm} ${p.id}`).toContainEqual([effect, date]);
      }
    }
    // Nothing else carries an EC 132 pending change.
    for (const p of dataset.provisions) {
      for (const e of of132(p)) {
        const root = roots.find(
          ([norm, id, effect, date]) =>
            norm === p.norm && effect === e.effect && date === e.effectiveFrom && (effect === "revoked" ? under(p.id, id) : p.id === id),
        );
        expect(root, `${p.norm} ${p.id} ${e.effect} ${e.effectiveFrom}`).toBeDefined();
      }
    }
    // Art. 155 § 2º, its 12 incisos and their alíneas: 36 dispositivos, 2 of them already revoked (VII "a" and "b").
    const par2 = dataset.provisions.filter((p) => p.norm === "cf" && under(p.id, "art155_par2"));
    expect(par2).toHaveLength(36);
    expect(par2.filter((p) => of132(p).length === 1).map((p) => p.id)).toHaveLength(34);
  });

  it("includes every dispositivo Planalto itself flags with an EC 132 vigência pointer", () => {
    const flagged = dataset.provisions.filter((p) => p.references.some((r) => r.kind === "vigencia" && /emc132\.htm/i.test(r.href ?? "")));
    expect(flagged).toHaveLength(14);
    for (const p of flagged) expect(of132(p).length, `${p.norm} ${p.id}`).toBeGreaterThan(0);
  });

  it("keeps today's wording of art. 153 V in force, with the 2027 wording pending", () => {
    expect(find(dataset, "art153_cpt_inc5")).toMatchObject({
      text: "operações de crédito, câmbio e seguro, ou relativas a títulos ou valores mobiliários;",
      status: "in_force",
      pending: [
        { effect: "wording", text: "operações de crédito e câmbio ou relativas a títulos ou valores mobiliários;", effectiveFrom: y2027, vigencia: art23i, act: ec132 },
      ],
    });
  });

  it("lists both phases of a dispositivo reworded in 2027 and again in 2033, earliest first", () => {
    expect(find(dataset, "art146_cpt_inc3_ali4")?.pending).toEqual([
      {
        effect: "wording",
        text: "definição de tratamento diferenciado e favorecido para as microempresas e para as empresas de pequeno porte, inclusive regimes especiais ou simplificados no caso dos impostos previstos nos arts. 155, II, e 156-A e das contribuições previstas no art. 195, I e V.",
        effectiveFrom: y2027,
        vigencia: art23i,
        act: ec132,
      },
      {
        effect: "wording",
        text: "definição de tratamento diferenciado e favorecido para as microempresas e para as empresas de pequeno porte, inclusive regimes especiais ou simplificados no caso do imposto previsto no art. 156-A e das contribuições sociais previstas no art. 195, I e V.",
        effectiveFrom: y2033,
        vigencia: art23ii,
        act: ec132,
      },
    ]);
  });

  it("adds a dispositivo inserted in 2027 as not yet in force, in its place in the article", () => {
    const par17 = find(dataset, "art37_par17");
    expect(par17).toMatchObject({
      kind: "paragrafo",
      label: "§ 17",
      path: [
        { kind: "titulo", label: "Título III" },
        { kind: "capitulo", label: "Capítulo VII" },
        { kind: "secao", label: "Seção I" },
        { kind: "artigo", label: "Art. 37" },
        { kind: "paragrafo", label: "§ 17" },
      ],
      text: "",
      status: "not_yet_in_force",
      amendments: [],
      pending: [
        {
          effect: "inserted",
          text: "Lei complementar estabelecerá normas gerais aplicáveis às administrações tributárias da União, dos Estados, do Distrito Federal e dos Municípios, dispondo sobre deveres, direitos e garantias dos servidores das carreiras de que trata o inciso XXII do caput.",
          effectiveFrom: y2027,
          act: ec132,
        },
      ],
      provenance: { sourceUrl: emc132, retrievedAt: "2026-10-21" },
    });
    const ids = dataset.provisions.filter((p) => p.norm === "cf").map((p) => p.id);
    expect(ids.slice(ids.indexOf("art37_par16"), ids.indexOf("art37_par16") + 3)).toEqual(["art37_par16", "art37_par17", "art37_par18"]);
    expect(ids.slice(ids.indexOf("art195_par19"), ids.indexOf("art195_par19") + 3)).toEqual(["art195_par19", "art195_par19_inc1", "art195_par19_inc2"]);
  });

  it("keeps a dispositivo revoked in 2027 in force until then, its revocation pending", () => {
    expect(find(dataset, "art195_cpt_inc1_ali2")).toMatchObject({
      text: "a receita ou o faturamento;",
      status: "in_force",
      pending: [
        {
          effect: "revoked",
          effectiveFrom: y2027,
          vigencia: 'em 2027, o art. 195, I, "b", e IV, e § 12, da Constituição Federal',
          act: ec132,
        },
      ],
    });
    expect(find(dataset, "art195_cpt_inc1_ali2")?.pending?.[0]).not.toHaveProperty("text");
    expect(find(dataset, "art83_cpt", "adct")?.pending).toEqual([
      {
        effect: "revoked",
        effectiveFrom: y2033,
        vigencia: "em 2033: b) os arts. 80, II, 82, § 2º, e 83 do Ato das Disposições Constitucionais Transitórias",
        act: ec132,
      },
    ]);
  });

  it("flags, and never promotes, a wording the page shows reworded since by a later act", async () => {
    // Art. 239 § 3º: EC 132 art. 3 rewrites it for 2027, but EC 135/2024 has reworded it since.
    const flagged = find(dataset, "art239_par3")?.pending;
    expect(flagged).toMatchObject([{ effect: "wording", effectiveFrom: y2027, note: expect.stringContaining("Emenda Constitucional nº 135, de 2024") }]);

    const later = await build({ manifests: [cf], source: await source(), datasetVersion: "vigencia", today: "2027-06-01" });
    expect(find(later, "art239_par3")).toMatchObject({
      text: expect.stringMatching(/^Aos empregados que percebam de empregadores que contribuem para o Programa de Integração Social/),
      pending: [{ effectiveFrom: y2027, note: expect.any(String) }],
    });
  });

  describe("built on 2027-01-01", () => {
    let in2027: Dataset;

    beforeAll(async () => {
      in2027 = await build({ manifests: [cf, adct], source: await source(), datasetVersion: "vigencia", today: y2027 });
    });

    it("promotes the 2027 wordings and leaves the 2033 ones pending", () => {
      expect(find(in2027, "art153_cpt_inc5")).toMatchObject({
        text: "operações de crédito e câmbio ou relativas a títulos ou valores mobiliários;",
        status: "in_force",
      });
      expect(find(in2027, "art153_cpt_inc5")?.pending).toBeUndefined();
      const d = find(in2027, "art146_cpt_inc3_ali4")!;
      expect(d.text).toMatch(/no caso dos impostos previstos nos arts\. 155, II, e 156-A e das contribuições previstas no art\. 195, I e V\.$/);
      expect(d.amendments.at(-1)).toEqual({
        effect: "wording",
        annotation: "Redação dada pela Emenda Constitucional nº 132, de 2023",
        act: ec132,
        effectiveFrom: y2027,
      });
      expect(d.pending).toMatchObject([{ effectiveFrom: y2033 }]);
    });

    it("brings the 2027 insertions into force and revokes what ends in 2027", () => {
      expect(find(in2027, "art37_par18")).toMatchObject({
        status: "in_force",
        text: "Para os fins do disposto no inciso XI do caput deste artigo, os servidores de carreira das administrações tributárias dos Estados, do Distrito Federal e dos Municípios sujeitam-se ao limite aplicável aos servidores da União.",
        amendments: [{ effect: "inserted", annotation: "Incluído pela Emenda Constitucional nº 132, de 2023", effectiveFrom: y2027 }],
      });
      expect(find(in2027, "art195_par12")).toMatchObject({
        status: "revoked",
        text: "",
        amendments: expect.arrayContaining([{ effect: "revoked", annotation: "Revogado pela Emenda Constitucional nº 132, de 2023", act: ec132, effectiveFrom: y2027 }]),
      });
      expect(find(in2027, "art195_par12")?.pending).toBeUndefined();
      // What ends in 2033 is still in force.
      expect(find(in2027, "art155_cpt_inc2")).toMatchObject({ status: "in_force", pending: [{ effect: "revoked", effectiveFrom: y2033 }] });
    });
  });
});

// Planalto updates the compiled page once a deferred change takes effect. The build must then take the page's word
// for it: no pending entry left, no second amendment, and an earlier phase never overwriting a later one.
describe("deferred vigência once the page shows it", () => {
  it("adds nothing when the page already shows the deferred wording (EC 141 applied by Planalto)", async () => {
    // Edit: art. 7º XV's block gets the EC 141 wording and the annotation Planalto prints for an applied change.
    const after = await edited(compiledCf, (html) =>
      html.replace(
        /XV - repouso semanal remunerado, preferencialmente aos domingos;[\s\S]*?\(Vigência\)<\/a><\/font><\/p>/,
        'XV - repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos; <a href="emendas/emc/emc141.htm#art1">(Redação dada pela Emenda Constitucional nº 141, de 2026)</a></font></p>',
      ),
    );
    for (const today of ["2026-12-16", "2026-12-18"]) {
      const dataset = await build({ manifests: [cf], source: after, datasetVersion: "vigencia", today });
      const xv = find(dataset, "art7_cpt_inc15")!;
      expect(xv.text, today).toBe("repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;");
      expect(xv.pending, today).toBeUndefined();
      expect(xv.amendments, today).toEqual([
        {
          effect: "wording",
          annotation: "Redação dada pela Emenda Constitucional nº 141, de 2026",
          act: { ...ec141, href: `${emc141}#art1` },
        },
      ]);
    }
  });

  it("never lets a 2027 wording overwrite the 2033 one the page already shows", async () => {
    // Edit: art. 146 III "d" gets the wording of EC 132 art. 4 (2033), as Planalto will print it from 2033.
    const in2033 =
      "definição de tratamento diferenciado e favorecido para as microempresas e para as empresas de pequeno porte, inclusive regimes especiais ou simplificados no caso do imposto previsto no art. 156-A e das contribuições sociais previstas no art. 195, I e V.";
    const after = await edited(compiledCf, (html) =>
      html.replace(/d\) definição de\s+tratamento diferenciado[\s\S]*?se refere o art\. 239\./, `d) ${in2033}`),
    );
    const dataset = await build({ manifests: [cf], source: after, datasetVersion: "vigencia", today: "2033-02-01" });
    const d = find(dataset, "art146_cpt_inc3_ali4")!;

    expect(d.text).toBe(in2033);
    expect(d.pending).toBeUndefined();
    expect(d.amendments).toEqual([expect.objectContaining({ annotation: "Redação dada pela Emenda Constitucional nº 132, de 2023" })]);
    expect(d.amendments[0]).not.toHaveProperty("effectiveFrom");
  });

  it("stops the build when an act defers a change to a date it does not give", async () => {
    // Edit: EC 141 art. 10 I made conditional on a future law, a start no build can compute.
    const conditional = await edited(emc141, (html) =>
      html.replace(/após\s+decorridos\s+2\s+\(dois\)\s+meses\s+de\s+sua\s+publicação/, "na data de publicação de lei que a regulamente"),
    );

    await expect(build({ manifests: [cf], source: conditional, datasetVersion: "vigencia" })).rejects.toThrow(/no computable date/);
  });
});

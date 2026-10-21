// Seam 1: deferred vigência. An amending act whose vigência clause defers some of its changes leaves the wording in
// force on the page and adds a pending wording with its start date; a build on or after that date promotes it.
// Expected texts are copied by hand from the recorded pages (the EC 141 page's art. 1 quoted block and art. 10, the
// compiled CF), and the dates follow ADR 0002, worked out by hand, never by the code under test.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";

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
});

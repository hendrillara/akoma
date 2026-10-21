// Seam 1: review layer 1, the deterministic gates and target matching, over two builds of recorded fixtures.
// Both datasets come out of build(); the amending acts' pages come from the same recorded source as the new build.
// Expected targets were read by hand from the acts' official text (fixtures/2026-10-20/planalto/emc140.htm and
// emc141.htm; the simulated test/fixtures/refresh/ec142/emc142.htm), and expected changes from the CF annotations.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf, emc } from "../src/norms/cf.ts";
import { norms } from "../src/norms/index.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges, renderChangeReport, type ChangeReport } from "../src/pipeline/changes.ts";
import { reviewGates } from "../src/review/gates.ts";
import { decide, type Verdict } from "../src/review/verdict.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import type { Source } from "../src/sources/source.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const recorded = new URL("../fixtures/2026-10-20/", import.meta.url);
// The second capture (EC 132's page): every CF/ADCT build reads the acts in the manifests' `deferredActs` (ADR 0003).
const acts = new URL("../fixtures/2026-10-21/", import.meta.url);
const scenario = (name: string) => new URL(`./fixtures/refresh/${name}/`, import.meta.url);
const manifests = [cf, adct];

/** The recorded captures, with a scenario folder's files served in place of theirs. */
async function sourceWith(folder?: URL): Promise<Source> {
  return folder ? recordedSource(recorded, acts, folder) : recordedSource(recorded, acts);
}

/** Detects the changes between two builds and runs the gates, with the acts read from the new build's source. */
async function reviewBuilds(previous: Dataset, next: Dataset, source: Source): Promise<{ report: ChangeReport; verdict: Verdict }> {
  const report = detectChanges(previous, next);
  return { report, verdict: decide(await reviewGates({ manifests, previous, next, report, source })) };
}

/** Builds both sides from their scenario folders (none: the recorded captures as they are). */
async function review(previousFolder: URL | undefined, nextFolder: URL | undefined, previousManifests = manifests) {
  const source = await sourceWith(nextFolder);
  const previous = await build({ manifests: previousManifests, source: await sourceWith(previousFolder), datasetVersion: "previous-test" });
  const next = await build({ manifests, source, datasetVersion: "next-test" });
  return reviewBuilds(previous, next, source);
}

describe("review: EC 140 and EC 141 against the CF as it read before them", () => {
  let report: ChangeReport;
  let verdict: Verdict;

  beforeAll(async () => {
    // The CF manifest as it stood before EC 141: its `deferredActs` could not list an act that did not exist yet.
    const cfBefore = { ...cf, deferredActs: cf.deferredActs!.filter((url) => url !== emc(141)) };
    ({ report, verdict } = await review(scenario("before-ec140-141"), undefined, [cfBefore, adct]));
  });

  it("sees exactly the dispositivos the compiled page annotates with EC 140 or EC 141", () => {
    // "(Redação dada|Incluído pela Emenda Constitucional nº 140/141, de 2026)" and art. 7º XV's "(Vide Emenda
    // Constitucional nº 141, de 2026) (Vigência)", in page order.
    expect(report.changes.map((c) => `${c.kind} ${c.id}`)).toEqual([
      "changed art7_cpt_inc13",
      "changed art7_cpt_inc15",
      "changed art7_par1",
      "added art7_par2",
      "added art7_par3",
      "changed art40_par4",
      "added art40_par5-1",
      "added art198_cpt_inc4",
      "added art198_par4-1",
      "added art198_par4-2",
      "changed art198_par10",
      "added art201_par8-1",
    ]);
  });

  it("merges: every change is targeted by an act's commands, and every target changed", () => {
    expect(verdict).toEqual({
      decision: "merge",
      findings: [
        {
          layer: "gates",
          check: "target-matching",
          severity: "note",
          act: "EC 140",
          message:
            "targets 7 dispositivos, all changed: cf art40_par4, cf art40_par5-1, cf art198_cpt_inc4, cf art198_par4-1, cf art198_par4-2, cf art198_par10, cf art201_par8-1",
        },
        {
          layer: "gates",
          check: "target-matching",
          severity: "note",
          act: "EC 141",
          // Art. 1º: XIII and XV quoted, § 1º by "numerado o parágrafo único como § 1º", §§ 2º and 3º quoted. XV takes
          // effect later (art. 10 I); it counts whether its change landed in the text in force or as pending (#6).
          message: "targets 5 dispositivos, all changed: cf art7_cpt_inc13, cf art7_cpt_inc15, cf art7_par1, cf art7_par2, cf art7_par3",
        },
      ],
    });
  });
});

describe("review: the simulated EC 142 against the recorded CF", () => {
  it("merges, noting the one change no act explains: a new \"Vide ADI\" note that leaves the wording as it was", async () => {
    const { verdict } = await review(undefined, scenario("ec142"));
    expect(verdict).toEqual({
      decision: "merge",
      findings: [
        {
          layer: "gates",
          check: "target-matching",
          severity: "note",
          act: "EC 142",
          // Art. 1º: the art. 6º caput quoted, the parágrafo único renumbered, § 2º quoted; art. 2º: art. 7º XIV
          // quoted as "(revogado)"; art. 3º: "Revoga-se o inciso XXVII do caput do art. 7º".
          message:
            "targets 5 dispositivos, all changed: cf art6_cpt, cf art6_par1, cf art6_par2, cf art7_cpt_inc14, cf art7_cpt_inc27",
        },
        {
          layer: "gates",
          check: "target-matching",
          severity: "note",
          norm: "cf",
          id: "art7_cpt_inc18",
          message: "changed only its references (+ Vide ADI 9999); no act targets it",
        },
      ],
    });
  });
});

describe("review: a refetch with new headers and the same content", () => {
  it("merges with nothing to report", async () => {
    expect((await review(undefined, scenario("etag-only"))).verdict).toEqual({ decision: "merge", findings: [] });
  });
});

describe("review: EC 142 with four faults the gates must stop (test/fixtures/refresh/README.md, ec142-faults)", () => {
  let report: ChangeReport;
  let verdict: Verdict;

  beforeAll(async () => {
    ({ report, verdict } = await review(undefined, scenario("ec142-faults")));
  });

  it("needs a human, with one specific reason per fault", () => {
    expect(verdict.decision).toBe("needs-human");
    expect(verdict.findings.filter((f) => f.severity === "problem")).toEqual([
      // F2: art. 7º XXXIV is gone from the page, with no "(revogado)" and no "Revogado pela" annotation.
      {
        layer: "gates",
        check: "removal",
        severity: "problem",
        norm: "cf",
        id: "art7_cpt_inc34",
        message: "vanished from the page without a revocation mark",
      },
      // F3: art. 1º II now precedes I. No record changed, so only the invariant sees it.
      {
        layer: "gates",
        check: "invariants",
        severity: "problem",
        norm: "cf",
        id: "art1_cpt_inc1",
        message: "comes after art1_cpt_inc2: siblings out of order",
      },
      // F4: art. 7º XXVII still reads as before, though EC 142 art. 3 "Revoga-se o inciso XXVII do caput do art. 7º".
      {
        layer: "gates",
        check: "target-matching",
        severity: "problem",
        act: "EC 142",
        norm: "cf",
        id: "art7_cpt_inc27",
        message: "its art. 3 targets it, but it did not change",
      },
      // F1: art. 7º XVI reworded "(Redação dada pela Emenda Constitucional nº 142, de 2026)"; EC 142 never cites it.
      {
        layer: "gates",
        check: "target-matching",
        severity: "problem",
        norm: "cf",
        id: "art7_cpt_inc16",
        message: "changed (text, amendments), citing EC 142, which does not target it",
      },
    ]);
  });

  it("notes only the annotation-only change, so no fault hides behind another", () => {
    expect(verdict.findings.filter((f) => f.severity === "note").map((f) => f.id)).toEqual(["art7_cpt_inc18"]);
  });

  it("puts the verdict and its reasons in the change report, after the summary", () => {
    const markdown = renderChangeReport(report, verdict);
    const verdictSection = markdown.slice(markdown.indexOf("### Verdict"), markdown.indexOf("| Page |"));
    expect(markdown.startsWith("## Change report\n\n7 dispositivos changed: 1 added, 4 changed, 1 revoked, 1 removed without a revocation mark.\n\n### Verdict")).toBe(true);
    expect(verdictSection).toBe(
      [
        "### Verdict: needs-human",
        "",
        "4 problems and 1 note from the deterministic gates. Any problem stops the automatic merge.",
        "",
        "- **Problem** · removal · cf `art7_cpt_inc34`: vanished from the page without a revocation mark",
        "- **Problem** · invariants · cf `art1_cpt_inc1`: comes after art1\\_cpt\\_inc2: siblings out of order",
        "- **Problem** · target-matching · EC 142 cf `art7_cpt_inc27`: its art. 3 targets it, but it did not change",
        "- **Problem** · target-matching · cf `art7_cpt_inc16`: changed (text, amendments), citing EC 142, which does not target it",
        "- Note · target-matching · cf `art7_cpt_inc18`: changed only its references (+ Vide ADI 9999); no act targets it",
        "",
        "",
      ].join("\n"),
    );
  });
});

// EC 141 art. 10 I defers art. 7º XV to 2026-12-17 (ADR 0003). The review must accept both later steps.
describe("review: EC 141's deferred art. 7º XV, from pending to the page", () => {
  // EC 141 is already in the dataset (XIII, § 1º and §§ 2º–3º took effect in October): only today's change is matched.
  const ec141Note = {
    layer: "gates",
    check: "target-matching",
    severity: "note",
    act: "EC 141",
    message: "already in the dataset: each change citing it must be one of its 5 targets; the others may stay as they are",
  };

  it("merges the build on its effective date, which promotes the pending wording", async () => {
    const source = await sourceWith();
    const eve = await build({ manifests, source, datasetVersion: "eve", today: "2026-12-16" });
    const day = await build({ manifests, source, datasetVersion: "day", today: "2026-12-17" });
    const { report, verdict } = await reviewBuilds(eve, day, source);
    expect(report.changes.map((c) => `${c.kind} ${c.id}`)).toEqual(["pending-activated art7_cpt_inc15"]);
    expect(verdict).toEqual({ decision: "merge", findings: [ec141Note] });
  });

  /**
   * Edit, as in test/vigencia.test.ts: art. 7º XV's block gets `wording` and the annotation Planalto prints for an
   * applied change, in place of the old wording and its "(Vide …) (Vigência)" notes.
   */
  async function pageApplying(wording: string): Promise<Source> {
    const source = await sourceWith();
    const original = (await source.get(cf.primaryUrl))!;
    const html = new TextDecoder(original.encoding)
      .decode(original.body)
      .replace(
        /XV - repouso semanal remunerado, preferencialmente aos domingos;[\s\S]*?\(Vigência\)<\/a><\/font><\/p>/,
        `XV - ${wording} <a href="emendas/emc/emc141.htm#art1">(Redação dada pela Emenda Constitucional nº 141, de 2026)</a></font></p>`,
      );
    return {
      get: async (url) =>
        url === cf.primaryUrl ? { ...original, body: new TextEncoder().encode(html), encoding: "utf-8" } : source.get(url),
    };
  }

  it("merges the day Planalto prints the promoted wording itself, a change attributed to the same act", async () => {
    const promoted = await build({ manifests, source: await sourceWith(), datasetVersion: "promoted", today: "2026-12-17" });
    const applied = await pageApplying("repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;");
    const next = await build({ manifests, source: applied, datasetVersion: "applied", today: "2026-12-18" });
    const { report, verdict } = await reviewBuilds(promoted, next, applied);
    expect(report.changes.map((c) => `${c.kind} ${c.id} ${c.fields.join(",")}`)).toEqual(["changed art7_cpt_inc15 amendments,references"]);
    expect(verdict).toEqual({ decision: "merge", findings: [ec141Note] });
  });

  it("needs a human when the page prints the change in a wording other than the act's", async () => {
    // "ao domingo" for EC 141's "aos domingos": the build keeps the act's quote, and nothing in the text shows it.
    const promoted = await build({ manifests, source: await sourceWith(), datasetVersion: "promoted", today: "2026-12-17" });
    const applied = await pageApplying("repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente ao domingo;");
    const next = await build({ manifests, source: applied, datasetVersion: "applied", today: "2026-12-18" });
    const { verdict } = await reviewBuilds(promoted, next, applied);
    expect(verdict).toEqual({
      decision: "needs-human",
      findings: [
        {
          layer: "gates",
          check: "page-divergence",
          severity: "problem",
          norm: "cf",
          id: "art7_cpt_inc15",
          message: "the page now shows the change by Emenda Constitucional nº 141, de 2026, but not in the act's wording, which the build kept",
        },
        ec141Note,
      ],
    });
  });
});

describe("review: EC 132's 2027 phase taking effect (ADR 0003)", () => {
  it("merges: every promoted change is one of EC 132's targets, and its 2033 targets may wait", async () => {
    const source = await sourceWith();
    const eve = await build({ manifests, source, datasetVersion: "eve", today: "2026-12-31" });
    const day = await build({ manifests, source, datasetVersion: "day", today: "2027-01-01" });
    const { report, verdict } = await reviewBuilds(eve, day, source);
    // E.g. art. 37 § 18, inserted by EC 132 art. 3 "em 2027", and art. 195 § 12, revoked by art. 22 I "em 2027, o
    // art. 195, I, "b", e IV, e § 12".
    expect(report.changes.map((c) => c.id)).toEqual(expect.arrayContaining(["art37_par18", "art195_par12"]));
    expect(verdict.decision).toBe("merge");
    expect(verdict.findings.map((f) => `${f.severity} ${f.act}`)).toEqual(["note EC 132"]);
  });
});

describe("review: every registered norm rebuilt from the same captures", () => {
  it.each([undefined, "2027-01-01"])("merges with nothing to report (build date %s)", async (today) => {
    const source = await sourceWith();
    const options = { manifests: norms, source, ...(today && { today }) };
    const previous = await build({ ...options, datasetVersion: "previous" });
    const next = await build({ ...options, datasetVersion: "next" });
    const report = detectChanges(previous, next);
    expect(decide(await reviewGates({ manifests: norms, previous, next, report, source }))).toEqual({ decision: "merge", findings: [] });
  });
});

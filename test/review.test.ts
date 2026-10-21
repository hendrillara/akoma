// Seam 1: review layer 1, the deterministic gates and target matching, over two builds of recorded fixtures.
// Both datasets come out of build(); the amending acts' pages come from the same recorded source as the new build.
// Expected targets were read by hand from the acts' official text (fixtures/2026-10-20/planalto/emc140.htm and
// emc141.htm; the simulated test/fixtures/refresh/ec142/emc142.htm), and expected changes from the CF annotations.
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges, renderChangeReport, type ChangeReport } from "../src/pipeline/changes.ts";
import { reviewGates } from "../src/review/gates.ts";
import { decide, type Verdict } from "../src/review/verdict.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import type { Source } from "../src/sources/source.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const recorded = new URL("../fixtures/2026-10-20/", import.meta.url);
const scenario = (name: string) => new URL(`./fixtures/refresh/${name}/`, import.meta.url);

async function buildFrom(source: Source, datasetVersion: string): Promise<Dataset> {
  return build({ manifests: [cf, adct], source, datasetVersion });
}

/** Builds `previous` and `next`, detects the changes and runs the gates, with the acts read from next's source. */
async function review(previousFolder: URL, nextFolder: URL): Promise<{ report: ChangeReport; verdict: Verdict }> {
  const nextSource = await recordedSource(nextFolder);
  const previous = await buildFrom(await recordedSource(previousFolder), "previous-test");
  const next = await buildFrom(nextSource, "next-test");
  const report = detectChanges(previous, next);
  return { report, verdict: decide(await reviewGates({ previous, next, report, source: nextSource })) };
}

describe("review: EC 140 and EC 141 against the CF as it read before them", () => {
  let report: ChangeReport;
  let verdict: Verdict;

  beforeAll(async () => {
    ({ report, verdict } = await review(scenario("before-ec140-141"), recorded));
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
    const { verdict } = await review(recorded, scenario("ec142"));
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
    expect((await review(recorded, scenario("etag-only"))).verdict).toEqual({ decision: "merge", findings: [] });
  });
});

describe("review: EC 142 with four faults the gates must stop (test/fixtures/refresh/README.md, ec142-faults)", () => {
  let report: ChangeReport;
  let verdict: Verdict;

  beforeAll(async () => {
    ({ report, verdict } = await review(recorded, scenario("ec142-faults")));
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

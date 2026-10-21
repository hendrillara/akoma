// Runs the real LLM reviewer (review layer 3) once on the EC 141 diff, for the record ticket #11 asks for.
// It is NOT part of `pnpm verify`, it calls the paid Claude API, and it runs only when ANTHROPIC_API_KEY is set:
//
//   ANTHROPIC_API_KEY=… [AKOMA_REVIEW_MODEL=claude-opus-5] pnpm review:live
//
// The diff: the CF as it read before EC 140/141 (test/fixtures/refresh/before-ec140-141) → the recorded capture,
// limited to the changes citing EC 141. The correct mapping, read by hand from fixtures/2026-10-20/planalto/emc141.htm:
// art. 1º targets art. 7º XIII and XV (quoted; XV deferred by art. 10 I, so it lands as a pending wording), § 1º
// ("numerado o parágrafo único como § 1º") and §§ 2º and 3º (quoted), with no orphan change and no unapplied command.
// It prints the reviewer's raw answer, the layer's findings and whether the mapping is that one.
import { adct } from "../src/norms/adct.ts";
import { cf, emc } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges } from "../src/pipeline/changes.ts";
import { claudeReviewer, DEFAULT_REVIEW_MODEL } from "../src/review/claude.ts";
import { citedEcs } from "../src/review/gates.ts";
import { reviewLlm, type LlmReviewer, type ReviewerResult } from "../src/review/llm.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set: the live review needs the Claude API key (it is never read from elsewhere).");
  process.exit(1);
}
const model = process.env.AKOMA_REVIEW_MODEL || DEFAULT_REVIEW_MODEL;

const root = new URL("../", import.meta.url);
const recorded = new URL("fixtures/2026-10-20/", root);
const acts = new URL("fixtures/2026-10-21/", root);
const before = new URL("test/fixtures/refresh/before-ec140-141/", root);

// The CF manifest as it stood before EC 141: its `deferredActs` could not list an act that did not exist yet.
const cfBefore = { ...cf, deferredActs: cf.deferredActs!.filter((url) => url !== emc(141)) };
const source = await recordedSource(recorded, acts);
const previous = await build({ manifests: [cfBefore, adct], source: await recordedSource(recorded, acts, before), datasetVersion: "before-ec141" });
const next = await build({ manifests: [cf, adct], source, datasetVersion: "recorded" });
const full = detectChanges(previous, next);
const report = { ...full, changes: full.changes.filter((c) => citedEcs(c).includes("141")) };

let answer: ReviewerResult | undefined;
const real = claudeReviewer({ apiKey, model });
const recording: LlmReviewer = {
  async review(request) {
    answer = await real.review(request);
    return answer;
  },
};
const findings = await reviewLlm({ manifests: [cf, adct], previous, report, source, reviewer: recording });

const expected = ["cf/art7_cpt_inc13", "cf/art7_cpt_inc15", "cf/art7_par1", "cf/art7_par2", "cf/art7_par3"];
const mapped = [...new Set((answer?.output.mappings ?? []).filter((m) => m.act === "EC 141").map((m) => m.change))].sort();
const correct =
  answer !== undefined &&
  JSON.stringify(mapped) === JSON.stringify([...expected].sort()) &&
  answer.output.orphanChanges.length === 0 &&
  answer.output.unappliedCommands.length === 0 &&
  findings.every((f) => f.severity === "note");

console.log(JSON.stringify({ requestedModel: model, changes: report.changes.map((c) => `${c.norm}/${c.id}`), answer, findings, correct }, null, 2));
process.exit(correct ? 0 : 2);

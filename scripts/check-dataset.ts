// `pnpm check:dataset`: fails when dataset/ is not exactly the regeneration of the committed captures, so generated
// data cannot be hand-edited (CI runs it through `pnpm verify`). Fix: `pnpm build:dataset`, and commit the result
// only when a parser, manifest or capture change explains every file it touches.
import { diffPublished, publishedBuild } from "../src/publish/published.ts";

const root = new URL("../", import.meta.url);
const published = await publishedBuild(new URL("fixtures/", root));
const diff = await diffPublished(published.files, new URL("dataset/", root));
const lines = [
  ...diff.changed.map((p) => `  changed: dataset/${p}`),
  ...diff.missing.map((p) => `  missing: dataset/${p}`),
  ...diff.extra.map((p) => `  not generated: dataset/${p}`),
];
if (lines.length) {
  console.error(`check:dataset: dataset/ is not the regeneration of the committed captures (${published.captures.join(", ")}):`);
  console.error(lines.slice(0, 50).join("\n") + (lines.length > 50 ? `\n  … and ${lines.length - 50} more` : ""));
  console.error("Generated data is never edited by hand: run `pnpm build:dataset` and commit only what a parser, manifest or capture change explains.");
  process.exit(1);
}
console.log(`check:dataset: dataset/ matches the regeneration (${published.files.length} files, dataset ${published.datasetVersion})`);

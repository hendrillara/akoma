// `pnpm build:dataset`: regenerates dataset/ from the committed captures (every dated folder under fixtures/, later
// folders winning). Run it after any change to the parser, the manifests or the captures; `pnpm check:dataset` (in
// `pnpm verify`) fails until the committed dataset/ is this regeneration.
import { publishedBuild, writePublished } from "../src/publish/published.ts";

const root = new URL("../", import.meta.url);
const published = await publishedBuild(new URL("fixtures/", root));
await writePublished(published.files, new URL("dataset/", root));
console.log(`build:dataset: dataset ${published.datasetVersion} (today ${published.today}) from ${published.captures.join(", ")}: ${published.files.length} files in dataset/`);

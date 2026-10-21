// `pnpm build:dataset`: regenerates dataset/ from the committed captures (every dated folder under fixtures/, later
// folders winning). Run it after any change to the parser, the manifests or the captures; `pnpm check:dataset` (in
// `pnpm verify`) fails until the committed dataset/ is this regeneration.
import { buildDataset } from "../src/publish/published.ts";

const published = await buildDataset(new URL("../", import.meta.url));
console.log(`build:dataset: dataset ${published.datasetVersion} (today ${published.today}) from ${published.captures.join(", ")}: ${published.files.length} files in dataset/`);

// The Worker wrangler deploys (wrangler.jsonc `main`). Everything here runs at global scope, once per isolate:
// evaluating the bundled dataset and building its indexes (43–47 ms in `wrangler check startup`) is done once, within
// the 1 s startup limit, instead of on a request (10 ms of CPU on the Free plan; whether startup work is billed to the
// first request is not stated by Cloudflare's limits page: docs/deploy.md step 7). "akoma-dataset" is dataset/dataset.json,
// the committed dataset in one file (wrangler.jsonc `alias`), so the API serves exactly the files deployed beside it.
import { env } from "cloudflare:workers";
import dataset from "akoma-dataset";
import { createWorker, type Env } from "./worker.ts";

const worker = createWorker(dataset, env as Env);

export default {
  fetch: (request: Request) => worker.fetch(request),
};

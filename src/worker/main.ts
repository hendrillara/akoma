// The Worker wrangler deploys (wrangler.jsonc `main`). Everything here runs at global scope, once per isolate:
// evaluating the bundled dataset and building its indexes (~20–30 ms in `wrangler check startup`) counts toward the
// 1 s startup limit, not toward a request's 10 ms of CPU on the Free plan. "akoma-dataset" is dataset/dataset.json,
// the committed dataset in one file (wrangler.jsonc `alias`), so the API serves exactly the files deployed beside it.
import { env } from "cloudflare:workers";
import dataset from "akoma-dataset";
import { createWorker, type Env } from "./worker.ts";

const worker = createWorker(dataset, env as Env);

export default {
  fetch: (request: Request) => worker.fetch(request),
};

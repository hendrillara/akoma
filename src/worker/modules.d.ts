// Modules that exist only when wrangler bundles src/worker/main.ts; tests never import them.

declare module "cloudflare:workers" {
  /** The Worker's bindings, readable at global scope (calling them needs a request context). */
  export const env: unknown;
}

/** dataset/dataset.json (wrangler.jsonc `alias`), which esbuild bundles as a module whose default export is it. */
declare module "akoma-dataset" {
  const dataset: import("../schema/dataset.ts").Dataset;
  export default dataset;
}

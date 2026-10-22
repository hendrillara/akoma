// Seam 2: agent discovery. `/llms.txt` and the usage guide it links to, served by the same request handler, and the
// promise that every API example they (and the README) give answers over a dataset built from the recorded fixtures.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { norms } from "../src/norms/index.ts";
import { build } from "../src/pipeline/build.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import { createHandler } from "../src/worker/handler.ts";

const api = "https://akoma.hendril.dev";
const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
const actFixtures = new URL("../fixtures/2026-10-21/", import.meta.url);

let handle: (request: Request) => Promise<Response>;
const get = (path: string, init?: RequestInit) => handle(new Request(`${api}${path}`, init));

beforeAll(async () => {
  const dataset = await build({ manifests: norms, source: await recordedSource(fixtures, actFixtures), datasetVersion: "2026.10.21-test" });
  handle = createHandler(dataset);
});

describe("/ (the root)", () => {
  // The edge cache keys by URL and ignores Vary: Accept, so the two answers below must never be stored there.
  it("sends a browser to the README, which explains the service in Portuguese and English", async () => {
    const response = await get("/", { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/hendrillara/akoma#readme");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("gives any other client the llms.txt index", async () => {
    const response = await get("/", { headers: { accept: "*/*" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(await (await get("/llms.txt")).text());
  });
});

describe("/llms.txt", () => {
  it("is a Markdown index naming the service, the MCP URL and every norm key, cached like the API", async () => {
    const response = await get("/llms.txt");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const text = await response.text();
    // The llms.txt format (llmstxt.org): an H1 with the name, then a blockquote summary.
    expect(text).toMatch(/^# Akoma\n\n> /);
    expect(text).toContain("https://akoma.hendril.dev/mcp");
    for (const key of ["`cf`", "`adct`", "`cdc`"]) expect(text).toContain(key);
    expect(text).toContain("not legal advice");
  });

  it("links the usage guide, served as Markdown", async () => {
    expect(await (await get("/llms.txt")).text()).toContain("(https://akoma.hendril.dev/usage.md)");

    const response = await get("/usage.md");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const text = await response.text();
    expect(text).toMatch(/^# Akoma usage guide\n/);
    for (const tool of ["search", "get_provision", "get_structure", "list_norms"]) expect(text).toContain(`\`${tool}\``);
    expect(text).toContain("Retry-After");
  });

  it("answers HEAD without a body and without storing it at the edge", async () => {
    const response = await get("/llms.txt", { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/** Every concrete `/v1/` path a text gives (templates such as `/v1/provisions/{norm}/{id}` or `q=…` are skipped). */
function apiPaths(text: string): string[] {
  const found = [...text.matchAll(/\/v1\/[^\s`)\]>"'|]*/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
  return [...new Set(found.filter((p) => !p.includes("{") && !p.includes("…")))];
}

// The one example that is meant to miss: a normas.leg.br alias, answered 404 with the canonical id.
const ALIAS_EXAMPLES: Record<string, string> = { "/v1/provisions/cf/art7_par1u": "art7_par1" };

describe.each([
  ["/llms.txt", async () => (await get("/llms.txt")).text()],
  ["/usage.md", async () => (await get("/usage.md")).text()],
  ["README.md", async () => readFileSync(new URL("../README.md", import.meta.url), "utf8")],
])("every API example in %s answers", (_name, read) => {
  it("with 200, or with 404 and the canonical id for the alias example", async () => {
    const paths = apiPaths(await read());
    expect(paths.length).toBeGreaterThan(4);
    for (const path of paths) {
      const response = await get(path);
      const suggestion = ALIAS_EXAMPLES[path];
      if (suggestion) {
        expect(response.status, path).toBe(404);
        expect(await response.json()).toMatchObject({ suggestion: { id: suggestion } });
      } else {
        expect(response.status, path).toBe(200);
      }
    }
  });
});

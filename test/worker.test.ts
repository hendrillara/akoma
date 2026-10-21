// Seam 2: the deployed Worker's entry (request in, response out), wired the way src/worker/main.ts wires it on
// Cloudflare: over a dataset, with the bindings wrangler.jsonc declares, or without them.
import { describe, expect, it } from "vitest";
import type { Dataset } from "../src/schema/dataset.ts";
import { createWorker } from "../src/worker/worker.ts";

const api = "https://akoma.hendril.dev";
const dataset: Dataset = { norms: [{ key: "cf", urn: "urn:lex:br:federal:constituicao:1988-10-05;1988", title: "Constituição" }], provisions: [] };
const from = (ip: string, path = "/v1/norms", method = "GET") =>
  new Request(`${api}${path}`, { method, headers: { "cf-connecting-ip": ip } });

describe("Worker entry", () => {
  it("serves the API over the dataset it is given", async () => {
    const worker = createWorker(dataset, {});

    const response = await worker.fetch(from("203.0.113.1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ norms: [{ key: "cf", title: "Constituição" }] });
  });

  describe("rate limiting", () => {
    it("limits each client through the Workers rate-limit binding when it is bound, keyed by its IP", async () => {
      const keys: string[] = [];
      const allowed = new Set(["203.0.113.1"]);
      const RATE_LIMITER = {
        async limit({ key }: { key: string }) {
          keys.push(key);
          return { success: allowed.has(key) };
        },
      };
      const worker = createWorker(dataset, { RATE_LIMITER });

      // The binding alone decides: far past the in-memory fallback's 120 a minute, an allowed client is still served.
      for (let i = 0; i < 130; i++) expect((await worker.fetch(from("203.0.113.1"))).status).toBe(200);
      const refused = await worker.fetch(from("198.51.100.7"));

      expect(refused.status).toBe(429);
      // The binding's period (60 s, wrangler.jsonc `ratelimits`) is the longest a client can have to wait.
      expect(refused.headers.get("retry-after")).toBe("60");
      expect(keys.at(-1)).toBe("198.51.100.7");
      expect(keys).toHaveLength(131);
    });

    it("falls back to an in-memory window of 120 requests a minute per client when no binding is bound", async () => {
      const worker = createWorker(dataset, {});

      for (let i = 0; i < 120; i++) expect((await worker.fetch(from("203.0.113.1"))).status).toBe(200);
      const limited = await worker.fetch(from("203.0.113.1"));

      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      // Other clients keep their own window.
      expect((await worker.fetch(from("198.51.100.7"))).status).toBe(200);
    });

    // An MCP session spends requests on its handshake that a REST client never makes; neither may starve the other.
    it("gives a client's MCP requests a budget of their own, apart from its REST requests", async () => {
      const worker = createWorker(dataset, {});
      const mcp = (ip: string) =>
        worker.fetch(
          new Request(`${api}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-connecting-ip": ip },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          }),
        );

      for (let i = 0; i < 120; i++) await worker.fetch(from("203.0.113.1"));
      expect((await worker.fetch(from("203.0.113.1"))).status).toBe(429);
      expect((await mcp("203.0.113.1")).status).not.toBe(429);

      for (let i = 0; i < 120; i++) await mcp("198.51.100.7");
      expect((await mcp("198.51.100.7")).status).toBe(429);
      expect((await worker.fetch(from("198.51.100.7"))).status).toBe(200);
    });

    it("counts MCP requests under their own key when the binding is bound", async () => {
      const keys: string[] = [];
      const RATE_LIMITER = {
        async limit({ key }: { key: string }) {
          keys.push(key);
          return { success: true };
        },
      };
      const worker = createWorker(dataset, { RATE_LIMITER });

      await worker.fetch(new Request(`${api}/mcp`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1" }, body: "{}" }));
      await worker.fetch(from("203.0.113.1"));

      expect(keys).toEqual(["mcp:203.0.113.1", "203.0.113.1"]);
    });
  });

  // Workers Cache (wrangler.jsonc `cache`) stores the Worker's answers from their headers alone and serves hits
  // without running the Worker. GET and HEAD share one cache entry, so only answers with the body may be stored.
  describe("edge caching", () => {
    it("lets the edge store a successful GET from its headers alone", async () => {
      const response = await createWorker(dataset, {}).fetch(from("203.0.113.1"));

      expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
      // Either would make the edge bypass or split the cache.
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("vary")).toBeNull();
    });

    it("never lets the edge store an MCP answer, which is per call", async () => {
      const response = await createWorker(dataset, {}).fetch(
        new Request(`${api}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("never lets the edge store a HEAD answer, whose empty body a later GET would get", async () => {
      const response = await createWorker(dataset, {}).fetch(from("203.0.113.1", "/v1/norms", "HEAD"));

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    });
  });
});

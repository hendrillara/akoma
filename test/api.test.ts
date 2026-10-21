// Seam 2: the served API (HTTP request in, response out, over a built dataset).
import { describe, expect, it } from "vitest";
import { createHandler } from "../src/worker/handler.ts";
import type { Dataset } from "../src/schema/dataset.ts";

const empty: Dataset = { norms: [] };

describe("API v1", () => {
  it("lists no norms for an empty dataset", async () => {
    const handle = createHandler(empty);

    const response = await handle(new Request("https://akoma.hendril.dev/v1/norms"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ norms: [] });
  });

  it("answers 404 for an unknown route", async () => {
    const handle = createHandler(empty);

    const response = await handle(new Request("https://akoma.hendril.dev/v1/nope"));

    expect(response.status).toBe(404);
  });
});

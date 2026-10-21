// Seam 2: the served API (HTTP request in, response out, over a built dataset).
import { beforeAll, describe, expect, it } from "vitest";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import { createHandler } from "../src/worker/handler.ts";

const empty: Dataset = { norms: [], provisions: [] };
const api = "https://akoma.hendril.dev";

describe("API v1", () => {
  it("lists no norms for an empty dataset", async () => {
    const handle = createHandler(empty);

    const response = await handle(new Request(`${api}/v1/norms`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ norms: [] });
  });

  it("answers 404 for an unknown route", async () => {
    const handle = createHandler(empty);

    const response = await handle(new Request(`${api}/v1/nope`));

    expect(response.status).toBe(404);
  });

  describe("over the CF built from the recorded fixtures", () => {
    let handle: (request: Request) => Promise<Response>;

    beforeAll(async () => {
      const fixtures = new URL("../fixtures/2026-10-20/", import.meta.url);
      const dataset = await build({ manifests: [cf], source: await recordedSource(fixtures), datasetVersion: "2026.10.21-test" });
      handle = createHandler(dataset);
    });

    it("returns one dispositivo by norm and id as JSON, with its provenance", async () => {
      const response = await handle(new Request(`${api}/v1/provisions/cf/art5_cpt_inc10`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
      expect(await response.json()).toEqual({
        id: "art5_cpt_inc10",
        norm: "cf",
        path: [
          { kind: "titulo", label: "Título II" },
          { kind: "capitulo", label: "Capítulo I" },
          { kind: "artigo", label: "Art. 5º" },
          { kind: "inciso", label: "inciso X" },
        ],
        text: "são invioláveis a intimidade, a vida privada, a honra e a imagem das pessoas, assegurado o direito a indenização pelo dano material ou moral decorrente de sua violação;",
        provenance: {
          sourceUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm",
          retrievedAt: "2026-10-21T01:26:39Z",
          // SHA-256 of the UTF-8 text above, computed with shasum from the hand-copied text.
          contentHash: "sha256:ac4a37222107e533c0f2e9e78ea6de045a0d5d5d8b0cec8a6a3ed1ee9e73e0f0",
          datasetVersion: "2026.10.21-test",
        },
      });
    });

    it("answers 404 for an unknown dispositivo id", async () => {
      const response = await handle(new Request(`${api}/v1/provisions/cf/art5_cpt_inc999`));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    });

    it("answers 404 for an unknown norm", async () => {
      const response = await handle(new Request(`${api}/v1/provisions/clt/art5_cpt_inc10`));

      expect(response.status).toBe(404);
    });

    it("lists the CF among the norms without its build-only manifest fields", async () => {
      const response = await handle(new Request(`${api}/v1/norms`));

      expect(await response.json()).toEqual({
        norms: [
          {
            key: "cf",
            urn: "urn:lex:br:federal:constituicao:1988-10-05;1988",
            title: "Constituição da República Federativa do Brasil de 1988",
          },
        ],
      });
    });
  });
});

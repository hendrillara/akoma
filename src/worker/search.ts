// GET /v1/search?q=…[&norm=…][&limit=…]: ranked dispositivos, each with its full record and provenance.
// Agents read these bodies as legal text from a trusted domain, so nothing the request typed is ever echoed back: the
// query is not repeated, and `norm` and `limit` appear only after they are validated against known values.
import type { Dataset, Provision } from "../schema/dataset.ts";
import { ANALYZER } from "../search/analyze.ts";
import { searchIndex } from "../search/query.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 500;

export function createSearch(dataset: Dataset, provisions: Map<string, Provision>): (url: URL) => Response {
  const index = dataset.search;
  const norms = new Set(dataset.norms.map((n) => n.key));

  return (url) => {
    // An index from another analyzer would hold terms this Worker's queries never produce: refuse it, loudly.
    if (!index || index.analyzer !== ANALYZER) {
      return Response.json({ error: "search_unavailable" }, { status: 503 });
    }
    const params = url.searchParams;
    const query = params.get("q")?.trim() ?? "";
    if (query === "") return badRequest("q is required");
    if (query.length > MAX_QUERY_LENGTH) return badRequest(`q is longer than ${MAX_QUERY_LENGTH} characters`);

    const norm = params.get("norm");
    if (norm !== null && !norms.has(norm)) return badRequest(`unknown norm; known: ${[...norms].join(", ")}`);

    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return badRequest(`limit must be an integer from 1 to ${MAX_LIMIT}`);
    }

    const hits = searchIndex(index, query, { limit, ...(norm !== null && { norm }) });
    const results = hits.map((hit) => ({ score: Math.round(hit.score * 1000) / 1000, provision: provisions.get(hit.doc)! }));
    return Response.json({ norm, limit, results });
  };
}

function badRequest(message: string): Response {
  return Response.json({ error: "bad_request", message }, { status: 400 });
}

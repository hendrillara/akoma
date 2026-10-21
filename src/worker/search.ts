// GET /v1/search?q=…[&norm=…][&limit=…]: ranked dispositivos, each with its full record and provenance.
// Agents read these bodies as legal text from a trusted domain, so nothing the request typed is ever echoed back: the
// query is not repeated, and `norm` and `limit` appear only after they are validated against known values.
import { lines } from "../render/markdown.ts";
import { NOTICE, type Dataset, type Provision } from "../schema/dataset.ts";
import { ANALYZER } from "../search/analyze.ts";
import { searchIndex } from "../search/query.ts";
import { document, sourceLine, type View } from "./views.ts";
import { pathLabel } from "../schema/lexml.ts";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
export const MAX_QUERY_LENGTH = 500;

export function createSearch(dataset: Dataset): (params: URLSearchParams) => View {
  const index = dataset.search;
  const norms = new Set(dataset.norms.map((n) => n.key));
  const provisions = new Map(dataset.provisions.map((p) => [`${p.norm}/${p.id}`, p]));
  const credit = new Map(dataset.norms.flatMap((n) => (n.attribution ? [[n.key, n.attribution] as const] : [])));

  return (params) => {
    // An index from another analyzer would hold terms this Worker's queries never produce: refuse it, loudly.
    if (!index || index.analyzer !== ANALYZER) return failure(503, "search_unavailable");
    const query = params.get("q")?.trim() ?? "";
    if (query === "") return failure(400, "bad_request", "q is required");
    if (query.length > MAX_QUERY_LENGTH) return failure(400, "bad_request", `q is longer than ${MAX_QUERY_LENGTH} characters`);

    const norm = params.get("norm");
    if (norm !== null && !norms.has(norm)) return failure(400, "bad_request", `unknown norm; known: ${[...norms].join(", ")}`);

    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return failure(400, "bad_request", `limit must be an integer from 1 to ${MAX_LIMIT}`);
    }

    const hits = searchIndex(index, query, { limit, ...(norm !== null && { norm }) });
    const results = hits.map((hit) => ({ score: Math.round(hit.score * 1000) / 1000, provision: provisions.get(hit.doc)! }));
    // The normas.leg.br aliases (CC BY 4.0) travel with their credit, as on the provision view.
    const owed = [...new Set(results.flatMap(({ provision: p }) => (p.aliases?.length && credit.has(p.norm) ? [credit.get(p.norm)!] : [])))];
    const json = { norm, limit, results, ...(owed.length && { attribution: owed.join(" ") }), notice: NOTICE };
    return { status: 200, json, md: () => markdown(results.map((r) => r.provision)) };
  };
}

/** Each result as the provision view prints it (text, then path and ids); one footer per source page, then the notice. */
function markdown(found: Provision[]): string {
  if (found.length === 0) return document(["# Busca / Search", "Nenhum resultado / No results."], `---\n${NOTICE}`);
  const blocks = found.flatMap((p) => [
    ...lines(p),
    `*${pathLabel(p.path)}* · \`${p.norm}\` \`${p.id}\``,
  ]);
  const sources = [...new Map(found.map((p) => [p.provenance.sourceUrl, p.provenance])).values()];
  return document(["# Busca / Search", ...blocks], `---\n${[...sources.map(sourceLine), NOTICE].join("\n")}`);
}

function failure(status: number, error: string, message?: string): View {
  const json = { error, ...(message !== undefined && { message }) };
  return { status, json, md: () => `${message ?? "Busca indisponível / Search unavailable."}\n` };
}

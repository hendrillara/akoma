// Agent discovery: `/llms.txt` (the llmstxt.org index) and `/usage.md`, the short usage guide it links to. Both are
// written once per handler from the dataset's norm list, so they name exactly the norms this build serves.
// The base URL is fixed, never read from the request: no request input reaches a response body.
import type { Dataset } from "../schema/dataset.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH } from "./search.ts";
import { RATE_LIMIT } from "./rate-limit.ts";

export const BASE = "https://akoma.hendril.dev";
export const MCP_URL = `${BASE}/mcp`;
const REPO = "https://github.com/hendrillara/akoma";

export interface DiscoveryFile {
  contentType: string;
  body: string;
}

/** Path → file. Example ids are real ones from the v1 corpus; `test/discovery.test.ts` requests every `/v1/` link. */
export function discoveryFiles(dataset: Dataset): Map<string, DiscoveryFile> {
  const limits = rateLimitText();
  const norms = dataset.norms.map((n) => `- \`${n.key}\`: ${n.title} (\`${n.urn}\`)`).join("\n") || "- (none)";
  return new Map([
    ["/llms.txt", { contentType: "text/plain; charset=utf-8", body: llmsTxt(norms, limits) }],
    ["/usage.md", { contentType: "text/markdown; charset=utf-8", body: usage(norms, limits) }],
  ]);
}

function rateLimitText(): string {
  const { limit, periodSeconds } = RATE_LIMIT;
  return `Rate limit: ${limit} requests per ${periodSeconds} s per IP for the REST API, and a separate ${limit} for \`/mcp\`; over it, HTTP 429 with \`Retry-After\`.`;
}

function llmsTxt(norms: string, limits: string): string {
  return `# Akoma

> Akoma serves the text of Brazilian federal law, one dispositivo (article, paragraph, inciso, alínea, item) at a time, with a stable LexML id and its provenance, to AI agents over a remote MCP server and a REST API. The text is read from the official compiled pages of the Planalto. It is unofficial text and not legal advice; vigência is not verified against STF decisions.

PT: O Akoma serve o texto da legislação federal brasileira, dispositivo a dispositivo, com id LexML estável e proveniência, para agentes de IA, via servidor MCP remoto e API REST. O texto vem das páginas compiladas oficiais do Planalto. É texto não oficial e não é aconselhamento jurídico; a vigência não é verificada contra decisões do STF.

- Not an official source, not legal advice, not an Akoma Ntoso implementation. Quote the text as returned and keep its source line.
- Ids follow LexML: \`art5_cpt_inc10\` is art. 5º, caput, inciso X; \`art1_par1\` a parágrafo único; \`art103-1\` art. 103-A; \`art5\` the whole article.
- No signup, no API key. ${limits}

## Norms

${norms}

## MCP

- [Remote MCP endpoint](${MCP_URL}): Streamable HTTP, stateless, no authentication. Tools: \`search\`, \`get_provision\`, \`get_structure\`, \`list_norms\`; each answers in compact Markdown.

## REST API

- [Usage guide](${BASE}/usage.md): endpoints, ids, formats, errors and limits
- [Norms](${BASE}/v1/norms?format=md): the norms served and when each was retrieved
- [Search](${BASE}/v1/search?q=direito%20de%20arrependimento&norm=cdc&format=md): ranked dispositivos for a query
- [One dispositivo](${BASE}/v1/provisions/cf/art5_cpt_inc10?format=md): CF art. 5º, inciso X
- [A whole article](${BASE}/v1/provisions/cdc/art49?format=md): CDC art. 49 with its paragraph
- [Structure](${BASE}/v1/norms/cdc/structure?format=md): a norm's outline, without text
- [Status](${BASE}/v1/status?format=md): dataset version and source pages

## Optional

- [Source code, licences and contributing](${REPO})
`;
}

function usage(norms: string, limits: string): string {
  return `# Akoma usage guide

Base URL: ${BASE}. Read-only, no authentication. The MCP endpoint ${MCP_URL} serves the same data through four tools.

PT: guia de uso para agentes. A API é só de leitura e sem autenticação; o MCP em ${MCP_URL} serve os mesmos dados por quatro ferramentas. Cite o texto como veio e mantenha a linha da fonte: é texto não oficial, e a vigência não é verificada contra decisões do STF.

## Norms

${norms}

## MCP tools

- \`search\` {query, norm?, limit?}: dispositivos matching keywords or a question in Portuguese. Use it first when you don't know the article.
- \`get_provision\` {norm, id}: the exact text of one dispositivo, or of a whole article when \`id\` is an article id (\`art5\`).
- \`get_structure\` {norm}: the outline (títulos, capítulos, seções) with LexML ids and article ranges, no text.
- \`list_norms\` {}: the norm keys, URNs and retrieval times.

Each answer is Markdown: the text first, then its path and ids, then a footer with the source URL, retrieval time, dataset version and the notice.

## REST endpoints

JSON by default; add \`format=md\` for the same Markdown the MCP tools return.

- \`GET /v1/norms\`: the norms.
- \`GET /v1/norms/{norm}\`: one norm with its counts.
- \`GET /v1/norms/{norm}/structure\`: its outline.
- \`GET /v1/provisions/{norm}/{id}\`: a dispositivo (\`/v1/provisions/cf/art5_cpt_inc10\`) or a whole article (\`/v1/provisions/cdc/art49\`).
- \`GET /v1/search?q={query}[&norm={norm}][&limit=1–${MAX_LIMIT}]\`: ranked results (default ${DEFAULT_LIMIT}; \`q\` up to ${MAX_QUERY_LENGTH} characters), e.g. \`/v1/search?q=direito%20de%20arrependimento&norm=cdc\`. Each result is \`{score, provision}\`; \`attribution\` is added when a result carries aliases.
- \`GET /v1/status\`: dataset version, per-norm counts and the source pages read.

## Ids

LexML Parte 3 ids, never reused: \`art5_cpt_inc10\` (art. 5º, caput, inciso X), \`art7_cpt_inc15\`, \`art1_par1\` (parágrafo único), \`art5_par3\` (§ 3º), \`art103-1\` (art. 103-A), \`art5_cpt_inc10_ali1\` (alínea a). A revoked dispositivo keeps its id. An id from normas.leg.br that differs from Akoma's answers 404 with a \`suggestion\` of the canonical id (\`/v1/provisions/cf/art7_par1u\` suggests \`art7_par1\`).

## Reading a record

- \`text\`: the official wording, verbatim. \`status\`: \`in_force\`, \`revoked\`, \`vetoed\`, \`renumbered\` or \`not_yet_in_force\`. Never present a non-\`in_force\` record as current law.
- \`pending\`: wording an amending act has enacted with deferred vigência, with \`effectiveFrom\` (YYYY-MM-DD, Brasília) and \`vigencia\`, the act's own clause that defers that change (the Markdown shows it as "cláusula de vigência"). Until that date \`text\` is what applies; only the dispositivos with a \`pending\` entry wait.
- \`references\`: the "Vide" notes Planalto prints, including STF cases (ADI, ADPF…). Akoma does not check what the STF decided: warn the user when one is present.
- \`amendments\`: the acts that inserted, reworded or revoked it.
- \`provenance\`: \`sourceUrl\`, \`retrievedAt\`, \`contentHash\`, \`datasetVersion\`, the notice, and \`secondary\` (\`agrees\`, \`secondary-stale\` or \`unconfirmed\` against a second official source).

## Errors and limits

- 400 \`bad_request\` (missing \`q\`, unknown norm, bad \`limit\` or \`format\`); 404 \`not_found\`, with \`suggestion\` for a known alias; 405 for methods other than GET/HEAD (POST for \`/mcp\`); 503 \`search_unavailable\`.
- 429 \`rate_limited\` with \`Retry-After\` in seconds. ${limits}
- Successful answers carry \`Cache-Control: public, max-age=300, s-maxage=3600\`; the dataset changes only with a new deploy.

## Licence

The dataset is CC0 1.0, except the \`aliases\` fields: id fragments from normas.leg.br / LexML Brasil, © Senado Federal, CC BY 4.0. Code: MIT. ${REPO}
`;
}

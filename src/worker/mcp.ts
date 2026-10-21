// POST /mcp: the remote MCP endpoint, stateless (a fresh server per request, no Durable Objects), on the same handler
// as the REST API. Its four tools answer with the REST views' compact Markdown: the dispositivo text first, then its
// path, vigência, references and the provenance footer with the notice.
//
// Agents read what this endpoint says as legal text from a trusted domain, so no request input is echoed but the
// JSON-RPC `id`, which a client needs back and which is accepted only as an integer or a short string of letters,
// digits and `_ . : -` (any other id, in a single message or a batch, is rejected with a fixed error before the SDK
// reads the request). Tool arguments are checked here before any view runs, tool errors are fixed texts, and every
// JSON-RPC error the SDK writes (some of which repeat headers or method names) is replaced on the way out by a fixed
// message for its code.
import {
  createMcpHandler,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type CallToolResult,
  type Tool as ToolDefinition,
} from "@modelcontextprotocol/server";
import type { Dataset } from "../schema/dataset.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY_LENGTH } from "./search.ts";
import { ID, type View, type Views } from "./views.ts";

export interface McpDeps {
  dataset: Dataset;
  views: Views;
  search: (params: URLSearchParams) => View;
}

interface Tool {
  definition: ToolDefinition;
  run(args: Record<string, unknown>): CallToolResult;
}

const SERVER = { name: "akoma", title: "Akoma: legislação federal brasileira / Brazilian federal law", version: "1.0.0" };

const INSTRUCTIONS = [
  "Akoma serves the text in force of Brazilian federal law (CF, ADCT, CDC), one dispositivo at a time, from the official Planalto pages. Use `search` first when you don't know the article; use `get_provision` with a norm and id for the exact citation. Quote the text as given and keep its source line: it is unofficial text, and vigência is not verified against STF decisions.",
  "PT: O Akoma serve o texto vigente da legislação federal brasileira (CF, ADCT, CDC), dispositivo a dispositivo, a partir das páginas oficiais do Planalto. Use `search` primeiro quando não souber o artigo; use `get_provision` com a norma e o id para a citação exata. Cite o texto como veio e mantenha a linha da fonte: é texto não oficial, e a vigência não é verificada contra decisões do STF.",
].join("\n\n");

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** Fixed texts: the only error messages this endpoint writes itself. */
const UNKNOWN_TOOL = "Ferramenta desconhecida / Unknown tool. Ferramentas / tools: search, get_provision, get_structure, list_norms.";
const METHOD_NOT_ALLOWED = "Método não permitido / Method not allowed: use POST.";
const MALFORMED_ID =
  "Id inválido / Malformed id: use um id LexML como / use a LexML id such as `art5_cpt_inc10` (dispositivo) ou / or `art5` (artigo inteiro / whole article). `search` encontra ids / finds ids.";
const QUERY_REQUIRED = "`query` é obrigatório / is required: palavras-chave ou uma pergunta / keywords or a question.";
const QUERY_TOO_LONG = `\`query\` passa de / is longer than ${MAX_QUERY_LENGTH} caracteres / characters.`;
const BAD_LIMIT = `\`limit\` deve ser um inteiro de 1 a ${MAX_LIMIT} / must be an integer from 1 to ${MAX_LIMIT}.`;
const NOT_FOUND_HINT = "Use `search` para encontrar o id / to find the id, ou / or `get_structure` para navegar / to browse.";

/** What every SDK-written JSON-RPC error becomes, by code; any other code is a plain rejection. */
const RPC_MESSAGES: Record<number, string> = {
  [-32700]: "Erro de análise / Parse error: o corpo não é JSON válido / the body is not valid JSON.",
  [-32600]: "Requisição inválida / Invalid request.",
  [-32601]: "Método não encontrado / Method not found.",
  [-32602]: "Parâmetros inválidos / Invalid params.",
  [-32603]: "Erro interno / Internal error.",
};
const REJECTED = "Requisição recusada / Request rejected.";
const OWN_MESSAGES = new Set([UNKNOWN_TOOL, METHOD_NOT_ALLOWED]);

/** The headers a browser-based MCP client sends; preflights get this fixed list, never the requested one echoed. */
const ALLOWED_HEADERS = "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id";

export function createMcp({ dataset, views, search }: McpDeps): (request: Request) => Promise<Response> {
  const keys = dataset.norms.map((n) => n.key);
  const known = new Set(keys);
  const normList = keys.map((k) => `\`${k}\``).join(", ");
  const unknownNorm = `Norma desconhecida / Unknown norm. Normas / norms: ${normList || "nenhuma / none"} (\`list_norms\`).`;
  // JSON Schema needs a non-empty enum; an empty dataset leaves the norm a plain string.
  const normSchema = (description: string) => ({ type: "string", description, ...(keys.length > 0 && { enum: keys }) });
  const norm = (args: Record<string, unknown>) => (typeof args.norm === "string" && known.has(args.norm) ? args.norm : undefined);

  const tools: Tool[] = [
    {
      definition: {
        name: "search",
        title: "Buscar dispositivos / Search provisions",
        description: [
          "Search Brazilian federal law by keywords or a natural-language question (e.g. \"teto remuneratório do servidor\", \"direito de arrependimento\"). Returns the best-matching dispositivos, each with its text, path, norm and id, and the source. Use it first when you don't know the article; then call `get_provision` with a returned id for the exact citation or the whole article. Filter by `norm` to stay on one law.",
          "PT: Busca na legislação federal brasileira por palavras-chave ou uma pergunta em linguagem natural. Devolve os dispositivos mais relevantes, cada um com texto, caminho, norma e id, e a fonte. Use primeiro quando não souber o artigo; depois chame `get_provision` com um id retornado para a citação exata ou o artigo inteiro. Filtre por `norm` para ficar em uma só lei.",
        ].join("\n\n"),
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: MAX_QUERY_LENGTH,
              description: "Keywords or a question, in Portuguese / Palavras-chave ou uma pergunta, em português.",
            },
            norm: normSchema("Only this norm (optional) / Só esta norma (opcional)."),
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_LIMIT,
              default: DEFAULT_LIMIT,
              description: "How many dispositivos / Quantos dispositivos.",
            },
          },
          required: ["query"],
        },
        annotations: ANNOTATIONS,
      },
      run(args) {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (query === "") return failure(QUERY_REQUIRED);
        if (query.length > MAX_QUERY_LENGTH) return failure(QUERY_TOO_LONG);
        const params = new URLSearchParams({ q: query });
        if (args.norm !== undefined) {
          const key = norm(args);
          if (key === undefined) return failure(unknownNorm);
          params.set("norm", key);
        }
        if (args.limit !== undefined) {
          const { limit } = args;
          if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return failure(BAD_LIMIT);
          params.set("limit", String(limit));
        }
        return answer(search(params));
      },
    },
    {
      definition: {
        name: "get_provision",
        title: "Obter dispositivo / Get a provision",
        description: [
          "Get the exact text in force of one dispositivo, or of a whole article with all its paragraphs, incisos and alíneas, by norm and LexML id. Use it for the exact citation, or after `search` to read a result in context. Ids: `art5_cpt_inc10` (art. 5º, caput, inciso X), `art1_par1` (parágrafo único), `art7_cpt_inc15`, `art103-1` (art. 103-A), `art5` (the whole article). The answer gives the text first, then its path, its status (revoked, vetoed) and any pending wording with its start date, the \"Vide\"/ADI notes Planalto prints, and the source.",
          "PT: Obtém o texto vigente exato de um dispositivo, ou de um artigo inteiro com seus parágrafos, incisos e alíneas, pela norma e pelo id LexML. Use para a citação exata, ou depois de `search` para ler um resultado em contexto. A resposta traz o texto, depois o caminho, a situação (revogado, vetado) e eventual redação pendente com sua data de início, as notas \"Vide\"/ADI que o Planalto imprime, e a fonte.",
        ].join("\n\n"),
        inputSchema: {
          type: "object",
          properties: {
            norm: normSchema("Norm key / Chave da norma (`list_norms`)."),
            id: {
              type: "string",
              pattern: ID.source,
              description: "LexML id of a dispositivo (`art5_cpt_inc10`) or an article (`art5`) / Id LexML de um dispositivo ou artigo.",
            },
          },
          required: ["norm", "id"],
        },
        annotations: ANNOTATIONS,
      },
      run(args) {
        const key = norm(args);
        if (key === undefined) return failure(unknownNorm);
        if (typeof args.id !== "string" || !ID.test(args.id)) return failure(MALFORMED_ID);
        const view = views.provision(key, args.id);
        return view.status === 404 ? failure(`${view.md()}\n${NOT_FOUND_HINT}`) : answer(view);
      },
    },
    {
      definition: {
        name: "get_structure",
        title: "Estrutura da norma / Norm structure",
        description: [
          "Get a norm's outline: its títulos, capítulos, seções and subseções with their names, LexML ids and article ranges, without the text. Use it to browse a norm cheaply or to find which articles cover a subject, then `get_provision` for the text.",
          "PT: Obtém o sumário de uma norma: títulos, capítulos, seções e subseções com nomes, ids LexML e intervalos de artigos, sem o texto. Use para navegar uma norma a baixo custo ou achar os artigos de um assunto; depois `get_provision` para o texto.",
        ].join("\n\n"),
        inputSchema: {
          type: "object",
          properties: { norm: normSchema("Norm key / Chave da norma (`list_norms`).") },
          required: ["norm"],
        },
        annotations: ANNOTATIONS,
      },
      run(args) {
        const key = norm(args);
        return key === undefined ? failure(unknownNorm) : answer(views.structure(key));
      },
    },
    {
      definition: {
        name: "list_norms",
        title: "Normas disponíveis / Available norms",
        description: [
          "List the norms Akoma serves, with each key (for `norm` arguments), LexML URN and when its text was retrieved from the official source. Use it to learn which laws are available and how current each one is.",
          "PT: Lista as normas que o Akoma serve, com a chave de cada uma (para o argumento `norm`), a URN LexML e quando o texto foi obtido da fonte oficial. Use para saber quais leis estão disponíveis e quão atual cada uma está.",
        ].join("\n\n"),
        inputSchema: { type: "object", properties: {} },
        annotations: ANNOTATIONS,
      },
      run: () => answer(views.norms()),
    },
  ];
  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  const listed = tools.map((t) => t.definition);

  const handler = createMcpHandler(() => {
    const server = new Server(SERVER, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    server.setRequestHandler("tools/list", () => ({ tools: listed }));
    server.setRequestHandler("tools/call", (request) => {
      const tool = byName.get(request.params.name);
      if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, UNKNOWN_TOOL);
      const args = request.params.arguments;
      return tool.run(args && typeof args === "object" && !Array.isArray(args) ? args : {});
    });
    return server;
  });

  return async (request) => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": ALLOWED_HEADERS,
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method !== "POST") {
      return rpcResponse(405, rpcError(-32000, METHOD_NOT_ALLOWED), { allow: "POST, OPTIONS" });
    }
    if (!(await safeIds(request))) return rpcResponse(400, rpcError(-32600, RPC_MESSAGES[-32600]!));
    return sanitize(await handler.fetch(request));
  };
}

/** The only JSON-RPC ids echoed back: an integer, or a short plain string (UUIDs and "req-1"-style counters fit). */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Whether every message in the body has a safe id or none (a notification). A body that is not JSON is left to the
 * SDK, whose parse error carries a null id.
 */
async function safeIds(request: Request): Promise<boolean> {
  let body: unknown;
  try {
    body = JSON.parse(await request.clone().text());
  } catch {
    return true;
  }
  const messages = Array.isArray(body) ? body : [body];
  return messages.every((m) => {
    if (!isRecord(m) || !("id" in m)) return true;
    const { id } = m;
    return (typeof id === "number" && Number.isSafeInteger(id)) || (typeof id === "string" && SAFE_ID.test(id));
  });
}

/** 429 for `/mcp`: a JSON-RPC error the client surfaces with the HTTP status, never cached. */
export function mcpRateLimited(retryAfter: number): Response {
  const message = `Limite de requisições excedido / Rate limit exceeded: tente de novo em / retry in ${retryAfter} s.`;
  return rpcResponse(429, rpcError(-32000, message, { retryAfter }), { "retry-after": String(retryAfter) });
}

function answer(view: View): CallToolResult {
  return view.status === 200 ? { content: [{ type: "text", text: view.md() }] } : failure(view.md());
}

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text: text.endsWith("\n") ? text : `${text}\n` }], isError: true };
}

function rpcError(code: number, message: string, data?: Record<string, unknown>, id: unknown = null) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data && { data }) } };
}

function rpcResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...MCP_HEADERS, ...extra } });
}

const MCP_HEADERS = { "cache-control": "no-store", "access-control-allow-origin": "*" };

/**
 * Passes the SDK's response through with every JSON-RPC error rewritten (JSON bodies, batches, and SSE `data:` lines,
 * streamed line by line because a `subscriptions/listen` stream stays open). Any other body is replaced.
 */
async function sanitize(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  for (const [name, value] of Object.entries(MCP_HEADERS)) headers.set(name, value);
  const init = { status: response.status, headers };
  if (response.body === null) return new Response(null, init);
  const type = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type === "application/json") return new Response(cleanJson(await response.text()), init);
  if (type === "text/event-stream") {
    const body = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(cleanSse()).pipeThrough(new TextEncoderStream());
    return new Response(body, init);
  }
  await response.body.cancel();
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(rpcError(-32603, RPC_MESSAGES[-32603]!)), init);
}

function cleanJson(text: string): string {
  try {
    return JSON.stringify(cleanMessage(JSON.parse(text)));
  } catch {
    return JSON.stringify(rpcError(-32603, RPC_MESSAGES[-32603]!));
  }
}

function cleanSse(): TransformStream<string, string> {
  let rest = "";
  const line = (text: string) => (/^data:\s*\S/.test(text) ? `data: ${cleanJson(text.slice(5).trim())}` : text);
  return new TransformStream({
    transform(chunk, controller) {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop()!;
      for (const part of parts) controller.enqueue(`${line(part)}\n`);
    },
    flush(controller) {
      if (rest) controller.enqueue(line(rest));
    },
  });
}

/** A JSON-RPC error keeps its envelope and code; its message becomes a fixed text and its data only the versions we support. */
function cleanMessage(message: unknown): unknown {
  if (Array.isArray(message)) return message.map(cleanMessage);
  if (!isRecord(message) || !isRecord(message.error)) return message;
  const { code, message: said, data } = message.error;
  const safeCode = typeof code === "number" && Number.isInteger(code) ? code : -32603;
  const text = typeof said === "string" && OWN_MESSAGES.has(said) ? said : (RPC_MESSAGES[safeCode] ?? REJECTED);
  // The 2026-07-28 client renegotiates from `data.supported`, which the SDK fills with its own revisions.
  const supported = isRecord(data) && Array.isArray(data.supported) ? data.supported : undefined;
  const versions = supported?.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? supported : undefined;
  return rpcError(safeCode, text, versions && { supported: versions }, message.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

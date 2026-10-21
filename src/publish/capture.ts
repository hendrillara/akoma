// What the daily job read, kept: a source that records every page it served (and every one it could not fetch), and
// the capture folder those become (`fixtures/<day>-daily/`, the recorded-source format). Committing the capture with
// the dataset makes the dataset a regeneration of committed files (src/publish/published.ts).
import { createHash } from "node:crypto";
import type { Probe, RawSnapshot, Source, Validators } from "../sources/source.ts";
import type { WorkspaceFile } from "./workspace.ts";

/** One request to a source and how it went. */
export interface Attempt {
  url: string;
  ok: boolean;
  error?: string;
}

export interface RecordingSource extends Source {
  /** Always there: a plain `get` stands in for a source that cannot make conditional requests. */
  probe(url: string, validators: Validators): Promise<Probe>;
  /** Every request, in order. */
  attempts: Attempt[];
  /** The pages `get` served, once each (the last fetch of a URL wins). */
  snapshots(): RawSnapshot[];
  /** The URLs `get` could not fetch (and never fetched later in the run). */
  unavailable(): string[];
}

export function recording(source: Source): RecordingSource {
  const served = new Map<string, RawSnapshot>();
  const missing = new Set<string>();
  const attempts: Attempt[] = [];
  return {
    attempts,
    snapshots: () => [...served.values()],
    unavailable: () => [...missing],
    async get(url) {
      const snapshot = await source.get(url);
      attempts.push({ url, ok: snapshot !== undefined, ...(!snapshot && { error: "unavailable" }) });
      if (snapshot) {
        served.set(url, snapshot);
        missing.delete(url);
      } else if (!served.has(url)) missing.add(url);
      return snapshot;
    },
    async probe(url: string, validators: Validators): Promise<Probe> {
      let result: Probe;
      if (source.probe) result = await source.probe(url, validators);
      else {
        const snapshot = await source.get(url);
        result = snapshot ? { status: "modified", snapshot } : { status: "unavailable", error: "unavailable" };
      }
      attempts.push({ url, ok: result.status !== "unavailable", ...(result.status === "unavailable" && { error: result.error }) });
      return result;
    },
  };
}

/** The capture folder's files: one per page, `index.json` (checksums, headers, retrieval times) and a README. */
export function captureFiles(day: string, snapshots: RawSnapshot[], unavailable: string[], runUrl?: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  const names = new Set<string>();
  const entries = snapshots.map((s) => {
    const file = uniqueName(fileName(s.url), names);
    files.push({ path: file, content: s.body });
    return {
      file,
      url: s.url,
      encoding: s.encoding,
      headers: s.headers,
      retrievedAt: s.retrievedAt,
      sha256: createHash("sha256").update(s.body).digest("hex"),
      bytes: s.body.byteLength,
    };
  });
  const index = { capturedOn: day, timeZone: "America/Sao_Paulo", snapshots: entries, ...(unavailable.length && { unavailable }) };
  files.push({ path: "index.json", content: `${JSON.stringify(index, null, 2)}\n` });
  files.push({ path: "README.md", content: readme(day, entries, unavailable, runUrl) });
  return files;
}

const FOLDERS: [RegExp, string][] = [
  [/(^|\.)planalto\.gov\.br$/, "planalto"],
  [/(^|\.)normas\.leg\.br$/, "normas-leg-br"],
  [/(^|\.)camara\.leg\.br$/, "camara-legin"],
];

/** "planalto/constituicaocompilado.htm"; a normas.leg.br API answer is named by its URN. */
function fileName(url: string): string {
  const u = new URL(url);
  const folder = FOLDERS.find(([host]) => host.test(u.hostname))?.[1] ?? u.hostname.replaceAll(".", "-");
  const urn = u.searchParams.get("urn");
  const base = urn ? `${urn.replace(/^urn:lex:br:federal:/, "").replace(/[^\w.-]+/g, "-")}.json` : u.pathname.split("/").filter(Boolean).at(-1) ?? "index.html";
  return `${folder}/${base}`;
}

function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = name.replace(/(\.[^./]+)?$/, `-${n}$1`);
  taken.add(candidate);
  return candidate;
}

function readme(day: string, entries: { file: string; url: string }[], unavailable: string[], runUrl?: string): string {
  const list = entries.map((e) => `- \`${e.file}\` ← ${e.url}`).join("\n");
  const missing = unavailable.length ? `\n\nUnavailable on this run / indisponíveis nesta execução:\n\n${unavailable.map((u) => `- ${u}`).join("\n")}` : "";
  const by = runUrl ? ` (${runUrl})` : "";
  return `# Daily capture ${day}

Written by the daily publish job${by}, never by hand: the pages the job built the dataset of ${day} from, stored exactly as served, with anonymous GETs (\`Mozilla/5.0 (compatible; akoma/<version>)\`, no personal identifier). \`index.json\` records each file's URL, encoding, headers, retrieval instant and SHA-256. \`pnpm build:dataset\` regenerates \`dataset/\` from the captures, this one winning over older ones for the same URL (docs/publishing.md).

The one edit: on Câmara LEGIN pages the \`<meta name="author">\` and \`<meta name="changedby">\` values, a staff member's name and ID, are replaced with \`[redacted]\` at fetch time, before the build reads them. Planalto pages are public domain (Lei 9.610/1998, art. 8º, IV). The normas.leg.br files are © Senado Federal, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (source: normas.leg.br / LexML Brasil); they are kept only as build inputs, and the published dataset does not republish their text or history.

# Captura diária ${day} (PT)

Escrita pelo job diário de publicação, nunca à mão: as páginas de que o job montou o dataset de ${day}, guardadas exatamente como foram servidas, com GETs anônimos (sem identificador pessoal). O \`index.json\` registra a URL, a codificação, os headers, o instante e o SHA-256 de cada arquivo. O \`pnpm build:dataset\` regenera o \`dataset/\` a partir das capturas; esta prevalece sobre as anteriores para a mesma URL.

A única edição: nas páginas do LEGIN da Câmara, os valores de \`<meta name="author">\` e \`<meta name="changedby">\` (nome e matrícula de um servidor) viram \`[redacted]\` já na busca, antes de o build lê-los. As páginas do Planalto são de domínio público (Lei 9.610/1998, art. 8º, IV). Os arquivos do normas.leg.br são © Senado Federal, sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (fonte: normas.leg.br / LexML Brasil); servem só de entrada do build, e o dataset publicado não republica o texto nem o histórico deles.

## Files / arquivos

${list}${missing}
`;
}

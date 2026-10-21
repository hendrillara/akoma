// The dataset as published files: canonical JSON per article, and generated Markdown mirrors for humans and diffs.
// The JSON is canonical; the Markdown is always generated from it, never edited.
import type { Dataset, NormEntry, Provision } from "../schema/dataset.ts";

export interface DatasetFile {
  /** Path inside the published dataset, e.g. "cf/art5.json". */
  path: string;
  content: string;
}

/** The JSON of one article: its norm and every dispositivo whose id starts with the article's id. */
export interface ArticleFile {
  norm: NormEntry;
  article: string;
  provisions: Provision[];
}

/**
 * Per norm: `<norm>/<article>.json` and `<norm>/<article>.md` for each article, plus `<norm>.md` with the whole text.
 * Then `search-index.json`, the prebuilt search index, compact since the Worker parses it.
 */
export function datasetFiles(dataset: Dataset): DatasetFile[] {
  const files: DatasetFile[] = [];
  for (const norm of dataset.norms) {
    const articles = byArticle(dataset.provisions.filter((p) => p.norm === norm.key));
    for (const [article, provisions] of articles) {
      const json: ArticleFile = { norm, article, provisions };
      files.push({ path: `${norm.key}/${article}.json`, content: `${JSON.stringify(json, null, 2)}\n` });
      files.push({ path: `${norm.key}/${article}.md`, content: `${articleMarkdown(provisions).join("\n\n")}\n` });
    }
    files.push({ path: `${norm.key}.md`, content: normMarkdown(norm, [...articles.values()].flat()) });
  }
  if (dataset.search) files.push({ path: "search-index.json", content: `${JSON.stringify(dataset.search)}\n` });
  return files;
}

function byArticle(provisions: Provision[]): Map<string, Provision[]> {
  const articles = new Map<string, Provision[]>();
  for (const provision of provisions) {
    const article = provision.id.split("_")[0]!;
    articles.set(article, [...(articles.get(article) ?? []), provision]);
  }
  return articles;
}

/** The whole norm: groupings as headings, each dispositivo as one paragraph, annotations in italics after it. */
export function normMarkdown(norm: NormEntry, provisions: Provision[]): string {
  const out = [`# ${norm.title}`];
  const first = provisions[0];
  if (first) {
    const { sourceUrl, retrievedAt, datasetVersion, notice } = first.provenance;
    out.push(`> ${notice}\n>\n> Fonte / source: ${sourceUrl} (${retrievedAt}). Dataset ${datasetVersion}. URN \`${norm.urn}\`.`);
  }
  let open: string[] = [];
  for (const provision of provisions) {
    const groups = provision.path.filter((s) => GROUPINGS.has(s.kind)).map((s) => s.label);
    let same = 0;
    while (same < groups.length && groups[same] === open[same]) same++;
    if (same < groups.length || groups.length < open.length) {
      // Headings from the first grouping that changed down; "#" is the norm, so a Título is "##".
      for (let depth = same; depth < groups.length; depth++) out.push(`${"#".repeat(Math.min(depth + 2, 6))} ${groups[depth]}`);
      open = groups;
    }
    out.push(line(provision));
  }
  return `${out.join("\n\n")}\n`;
}

function articleMarkdown(provisions: Provision[]): string[] {
  const path = provisions[0]!.path.map((s) => s.label).slice(0, -1).join(" › ");
  return [`<!-- ${path} -->`, ...provisions.map(line)];
}

const GROUPINGS = new Set(["parte", "livro", "titulo", "capitulo", "secao", "subsecao"]);

/** One dispositivo as printed: "Art. 5º …", "§ 1º …", "Parágrafo único. …", "X - …", "a) …", "1) …". */
function line(provision: Provision): string {
  const label = printedLabel(provision);
  const shown = provision.text || (provision.status === "vetoed" ? "(Vetado)" : provision.status === "revoked" ? "(Revogado)" : "");
  const notes = [...provision.amendments.map((a) => a.annotation), ...provision.references.map((r) => r.annotation)];
  const annotations = notes.length ? ` ${notes.map((n) => `*(${n})*`).join(" ")}` : "";
  // A renumbered dispositivo has no wording left: its label is followed by the note alone.
  return `${[label, escape(shown)].filter(Boolean).join(" ")}${annotations}`.trim();
}

function printedLabel(provision: Provision): string {
  const { kind, label } = provision;
  if (kind === "caput") return `**${provision.path.at(-2)!.label}**`;
  if (kind === "paragrafo") return label === "parágrafo único" ? "Parágrafo único." : label;
  if (kind === "inciso") return `${label.replace(/^inciso /, "")} -`;
  if (kind === "alinea") return `${label.replace(/^alínea /, "")})`;
  return `${label.replace(/^item /, "")})`;
}

/** Keeps legal text from turning into Markdown syntax ("*" or "_" emphasis, inline code, HTML). */
export function escape(text: string): string {
  return text.replace(/([\\*_`<])/g, "\\$1");
}

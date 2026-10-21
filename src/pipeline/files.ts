// The dataset as published files: canonical JSON per article, and generated Markdown mirrors for humans and diffs.
// The JSON is canonical; the Markdown is always generated from it, never edited.
import { lines } from "../render/markdown.ts";
import type { Dataset, NormEntry, Provision } from "../schema/dataset.ts";
import { articleOf, pathLabel } from "../schema/lexml.ts";

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
 * Then `search-index.json`, the prebuilt search index, compact since the Worker parses it, and `status.json` with the
 * build's own checks (today review layer 2's outcomes per norm and the credit owed for the aliases; #12 adds the rest). Last `dataset.json`, the whole
 * dataset, and `_headers`, the static-asset headers of the deployed folder.
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
  if (dataset.status) files.push({ path: "status.json", content: `${JSON.stringify(dataset.status, null, 2)}\n` });
  // The whole dataset in one file: a one-file download, and what the deployed Worker's API is bundled from
  // (src/worker/main.ts), so the API serves exactly the committed files.
  files.push({ path: "dataset.json", content: `${JSON.stringify(dataset)}\n` });
  // Read, not served, by Workers static assets (wrangler.jsonc `assets.directory` is this folder): any origin may
  // fetch the files.
  files.push({ path: "_headers", content: "/*\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n" });
  return files;
}

function byArticle(provisions: Provision[]): Map<string, Provision[]> {
  const articles = new Map<string, Provision[]>();
  for (const provision of provisions) {
    const article = articleOf(provision.id);
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
    out.push(...lines(provision));
  }
  return `${out.join("\n\n")}\n`;
}

function articleMarkdown(provisions: Provision[]): string[] {
  const path = pathLabel(provisions[0]!.path.slice(0, -1));
  return [`<!-- ${path} -->`, ...provisions.flatMap(lines)];
}

const GROUPINGS = new Set(["parte", "livro", "titulo", "capitulo", "secao", "subsecao"]);

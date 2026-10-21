// Parses a Planalto page (hand-edited FrontPage/Word HTML) into dispositivos placed in the LC 95 hierarchy.
// Covers títulos down to incisos; alíneas, itens and annotations-as-metadata come with the full hierarchy.
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { PathKind, PathSegment } from "../schema/dataset.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface PageLayout {
  /** `name` of the anchor where the norm's text ends on the page (e.g. the ADCT that follows the CF). */
  endAnchor?: string;
}

export interface ParsedProvision {
  id: string;
  path: PathSegment[];
  text: string;
}

export function parsePlanaltoPage(html: string, layout: PageLayout): ParsedProvision[] {
  const out: ParsedProvision[] = [];
  const groups: PathSegment[] = [];
  let article: { id: string; segment: PathSegment } | undefined;
  let paragraph: { id: string; segment: PathSegment } | undefined;

  for (const line of visibleLines(html, layout.endAnchor)) {

    const heading = matchHeading(line);
    if (heading) {
      const depth = GROUPINGS.indexOf(heading.kind);
      while (groups.length && GROUPINGS.indexOf(groups.at(-1)!.kind) >= depth) groups.pop();
      groups.push(heading);
      article = paragraph = undefined;
      continue;
    }

    const art = matchArticle(line);
    if (art && struckOut(art)) continue;
    if (art) {
      article = { id: art.id, segment: { kind: "artigo", label: art.label } };
      paragraph = undefined;
      out.push({
        id: `${art.id}_cpt`,
        path: [...groups, article.segment, { kind: "caput", label: "caput" }],
        text: clean(art.rest),
      });
      continue;
    }
    if (!article) continue;

    const par = matchParagraph(line);
    if (par && struckOut(par)) continue;
    if (par) {
      paragraph = { id: `${article.id}_${par.id}`, segment: { kind: "paragrafo", label: par.label } };
      out.push({ id: paragraph.id, path: [...groups, article.segment, paragraph.segment], text: clean(par.rest) });
      continue;
    }

    const inc = matchInciso(line);
    if (inc && struckOut(inc)) continue;
    if (inc) {
      // LexML Parte 3: incisos of the caput hang under `_cpt`, incisos of a parágrafo directly under it.
      const parent = paragraph ?? { id: `${article.id}_cpt`, segment: undefined };
      const path = [...groups, article.segment, ...(parent.segment ? [parent.segment] : [])];
      out.push({
        id: `${parent.id}_${inc.id}`,
        path: [...path, { kind: "inciso", label: inc.label }],
        text: clean(inc.rest),
      });
    }
    // Anything else (heading names, alíneas, itens, notes) is not a dispositivo yet and is dropped, never merged.
  }

  return out;
}

// --- Visible text -----------------------------------------------------------------------------------------

const BLOCKS = new Set([
  "address", "article", "blockquote", "body", "br", "center", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "li", "ol", "p", "section", "table", "td", "th", "tr", "ul",
]);
const SKIPPED = new Set(["head", "script", "style", "template"]);
/** Old wording: Planalto strikes it with any of these tags, or with CSS line-through, even on "compilado" pages. */
const STRUCK = new Set(["strike", "s", "del"]);

/** The page's text as a browser would show it, one line per block, with struck wording removed. */
function visibleLines(html: string, endAnchor: string | undefined): string[] {
  const lines: string[] = [];
  let current = "";
  let ended = false;
  const flush = () => {
    const line = current.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = "";
  };

  const walk = (node: Node): void => {
    if (ended) return;
    if (node.nodeName === "#text") {
      current += (node as DefaultTreeAdapterMap["textNode"]).value;
      return;
    }
    if (!("childNodes" in node)) return;
    const element = "tagName" in node ? (node as Element) : undefined;
    if (element) {
      if (SKIPPED.has(element.tagName) || STRUCK.has(element.tagName) || isLineThrough(element)) return;
      if (endAnchor && element.tagName === "a" && attribute(element, "name") === endAnchor) {
        ended = true;
        return;
      }
    }
    const block = element !== undefined && BLOCKS.has(element.tagName);
    if (block) flush();
    for (const child of node.childNodes) walk(child);
    if (block) flush();
  };

  walk(parse(html));
  if (!ended) flush();
  return lines;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

function isLineThrough(element: Element): boolean {
  return /line-through/i.test(attribute(element, "style") ?? "");
}

// --- Dispositivo labels -----------------------------------------------------------------------------------

const GROUPINGS: PathKind[] = ["titulo", "capitulo", "secao", "subsecao"];
const HEADING_KINDS: Record<string, PathKind> = { título: "titulo", capítulo: "capitulo", seção: "secao", subseção: "subsecao" };

function matchHeading(line: string): PathSegment | undefined {
  const m = /^(título|capítulo|seção|subseção)\s+([IVXLCDM]+(?:-[A-Z])*)(?=\s|$)/i.exec(line);
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  return { kind: HEADING_KINDS[word]!, label: `${word[0]!.toUpperCase()}${word.slice(1)} ${m[2]}` };
}

interface Numbered {
  /** LexML id fragment, e.g. "art103-1", "par1", "inc10". */
  id: string;
  label: string;
  /** The text after the label. */
  rest: string;
}

function matchArticle(line: string): Numbered | undefined {
  const m = /^Art\.\s*(\d+)(.*)$/.exec(line);
  if (!m) return undefined;
  const n = Number(m[1]);
  const { suffix, rest } = ordinalAndSuffix(n, m[2]!);
  return { id: `art${n}${suffixId(suffix)}`, label: `Art. ${n}${n < 10 ? "º" : ""}${suffix}`, rest };
}

function matchParagraph(line: string): Numbered | undefined {
  const unico = /^Parágrafo único\s*[.:\-–]?\s*(.*)$/i.exec(line);
  if (unico) return { id: "par1", label: "parágrafo único", rest: unico[1]! };
  const m = /^§\s*(\d+)(.*)$/.exec(line);
  if (!m) return undefined;
  const n = Number(m[1]);
  const { suffix, rest } = ordinalAndSuffix(n, m[2]!);
  return { id: `par${n}${suffixId(suffix)}`, label: `§ ${n}${n < 10 ? "º" : ""}${suffix}`, rest };
}

function matchInciso(line: string): Numbered | undefined {
  // The letter suffix is glued to the numeral ("II-A - …"), so "I - A República…" stays an inciso I.
  // A suffixed inciso may lack the separator (CF art. 92 "I-A o Conselho Nacional de Justiça").
  const m = /^([IVXLCDM]+)(?:((?:-[A-Z])+)(?:\s*[-–]\s*|\s+)|\s*[-–]\s*)(.*)$/.exec(line);
  if (!m) return undefined;
  const n = romanToNumber(m[1]!);
  if (n === undefined) return undefined;
  const suffix = m[2] ?? "";
  return { id: `inc${n}${suffixId(suffix)}`, label: `inciso ${m[1]}${suffix}`, rest: m[3]! };
}

/**
 * Splits what follows an article or paragraph number: an ordinal mark (º, °, or a superscript "o" that the page
 * leaves as " o" when pretty-printed; ordinals only go up to the ninth), letter suffixes ("-A-B") and a separator.
 */
function ordinalAndSuffix(n: number, after: string): { suffix: string; rest: string } {
  let rest = after.replace(/^\s*[º°]/, "");
  if (n < 10 && rest === after) rest = after.replace(/^\s*o(?=[\s.\-–]|$)/, "");
  const suffix = /^\s*((?:-[A-Z](?![a-zà-ú]))*)/.exec(rest)![1]!;
  rest = rest.replace(/^\s*(?:-[A-Z](?![a-zà-ú]))*/, "").replace(/^\s*[.\-–]?\s*/, "");
  return { suffix, rest };
}

/** Only the label is left once struck wording is removed ("IX - <strike>…</strike>"): an old wording, not a dispositivo. */
function struckOut(numbered: Numbered): boolean {
  return numbered.rest.trim() === "";
}

/** "-A-B" → "-1-2" (LexML Parte 3: letters become numbers). */
function suffixId(suffix: string): string {
  return suffix.replace(/-([A-Z])/g, (_, letter: string) => `-${letter.charCodeAt(0) - 64}`);
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToNumber(numeral: string): number | undefined {
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const value = ROMAN[numeral[i]!]!;
    const next = ROMAN[numeral[i + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : undefined;
}

// --- Text -------------------------------------------------------------------------------------------------

/** Source annotations Planalto appends in parentheses; they become metadata later, never part of the text. */
const TRAILING_ANNOTATION =
  /\s*\(\s*(?:Vide|Vigência|Redação dada|Incluíd[oa]|Revogad[oa]|Produção de efeitos?|Regulamento)[^()]*\)\s*$/i;

function clean(text: string): string {
  let current = text.trim();
  for (;;) {
    const next = current.replace(TRAILING_ANNOTATION, "").trim();
    if (next === current) return current;
    current = next;
  }
}

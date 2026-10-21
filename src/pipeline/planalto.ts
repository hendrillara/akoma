// Parses a Planalto page (hand-edited FrontPage/Word HTML) into dispositivos placed in the LC 95 hierarchy:
// Parte › Livro › Título › Capítulo › Seção › Subseção › Artigo › Parágrafo › Inciso › Alínea › Item.
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Amendment, PathKind, PathSegment, ProvisionKind, ProvisionStatus, Reference } from "../schema/dataset.ts";
import { peelAnnotations, type Link, type Peeled } from "./annotations.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface PageLayout {
  /** `name` of the anchor where the norm's text starts on the page, when it does not start at the top (the ADCT). */
  startAnchor?: string;
  /** `name` of the anchor where the norm's text ends on the page (e.g. the ADCT that follows the CF). */
  endAnchor?: string;
}

export interface ParsedProvision {
  id: string;
  kind: ProvisionKind;
  label: string;
  path: PathSegment[];
  text: string;
  status: ProvisionStatus;
  amendments: Amendment[];
  references: Reference[];
}

/** A dispositivo open on the cursor: the parent of whatever follows it at a lower level. */
interface Open {
  id: string;
  /** Path down to and including this dispositivo, as its children see it (a caput adds no segment). */
  path: PathSegment[];
}

/** Peels a source's trailing annotations off a line, keeping the wording verbatim and the annotations as metadata. */
export type AnnotationPeeler = (raw: string, links: Link[]) => Peeled;

/**
 * @param baseUrl the page's URL, against which annotation links are resolved.
 * @param peel the page's annotation style: Planalto's by default; a page laid out like Planalto's but annotated in
 * another style (Câmara LEGIN, review layer 2) brings its own.
 */
export function parsePlanaltoPage(
  html: string,
  layout: PageLayout,
  baseUrl: string,
  peel: AnnotationPeeler = peelAnnotations,
): ParsedProvision[] {
  const out: ParsedProvision[] = [];
  const groups: PathSegment[] = [];
  let article: Open | undefined;
  // The open dispositivo at each level below the article; a deeper level closes when a shallower one opens.
  let paragraph: Open | undefined;
  let inciso: Open | undefined;
  let alinea: Open | undefined;
  // Inside text quoted from another act, which belongs to the dispositivo that quotes it.
  let quoting = false;

  for (const { text: line, links, struck } of visibleLines(html, layout, baseUrl)) {
    /**
     * Records a dispositivo, or returns undefined when nothing but its label is left: the label of an old wording
     * whose text is struck ("IX - <strike>…</strike>"), possibly with the old wording's annotation outside the strike.
     */
    const emit = (parent: Open, kind: ProvisionKind, segment: PathSegment, id: string, rest: string): Open | undefined => {
      const peeled = peel(rest, links);
      const status = statusOf(peeled.text, peeled.amendments);
      if (status === "in_force" && /^[\s.,;:–-]*$/.test(peeled.text)) return undefined;
      const path = [...parent.path, segment];
      out.push({ id, kind, label: segment.label, path, status, ...peeled });
      return { id, path };
    };
    const child = (parent: Open, kind: ProvisionKind, numbered: Numbered) =>
      emit(parent, kind, { kind, label: numbered.label }, `${parent.id}_${numbered.id}`, numbered.rest);

    // Quoted text of another act ("Acrescente-se … à Lei nº 7.347 …:", then "§ 4.° …", "§ 5.° …", "… extrajudicial".)
    // is part of the commanding dispositivo: inside it nothing is a heading, an article or a label of this norm.
    if (quoting) {
      append(out.at(-1)!, line, links, peel);
      quoting = !closesQuote(line, links, peel);
      continue;
    }

    const heading = matchHeading(line);
    if (heading) {
      const depth = GROUPINGS.indexOf(heading.kind);
      while (groups.length && GROUPINGS.indexOf(groups.at(-1)!.kind) >= depth) groups.pop();
      groups.push(heading);
      article = paragraph = inciso = alinea = undefined;
      continue;
    }

    const art = matchArticle(line);
    if (art) {
      const opened: Open = { id: art.id, path: [...groups, { kind: "artigo", label: art.label }] };
      // "Art. 117. e Parágrafo único. (Revogados pela …)": one line revokes the caput and its parágrafo único.
      const withSole = /^e\s+Parágrafo único\.?\s*(.*)$/i.exec(art.rest);
      const rest = withSole ? withSole[1]! : art.rest;
      const caput = emit(opened, "caput", { kind: "caput", label: "caput" }, `${art.id}_cpt`, rest);
      if (!caput) continue;
      article = opened;
      paragraph = inciso = alinea = undefined;
      if (withSole) child(article, "paragrafo", { id: "par1", label: "parágrafo único", rest });
      continue;
    }
    // The closing formula ("Brasília, 5 de outubro de 1988.") ends the articulated text; signatures follow.
    if (/^Brasília,\s+\d/.test(line)) break;
    // Before the first article of a grouping: heading names, the preamble, page furniture.
    if (!article) continue;
    // Punctuation left behind by struck wording ("- ;").
    if (/^[\s.,;:–-]*$/.test(line)) continue;
    // A block opening with a quote mark quotes another act; it stays open until a block ends with the closing mark.
    if (!struck && /^["“]/.test(line)) {
      append(out.at(-1)!, line, links, peel);
      quoting = !closesQuote(line, links, peel);
      continue;
    }
    // LexML Parte 3: children of the caput hang under `_cpt`; the caput adds no segment to their path.
    const caput: Open = { id: `${article.id}_cpt`, path: article.path };

    const pars = matchParagraphs(line);
    if (pars) {
      let opened: Open | undefined;
      for (const par of pars) opened = child(article, "paragrafo", par) ?? opened;
      if (opened) {
        paragraph = opened;
        inciso = alinea = undefined;
      }
      continue;
    }

    const inc = matchInciso(line);
    if (inc) {
      const opened = child(paragraph ?? caput, "inciso", inc);
      if (opened) {
        inciso = opened;
        alinea = undefined;
      }
      continue;
    }

    const ali = matchAlinea(line);
    if (ali) {
      alinea = child(inciso ?? paragraph ?? caput, "alinea", ali) ?? alinea;
      continue;
    }

    const item = matchItem(line);
    if (item && (alinea ?? inciso)) {
      child((alinea ?? inciso)!, "item", item);
      continue;
    }

    // A penal sanction ("Pena - Detenção de…", often with no dash) completes the dispositivo above it: LexML gives it
    // no id of its own (it is the dispositivo's <Pena>), so it joins that dispositivo's text on a line of its own.
    if (/^Pena\b/.test(line)) {
      append(out.at(-1)!, line, links, peel);
      continue;
    }

    // What is left of a line whose label or text was struck (the full-history page): an old wording, not a dispositivo.
    if (struck) continue;
    throw new Error(`Unrecognised line inside ${article.id}: "${line.slice(0, 120)}"`);
  }

  if (quoting) throw new Error(`Quoted text opened in ${out.at(-1)!.id} is never closed`);
  return out;
}

/** Whether a line ends a quote: a closing mark at its end, before any "(NR)", final punctuation or annotations. */
function closesQuote(line: string, links: Link[], peel: AnnotationPeeler): boolean {
  return /["”]\s*(?:\(NR\))?\s*[.;]?$/.test(peel(line, links).text);
}

/** Adds a line that belongs to a dispositivo already recorded (a Pena line, quoted text) to its text and metadata. */
function append(provision: ParsedProvision, line: string, links: Link[], peel: AnnotationPeeler): void {
  const peeled = peel(line, links);
  provision.text = provision.text ? `${provision.text}\n${peeled.text}` : peeled.text;
  provision.amendments.push(...peeled.amendments);
  provision.references.push(...peeled.references);
}

/**
 * Revoked or vetoed when the page says so in the wording ("(revogado);", "revogada;", "(VETADO)") or in an annotation;
 * renumbered when only the note that its content moved is left.
 */
function statusOf(text: string, amendments: Amendment[]): ProvisionStatus {
  if (/^\(?\s*vetad[oa]s?\s*\)?\s*[.;]?$/i.test(text)) return "vetoed";
  if (/^\(?\s*revogad[oa]s?\s*\)?\s*[.;]?$/i.test(text)) return "revoked";
  if (amendments.some((a) => a.effect === "revoked")) return "revoked";
  // Nothing left but the note that the content moved to another number (CDC art. 39 XI → XIII).
  if (text === "" && amendments.some((a) => a.effect === "renumbered")) return "renumbered";
  return "in_force";
}

// --- Visible text -----------------------------------------------------------------------------------------

const BLOCKS = new Set([
  "address", "article", "blockquote", "body", "br", "center", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "li", "ol", "p", "section", "table", "td", "th", "tr", "ul",
]);
const SKIPPED = new Set(["head", "script", "style", "template"]);
/** Old wording: Planalto strikes it with any of these tags, or with CSS line-through, even on "compilado" pages. */
const STRUCK = new Set(["strike", "s", "del"]);

export interface Line {
  text: string;
  links: Link[];
  /** Whether struck text was cut out of this line. */
  struck: boolean;
}

/** Stands where struck text was cut out, so punctuation it leaves doubled can be collapsed. */
const CUT = "\uE000";
/**
 * Stands at the edge of an inline element spaced only by CSS margins (pasted DOU HTML: "o<strong style="margin-left:
 * 4px">de cujus</strong>"): a browser shows a gap there, so between two words it becomes a space.
 */
const GAP = "\uE001";

/** The page's text as a browser would show it, one line per block, with struck wording removed. */
export function visibleLines(html: string, { startAnchor, endAnchor }: PageLayout, baseUrl: string): Line[] {
  const lines: Line[] = [];
  let current = "";
  let links: { start: number; end: number; href: string }[] = [];
  let started = startAnchor === undefined;
  let ended = false;
  // Counts flushed lines, so a link that spans two blocks (its offsets no longer valid) is dropped.
  let flushed = 0;
  const flush = () => {
    const text = collapse(current);
    if (text && started) {
      const found = links
        .map((link) => ({ text: collapse(current.slice(link.start, link.end)), href: link.href }))
        .filter((link) => link.text);
      lines.push({ text, links: found, struck: current.includes(CUT) });
    }
    current = "";
    links = [];
    flushed++;
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
      if (SKIPPED.has(element.tagName)) return;
      if (STRUCK.has(element.tagName) || isLineThrough(element)) {
        current += CUT;
        return;
      }
      if (startAnchor && element.tagName === "a" && attribute(element, "name") === startAnchor) {
        current = "";
        links = [];
        started = true;
      }
      if (endAnchor && element.tagName === "a" && attribute(element, "name") === endAnchor) {
        ended = true;
        return;
      }
    }
    const block = element !== undefined && BLOCKS.has(element.tagName);
    if (block) flush();
    const margins = element && !block ? marginGaps(element) : { left: false, right: false };
    if (margins.left) current += GAP;
    const href = element?.tagName === "a" ? attribute(element, "href") : undefined;
    const start = current.length;
    const before = flushed;
    for (const child of node.childNodes) walk(child);
    if (href && flushed === before) links.push({ start, end: current.length, href: resolve(href, baseUrl) });
    if (margins.right) current += GAP;
    if (block) flush();
  };

  walk(parse(html));
  if (!ended) flush();
  return lines;
}

/** Whitespace collapsed; ", <cut>, " left by struck text mid-sentence becomes ", "; a margin gap between words, " ". */
function collapse(text: string): string {
  return text
    .replace(new RegExp(`(?<=[\\p{L}\\p{N}])\\s*${GAP}[\\s${GAP}]*(?=[\\p{L}\\p{N}])`, "gu"), " ")
    .replaceAll(GAP, "")
    .replace(/\s+/g, " ")
    .replace(new RegExp(`([,;])\\s*${CUT}\\s*\\1`, "g"), "$1")
    .replaceAll(CUT, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolve(href: string, baseUrl: string): string {
  try {
    return new URL(href.trim(), baseUrl).href;
  } catch {
    return href.trim();
  }
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

/** Whether an inline element's CSS puts a horizontal margin on its left or right edge. */
function marginGaps(element: Element): { left: boolean; right: boolean } {
  const style = attribute(element, "style") ?? "";
  const set = (side: string) => new RegExp(`margin-${side}\\s*:\\s*(?!0(?![.\\d]))[\\d.]+`, "i").test(style);
  return { left: set("left"), right: set("right") };
}

function isLineThrough(element: Element): boolean {
  return /line-through/i.test(attribute(element, "style") ?? "");
}

// --- Dispositivo labels -----------------------------------------------------------------------------------

const GROUPINGS: PathKind[] = ["parte", "livro", "titulo", "capitulo", "secao", "subsecao"];
const HEADING_KINDS: Record<string, PathKind> = {
  parte: "parte",
  livro: "livro",
  título: "titulo",
  capítulo: "capitulo",
  seção: "secao",
  subseção: "subsecao",
};

export function matchHeading(line: string): PathSegment | undefined {
  // Roman numerals with letter suffixes ("Seção V-A"), or the written-out forms of codes ("PARTE GERAL", "LIVRO PRIMEIRO").
  const m =
    /^(parte|livro|título|capítulo|seção|subseção)\s+([IVXLCDM]+(?:-[A-Z])*|geral|especial|únic[oa]|(?:primeir|segund|terceir|quart|quint|sext|sétim|oitav|non|décim)[oa])(?=\s|$)/i.exec(
      line,
    );
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  const number = /^[IVXLCDM]+(?:-[A-Z])*$/.test(m[2]!) ? m[2]! : capitalise(m[2]!.toLowerCase());
  return { kind: HEADING_KINDS[word]!, label: `${capitalise(word)} ${number}` };
}

function capitalise(word: string): string {
  return `${word[0]!.toUpperCase()}${word.slice(1)}`;
}

export interface Numbered {
  /** LexML id fragment, e.g. "art103-1", "par1", "inc10". */
  id: string;
  label: string;
  /** The text after the label. */
  rest: string;
}

export function matchArticle(line: string): Numbered | undefined {
  const m = /^Art\.\s*(\d+)(.*)$/.exec(line);
  if (!m) return undefined;
  const n = Number(m[1]);
  const { suffix, rest } = ordinalAndSuffix(n, m[2]!);
  return { id: `art${n}${suffixId(suffix)}`, label: `Art. ${n}${n < 10 ? "º" : ""}${suffix}`, rest };
}

/** One parágrafo, or several when the page groups them ("§§ 1º a 3º. (Revogados pela …)"). */
export function matchParagraphs(line: string): Numbered[] | undefined {
  const group = /^§§\s*(\d+)\s*[º°o]?\s*a\s*(\d+)\s*[º°o]?\s*\.?\s*(.*)$/.exec(line);
  if (group) {
    const out: Numbered[] = [];
    for (let n = Number(group[1]); n <= Number(group[2]); n++) out.push({ id: `par${n}`, label: paragraphLabel(n, ""), rest: group[3]! });
    return out;
  }
  const unico = /^Parágrafo único\s*[.:\-–]?\s*(.*)$/i.exec(line);
  if (unico) return [{ id: "par1", label: "parágrafo único", rest: unico[1]! }];
  const m = /^§\s*(\d+)(.*)$/.exec(line);
  // CF art. 215 §§ 2º and 3º are printed without the "§" ("2º A lei disporá…").
  const bare = m ? undefined : /^(\d)º(\s+[A-ZÀ-Ú].*)$/.exec(line);
  const found = m ?? bare;
  if (!found) return undefined;
  const n = Number(found[1]);
  const { suffix, rest } = ordinalAndSuffix(n, found[2]!);
  return [{ id: `par${n}${suffixId(suffix)}`, label: paragraphLabel(n, suffix), rest }];
}

function paragraphLabel(n: number, suffix: string): string {
  return `§ ${n}${n < 10 ? "º" : ""}${suffix}`;
}

export function matchInciso(line: string): Numbered | undefined {
  // The letter suffix is glued to the numeral ("II-A - …"), so "I - A República…" stays an inciso I.
  // 66 CF incisos lack the separator ("IV as ilhas fluviais…", "I-A o Conselho Nacional de Justiça"): without one,
  // the text must start in lower case, so a line of prose that opens with a capital "I" is not read as an inciso.
  const m = /^([IVXLCDM]+)((?:-[A-Z])*)(?:\s*[-–]\s*|\s+(?=[a-zà-úç(]))(.*)$/.exec(line);
  if (!m) return undefined;
  const n = romanToNumber(m[1]!);
  if (n === undefined) return undefined;
  const suffix = m[2] ?? "";
  return { id: `inc${n}${suffixId(suffix)}`, label: `inciso ${m[1]}${suffix}`, rest: m[3]! };
}

export function matchAlinea(line: string): Numbered | undefined {
  // Two alíneas on the CF page lack the space after the parenthesis ("a)sobre a entrada…").
  const m = /^([a-z])((?:-[A-Z])*)\)\s*(.*)$/.exec(line);
  if (!m) return undefined;
  const suffix = m[2]!;
  return { id: `ali${m[1]!.charCodeAt(0) - 96}${suffixId(suffix)}`, label: `alínea ${m[1]}${suffix}`, rest: m[3]! };
}

export function matchItem(line: string): Numbered | undefined {
  const m = /^(\d+)((?:-[A-Z])*)\)\s*(.*)$/.exec(line);
  if (!m) return undefined;
  const suffix = m[2]!;
  return { id: `ite${Number(m[1])}${suffixId(suffix)}`, label: `item ${Number(m[1])}${suffix}`, rest: m[3]! };
}

/**
 * Splits what follows an article or paragraph number: an ordinal mark (º, °, or a superscript "o" that the page
 * leaves as " o" when pretty-printed; ordinals only go up to the ninth), letter suffixes ("-A-B") and a separator.
 */
function ordinalAndSuffix(n: number, after: string): { suffix: string; rest: string } {
  // "§ 4.º" (art. 103) puts the period before the ordinal.
  let rest = after.replace(/^\.?\s*[º°]/, "");
  if (n < 10 && rest === after) rest = after.replace(/^\s*o(?=[\s.\-–]|$)/, "");
  const suffix = /^\s*((?:-[A-Z](?![a-zà-ú]))*)/.exec(rest)![1]!;
  rest = rest.replace(/^\s*(?:-[A-Z](?![a-zà-ú]))*/, "").replace(/^\s*[.\-–]?\s*/, "");
  return { suffix, rest };
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

// Reads an amending act's official page (an EC on Planalto) for the changes it defers: its vigência clause says which
// of its articles take effect later and when, its quoted blocks give the new wording, and its revocation article
// lists what ends and when. Changes in force at publication are not returned: the compiled page already shows them.
import type { ActCitation } from "../schema/dataset.ts";
import { peelAnnotations } from "./annotations.ts";
import {
  matchAlinea,
  matchArticle,
  matchHeading,
  matchInciso,
  matchItem,
  matchParagraphs,
  visibleLines,
  type Line,
  type Numbered,
} from "./planalto.ts";
import { effectiveDate } from "./vigencia-dates.ts";

export interface AmendingAct {
  act: ActCitation;
  /** Publication date in the DOU (YYYY-MM-DD), from which vacatio periods count. */
  published: string;
  changes: DeferredChange[];
}

/** One dispositivo an act changes later than its publication. */
export interface DeferredChange {
  /** How the act names the norm, e.g. "Constituição Federal"; matched against the manifests' `citedAs`. */
  norm: string;
  /** LexML id of the dispositivo the act cites or quotes; a revocation also ends everything under it. */
  id: string;
  /** `text`: the act quotes a wording for it; `revoked`: it ends (a revocation list, or "(Revogado)" quoted). */
  kind: "text" | "revoked";
  /** The quoted wording, without its label and annotations. */
  text?: string;
  /** The quoted label, e.g. "§ 17" (for a dispositivo the act inserts). */
  label?: string;
  effectiveFrom: string;
  /** The vigência clause as printed. */
  vigencia: string;
}

/** The ways an act names the norms it amends, longest first so the ADCT is not read as "Constituição". */
const NORM_NAMES = ["Ato das Disposições Constitucionais Transitórias", "Constituição Federal"];

export function readAmendingAct(html: string, url: string): AmendingAct {
  const lines = visibleLines(html, {}, url);
  const act = citationOf(lines, url);
  const published = publicationDate(lines, url);
  const articles = splitArticles(lines);

  const vigenciaArticle = articles.find((a) => /^Esta Emenda (?:Constitucional|à Constituição) entra em vigor/.test(a.head));
  if (!vigenciaArticle) throw new Error(`${url}: no vigência article found`);
  const clauses = vigenciaClauses(vigenciaArticle, url);

  const changes: DeferredChange[] = [];
  for (const clause of clauses) {
    if (clause.when === "publication") continue;
    const effectiveFrom = effectiveDate(clause.when, published);
    for (const subject of clause.subjects) {
      const article = articles.find((a) => a.number === subject.article);
      if (!article) throw new Error(`${url}: vigência cites art. ${subject.article}, which the act does not have`);
      // An autonomous article (a rule of its own, not a change to the norm's text) has nothing to stage.
      if (!isAlteration(article)) continue;
      for (const change of quotedChanges(article, url)) {
        if (subject.only && !(change.norm === subject.only.norm && isUnder(change.id, subject.only.id))) continue;
        changes.push({ ...change, effectiveFrom, vigencia: clause.text });
      }
    }
  }
  for (const article of articles.filter(isRevocation)) changes.push(...deferredRevocations(article, published, url));

  return { act, published, changes };
}

// --- Page anatomy -----------------------------------------------------------------------------------------

function citationOf(lines: Line[], url: string): ActCitation {
  const title = lines.map((l) => /^EMENDA CONSTITUCIONAL N[º°o]\s*(\d+),\s*DE\s+\d+\s+DE\s+\S+\s+DE\s+(\d{4})/i.exec(l.text)).find(Boolean);
  if (!title) throw new Error(`${url}: not an Emenda Constitucional page (no title line)`);
  const number = title[1]!;
  const year = Number(title[2]);
  return { citation: `Emenda Constitucional nº ${number}, de ${year}`, type: "emenda_constitucional", number, year, href: url };
}

/** "Este texto não substitui o publicado no DOU 16.10.2026 - Edição extra" → 2026-10-16. */
function publicationDate(lines: Line[], url: string): string {
  const dou = lines.map((l) => /publicado no DOU\s+(?:de\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(l.text)).find(Boolean);
  if (!dou) throw new Error(`${url}: no DOU publication date found`);
  return `${dou[3]}-${dou[2]!.padStart(2, "0")}-${dou[1]!.padStart(2, "0")}`;
}

interface ActArticle {
  number: number;
  /** The article's first sentence, without its label. */
  head: string;
  /** Every line after the label line, quoted ones flagged. */
  body: { text: string; quoted: boolean; links: Line["links"] }[];
}

const OPEN_QUOTE = /^["“]/;
const CLOSE_QUOTE = /["”]\s*(?:\(NR\)?)?\s*\.?$/;

/** The act's own articles, in order. Quoted dispositivos ("Art. 7º ......") belong to the article that quotes them. */
function splitArticles(lines: Line[]): ActArticle[] {
  const articles: ActArticle[] = [];
  let quoting = false;
  for (const line of lines) {
    if (/^Brasília,/.test(line.text)) break;
    const quoted: boolean = quoting || OPEN_QUOTE.test(line.text);
    if (!quoted) {
      const art = matchArticle(line.text);
      // The act's articles run 1, 2, 3…; anything else that looks like one is quoted text.
      if (art && art.id === `art${articles.length + 1}`) {
        articles.push({ number: articles.length + 1, head: art.rest, body: [] });
        continue;
      }
    }
    articles.at(-1)?.body.push({ text: line.text, quoted, links: line.links });
    quoting = quoted && !CLOSE_QUOTE.test(line.text.replace(OPEN_QUOTE, ""));
  }
  return articles;
}

function isAlteration(article: ActArticle): boolean {
  return /\bpassa(?:m)? a vigorar\b/.test(article.head);
}

function isRevocation(article: ActArticle): boolean {
  return /^(?:Revogam-se|Ficam revogad[oa]s)\b/.test(article.head);
}

function normNamed(text: string): string | undefined {
  return NORM_NAMES.find((name) => text.includes(name));
}

// --- Vigência clause --------------------------------------------------------------------------------------

export type When =
  | "publication"
  | { after: number; unit: "dias" | "meses" | "anos" }
  | { year: number };

interface Clause {
  text: string;
  when: When;
  /** What the clause covers: articles of the act, optionally narrowed to one cited dispositivo. Empty: "demais". */
  subjects: { article: number; only?: { norm: string; id: string } }[];
}

function vigenciaClauses(article: ActArticle, url: string): Clause[] {
  const single = /^Esta Emenda (?:Constitucional|à Constituição) entra em vigor\s*(.+?)\.?$/.exec(article.head)!;
  if (!single[1]!.endsWith(":")) {
    // "… entra em vigor na data de sua publicação." Anything else in one sentence is a form this reader doesn't know.
    if (/^na data de sua publicação$/.test(single[1]!)) return [{ text: single[1]!, when: "publication", subjects: [] }];
    throw new Error(`${url}: vigência clause not understood: "${article.head}"`);
  }
  const clauses: Clause[] = [];
  for (const { text: line } of article.body) {
    const item = /^[IVX]+\s*-\s*(.+?)(?:;\s*e|;|\.)?$/.exec(line);
    if (!item) throw new Error(`${url}: vigência item not understood: "${line}"`);
    const text = item[1]!;
    const split = /^(.+?), (?:em relação|quanto) (.+)$/.exec(text);
    if (!split) throw new Error(`${url}: vigência item not understood: "${line}"`);
    clauses.push({ text, when: whenOf(split[1]!, url), subjects: subjectsOf(split[2]!, url) });
  }
  return clauses;
}

function whenOf(text: string, url: string): When {
  if (/^na data de sua publicação$/.test(text)) return "publication";
  const after = /^após decorridos (\d+) \([^)]*\) (dias|meses|anos) de sua publicação$/.exec(text);
  if (after) return { after: Number(after[1]), unit: after[2] as "dias" | "meses" | "anos" };
  const year = /^em (\d{4})$/.exec(text);
  if (year) return { year: Number(year[1]) };
  // Event-based or conditional starts ("a partir do início da primeira legislatura…", "na data de publicação de lei…")
  // have no date to compute: a person must decide, so the build stops rather than guess.
  throw new Error(`${url}: vigência "${text}" gives no computable date`);
}

function subjectsOf(text: string, url: string): Clause["subjects"] {
  if (/^aos demais dispositivos$/.test(text)) return [];
  const articles = /^aos? arts?\. (.+)$/.exec(text);
  if (articles) return numberList(articles[1]!).map((article) => ({ article }));
  const narrowed = /^à alteração promovida pelo art\. (\d+)[º°o]? desta Emenda Constitucional n[oa] (.+)$/.exec(text);
  if (narrowed) {
    const { norm, id } = descending(narrowed[2]!, url);
    return [{ article: Number(narrowed[1]), only: { norm, id } }];
  }
  throw new Error(`${url}: vigência subject not understood: "${text}"`);
}

/** "3º e 11", "4º e 5º", "11, 28 e 32" → [3, 11]… */
function numberList(text: string): number[] {
  return text.split(/\s*,\s*|\s+e\s+/).map((n) => Number(/^(\d+)/.exec(n.trim())?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
}

// --- Citations --------------------------------------------------------------------------------------------

/** "inciso XV do caput do art. 7º da Constituição Federal": innermost unit first, chained by "do"/"da". */
function descending(text: string, url: string): { norm: string; id: string } {
  const norm = normNamed(text);
  if (!norm) throw new Error(`${url}: citation names no known norm: "${text}"`);
  const units = text.slice(0, text.lastIndexOf(norm)).replace(/\s+d[oa]\s*$/, "").split(/\s+d[oa]\s+/).reverse();
  const parts: string[] = [];
  for (const unit of units) {
    const part = unitId(unit.trim());
    if (!part) throw new Error(`${url}: citation unit not understood: "${unit}" in "${text}"`);
    parts.push(part);
  }
  return { norm, id: parts.join("_") };
}

function unitId(unit: string): string | undefined {
  const art = matchArticle(unit.replace(/^art\./, "Art."));
  if (art && !art.rest) return art.id;
  if (unit === "caput") return "cpt";
  const inciso = /^inciso ([IVXLC]+(?:-[A-Z])*)$/.exec(unit);
  if (inciso) return matchInciso(`${inciso[1]} - x`)?.id;
  const par = /^(§\s*\d+.*|parágrafo único)$/.exec(unit);
  if (par) return matchParagraphs(par[1] === "parágrafo único" ? "Parágrafo único" : `${par[1]} x`)?.[0]?.id;
  const alinea = /^alínea ["“]([a-z])["”]$/.exec(unit);
  if (alinea) return matchAlinea(`${alinea[1]}) x`)?.id;
  return undefined;
}

/**
 * The compact style of revocation lists: "art. 195, I, "b", e IV, e § 12", "arts. 155, II, e §§ 2º a 5º, 156, III…".
 * A bare number starts an article, a Roman numeral is an inciso of its caput, a quoted letter an alínea of the inciso
 * before it, "§ N" a parágrafo. A unit is cited unless the next one hangs under it ("195, I, "b"" cites only the alínea).
 */
function compact(text: string, url: string): string[] {
  const tokens = text
    .replace(/^arts?\.\s*/, "")
    .split(/\s*,\s*/)
    .map((t) => t.replace(/^e\s+/, "").trim())
    .filter(Boolean);
  const cited: string[] = [];
  let article: string | undefined;
  let inciso: string | undefined;
  for (const token of tokens) {
    let ids: string[];
    if (/^\d+[º°o]?(?:-[A-Z])*$/.test(token)) {
      article = matchArticle(`Art. ${token}`)!.id;
      inciso = undefined;
      ids = [article];
    } else if (/^[IVXLC]+(?:-[A-Z])*$/.test(token) && article) {
      inciso = `${article}_cpt_${matchInciso(`${token} - x`)!.id}`;
      ids = [inciso];
    } else if (/^["“][a-z]["”]$/.test(token) && inciso) {
      ids = [`${inciso}_${matchAlinea(`${token[1]}) x`)!.id}`];
    } else if (/^§§?\s*\d/.test(token) && article) {
      const range = /^§§\s*(\d+)[º°o]?\s+a\s+(\d+)[º°o]?$/.exec(token);
      const numbers = range ? span(Number(range[1]), Number(range[2])) : [Number(/\d+/.exec(token)![0])];
      if (!range && !/^§\s*\d+[º°o]?$/.test(token)) throw new Error(`${url}: citation unit not understood: "${token}"`);
      ids = numbers.map((n) => `${article}_par${n}`);
      inciso = undefined;
    } else {
      throw new Error(`${url}: citation unit not understood: "${token}" in "${text}"`);
    }
    // The previous unit is only a path to this one when this one hangs under it.
    const last = cited.at(-1);
    if (last && ids.some((id) => id.startsWith(`${last}_`))) cited.pop();
    cited.push(...ids);
  }
  return cited;
}

function span(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Whether `id` is `root` or a dispositivo under it (an article id covers its caput and everything below). */
export function isUnder(id: string, root: string): boolean {
  return id === root || id.startsWith(`${root}_`);
}

// --- Quoted blocks ----------------------------------------------------------------------------------------

/** The dispositivos an alteration article quotes with a wording (or "(Revogado)"), read with the parser's cursor. */
function quotedChanges(article: ActArticle, url: string): Omit<DeferredChange, "effectiveFrom" | "vigencia">[] {
  const norm = normNamed(article.head);
  if (!norm) return []; // e.g. "O art. 3º da Emenda Constitucional nº 113 … passa a vigorar": outside the corpus.
  const out: Omit<DeferredChange, "effectiveFrom" | "vigencia">[] = [];
  let art: string | undefined;
  let paragraph: string | undefined;
  let inciso: string | undefined;
  let alinea: string | undefined;

  for (const line of article.body.filter((l) => l.quoted)) {
    // The block's closing quote follows the dispositivo's own final period: `… deste artigo." (NR)`.
    const text = line.text.replace(OPEN_QUOTE, "").replace(/\s*["”]\s*(?:\(NR\)?)?\s*$/, "");
    if (/^[.…\s]*$/.test(text) || matchHeading(text)) continue;
    const record = (id: string, numbered: Numbered) => {
      const peeled = peelAnnotations(numbered.rest, line.links);
      if (/^[.…\s]*$/.test(peeled.text)) return; // a placeholder ("III - ......"): it only moves the cursor
      const revoked = /^\(?\s*revogad[oa]s?\s*\)?\s*[.;]?$/i.test(peeled.text);
      out.push(revoked ? { norm, id, kind: "revoked", label: numbered.label } : { norm, id, kind: "text", text: peeled.text, label: numbered.label });
    };

    const a = matchArticle(text);
    if (a) {
      art = a.id;
      paragraph = inciso = alinea = undefined;
      record(`${art}_cpt`, a);
      continue;
    }
    if (!art) throw new Error(`${url}: quoted line before any quoted article: "${text.slice(0, 80)}"`);
    const pars = matchParagraphs(text);
    if (pars && pars.length === 1) {
      paragraph = `${art}_${pars[0]!.id}`;
      inciso = alinea = undefined;
      record(paragraph, pars[0]!);
      continue;
    }
    const inc = matchInciso(text);
    if (inc) {
      inciso = `${paragraph ?? `${art}_cpt`}_${inc.id}`;
      alinea = undefined;
      record(inciso, inc);
      continue;
    }
    const ali = matchAlinea(text);
    if (ali) {
      alinea = `${inciso ?? paragraph ?? `${art}_cpt`}_${ali.id}`;
      record(alinea, ali);
      continue;
    }
    const item = matchItem(text);
    if (item && (alinea ?? inciso)) {
      record(`${alinea ?? inciso}_${item.id}`, item);
      continue;
    }
    throw new Error(`${url}: quoted line not understood in art. ${article.number}: "${text.slice(0, 80)}"`);
  }
  return out;
}

// --- Revocations ------------------------------------------------------------------------------------------

/**
 * Items of a revocation article that carry their own later date ("I - em 2027, o art. 195, I, "b", … da Constituição
 * Federal;", "II - em 2033:" followed by alíneas). Items without a date take effect with the act and are skipped.
 */
function deferredRevocations(article: ActArticle, published: string, url: string): DeferredChange[] {
  const out: DeferredChange[] = [];
  let pending: { when: Exclude<When, "publication">; printed: string } | undefined;
  for (const { text: line } of article.body) {
    const top = /^[IVX]+\s*-\s*(.+)$/.exec(line);
    const sub = top ? undefined : /^[a-z]\)\s*(.+)$/.exec(line);
    if (!top && !sub) continue;
    let body = (top ?? sub)![1]!;
    if (top) {
      const dated = /^(em \d{4})[,:]\s*(.*)$/.exec(body);
      pending = dated ? { when: { year: Number(dated[1]!.slice(3)) }, printed: trimItem(body) } : undefined;
      if (dated) body = dated[2]!;
    }
    if (!pending || !body) continue; // undated items take effect with the act; "II - em 2033:" leaves it to its alíneas
    const citation = trimItem(body).replace(/^(?:o|os|a|as)\s+/, "");
    const norm = normNamed(citation);
    if (!norm) throw new Error(`${url}: revocation names no known norm: "${line}"`);
    const cited = citation.slice(0, citation.lastIndexOf(norm)).replace(/,?\s+d[oa]\s*$/, "").trim();
    // As printed: the dated item, and for an alínea the item that dates it ("em 2033: a) os arts. 155, …").
    const vigencia = top ? pending.printed : `${pending.printed} ${trimItem(line)}`;
    const effectiveFrom = effectiveDate(pending.when, published);
    for (const id of compact(cited, url)) out.push({ norm, id, kind: "revoked", effectiveFrom, vigencia });
  }
  return out;
}

/** An enumerated item without its closing punctuation ("…;", "…; e", "….") */
function trimItem(text: string): string {
  return text.replace(/\s*(?:;\s*e|;|\.)$/, "").trim();
}

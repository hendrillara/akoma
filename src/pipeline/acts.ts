// Reads an amending act's official page on Planalto (an EC, a law, a lei complementar, a medida provisória) for the
// changes it defers: its vigência clause says which of its articles take effect later and when, its quoted blocks give
// the new wording, and its revocation article lists what ends and when. Changes in force at publication are not
// returned: the compiled page already shows them. Every function takes the ways the acts name the corpus's norms (the
// manifests' `citedAs`), so a law's "O art. 49 da Lei nº 8.078, de 11 de setembro de 1990, passa a vigorar…" reads
// like an EC's "O art. 7º da Constituição Federal passa a vigorar…".
import type { ActCitation, ActType } from "../schema/dataset.ts";
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

/** The ways acts name the CF and the ADCT (the default when no manifest names are given). */
export const NORM_NAMES = ["Ato das Disposições Constitucionais Transitórias", "Constituição Federal"];

/** How an act calls itself: "Esta Emenda Constitucional", "Esta Lei", "desta Medida Provisória"… */
const SELF = "(?:Emenda Constitucional|Emenda à Constituição|Lei Complementar|Lei|Medida Provisória|Decreto-Lei)";
const VIGENCIA = new RegExp(`^Est[ae] ${SELF} entra em vigor\\s*(.+?)\\.?$`);

export function readAmendingAct(html: string, url: string, names: string[] = NORM_NAMES): AmendingAct {
  const norms = byLength(names);
  const lines = visibleLines(html, {}, url);
  const act = citationOf(lines, url);
  const published = publicationDate(lines, url);
  const articles = splitArticles(lines);

  const vigenciaArticle = articles.find((a) => VIGENCIA.test(a.head));
  if (!vigenciaArticle) throw new Error(`${url}: no vigência article found`);
  const clauses = vigenciaClauses(vigenciaArticle, articles, norms, url);

  const changes: DeferredChange[] = [];
  for (const clause of clauses) {
    if (clause.when === "publication") continue;
    const effectiveFrom = effectiveDate(clause.when, published);
    for (const subject of clause.subjects) {
      const article = articles.find((a) => a.number === subject.article);
      if (!article) throw new Error(`${url}: vigência cites art. ${subject.article}, which the act does not have`);
      // An autonomous article (a rule of its own, not a change to the norm's text) has nothing to stage.
      if (!isAlteration(article)) continue;
      for (const change of quotedChanges(article, norms, url)) {
        if (subject.only && !(change.norm === subject.only.norm && isUnder(change.id, subject.only.id))) continue;
        changes.push({ ...change, effectiveFrom, vigencia: clause.text });
      }
    }
  }
  for (const article of articles.filter(isRevocation)) changes.push(...deferredRevocations(article, published, norms, url));

  return { act, published, changes };
}

// --- Page anatomy -----------------------------------------------------------------------------------------

/** The title line's kind of act → its type and how annotations cite it ("Lei nº 14.181, de 2021"). */
const KINDS: { title: RegExp; type: ActType; name: string }[] = [
  { title: /^EMENDA CONSTITUCIONAL$/i, type: "emenda_constitucional", name: "Emenda Constitucional" },
  { title: /^LEI COMPLEMENTAR$/i, type: "lei_complementar", name: "Lei Complementar" },
  { title: /^LEI$/i, type: "lei", name: "Lei" },
  { title: /^MEDIDA PROVIS[ÓO]RIA$/i, type: "medida_provisoria", name: "Medida Provisória" },
  { title: /^DECRETO-LEI$/i, type: "decreto_lei", name: "Decreto-Lei" },
];

/** The act a page is the page of, from its title line (throws when it has none). */
export function readActCitation(html: string, url: string): ActCitation {
  return citationOf(visibleLines(html, {}, url), url);
}

/** "EMENDA CONSTITUCIONAL Nº 141, DE 16 DE OUTUBRO DE 2026", "LEI Nº 14.181, DE 1º DE JULHO DE 2021"… */
function citationOf(lines: Line[], url: string): ActCitation {
  const pattern = /^(EMENDA CONSTITUCIONAL|LEI COMPLEMENTAR|LEI|MEDIDA PROVIS[ÓO]RIA|DECRETO-LEI) N[º°o]\s*(\d[\d.]*(?:-\d+)?),\s*DE\s+\d+[º°o]?\s+DE\s+\S+\s+DE\s+(\d{4})/i;
  const title = lines.map((l) => pattern.exec(l.text)).find(Boolean);
  if (!title) throw new Error(`${url}: not the page of an amending act (no title line)`);
  const kind = KINDS.find((k) => k.title.test(title[1]!))!;
  const number = title[2]!;
  const year = Number(title[3]);
  return { citation: `${kind.name} nº ${number}, de ${year}`, type: kind.type, number, year, href: url };
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
/** A quoted line without its quotes: a law nests single quotes for what it inserts ("“‘CAPÍTULO VI-A", "‘Art. 54-A."). */
const unquoted = (text: string) => text.replace(/^["“‘]+/, "").replace(/\s*["”’]+\s*(?:\(NR\)?)?\s*$/, "");
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

const REVOKES = /^(?:Revoga(?:m)?-se|Fica(?:m)? revogad[oa]s?)\b/;

function isRevocation(article: ActArticle): boolean {
  return REVOKES.test(article.head);
}

/** Longest first, so the ADCT is not read as "Constituição". */
function byLength(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}

/**
 * Where `text` last names the norm `name`: as the manifest spells it, or, for a law named with its date ("Lei nº 8.078,
 * de 11 de setembro de 1990"), by its type and number alone, since acts also write "Lei nº 8.078, de 1990". -1: nowhere.
 */
function lastAt(text: string, name: string): number {
  const at = text.lastIndexOf(name);
  if (at >= 0) return at;
  const short = /^((?:Lei Complementar|Lei|Decreto-Lei|Medida Provisória) nº [\d.]+),/.exec(name)?.[1];
  if (!short) return -1;
  const matches = [...text.matchAll(new RegExp(`${short.replace(/\./g, "\\.")}(?![\\d.]*\\d)`, "g"))];
  return matches.at(-1)?.index ?? -1;
}

function normNamed(text: string, names: string[]): string | undefined {
  return names.find((name) => lastAt(text, name) >= 0);
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

function vigenciaClauses(article: ActArticle, articles: ActArticle[], names: string[], url: string): Clause[] {
  const single = VIGENCIA.exec(article.head)!;
  if (!single[1]!.endsWith(":")) {
    // "… entra em vigor na data de sua publicação." A whole act deferred in one sentence ("Esta Lei entra em vigor após
    // decorridos 180 (cento e oitenta) dias de sua publicação oficial.") covers every article.
    const when = whenOf(single[1]!, url);
    return [{ text: single[1]!, when, subjects: when === "publication" ? [] : articles.map((a) => ({ article: a.number })) }];
  }
  const clauses: Clause[] = [];
  for (const { text: line } of article.body) {
    const item = /^[IVX]+\s*-\s*(.+?)(?:;\s*e|;|\.)?$/.exec(line);
    if (!item) throw new Error(`${url}: vigência item not understood: "${line}"`);
    const text = item[1]!;
    const split = /^(.+?), (?:em relação|quanto) (.+)$/.exec(text);
    if (!split) throw new Error(`${url}: vigência item not understood: "${line}"`);
    clauses.push({ text, when: whenOf(split[1]!, url), subjects: subjectsOf(split[2]!, names, url) });
  }
  return clauses;
}

function whenOf(text: string, url: string): When {
  if (/^na data de sua publicação(?: oficial)?$/.test(text)) return "publication";
  const after = /^após decorridos (\d+) \([^)]*\) (dias|meses|anos) de sua publicação(?: oficial)?$/.exec(text);
  if (after) return { after: Number(after[1]), unit: after[2] as "dias" | "meses" | "anos" };
  const year = /^em (\d{4})$/.exec(text);
  if (year) return { year: Number(year[1]) };
  // Event-based or conditional starts ("a partir do início da primeira legislatura…", "na data de publicação de lei…")
  // have no date to compute: a person must decide, so the build stops rather than guess.
  throw new Error(`${url}: vigência "${text}" gives no computable date`);
}

function subjectsOf(text: string, names: string[], url: string): Clause["subjects"] {
  if (/^aos demais dispositivos$/.test(text)) return [];
  const articles = /^aos? arts?\. (.+)$/.exec(text);
  if (articles) return numberList(articles[1]!).map((article) => ({ article }));
  const narrowed = new RegExp(`^à alteração promovida pelo art\\. (\\d+)[º°o]? dest[ae] ${SELF} n[oa] (.+)$`).exec(text);
  if (narrowed) {
    const { norm, id } = descending(narrowed[2]!, names, url);
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
function descending(text: string, names: string[], url: string): { norm: string; id: string } {
  const norm = normNamed(text, names);
  if (!norm) throw new Error(`${url}: citation names no known norm: "${text}"`);
  return { norm, id: descendingId(text.slice(0, lastAt(text, norm)).replace(/\s+d[oa]\s*$/, ""), url) };
}

/** The dispositivo part of a descending citation, without its norm: "inciso XV do caput do art. 7º" → art7_cpt_inc15. */
function descendingId(text: string, url: string): string {
  const units = text.split(/\s+d[oa]\s+/).reverse();
  const parts: string[] = [];
  for (const unit of units) {
    const part = unitId(unit.trim());
    if (!part) throw new Error(`${url}: citation unit not understood: "${unit}" in "${text}"`);
    parts.push(part);
  }
  // A caput inciso is often cited without "do caput" ("o inciso XV do art. 7º"): LexML still hangs it under `_cpt`.
  if (parts.length > 1 && /^inc/.test(parts[1]!)) parts.splice(1, 0, "cpt");
  return parts.join("_");
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
function quotedChanges(article: ActArticle, names: string[], url: string): Omit<DeferredChange, "effectiveFrom" | "vigencia">[] {
  const norm = normNamed(article.head, names);
  if (!norm) return []; // e.g. "O art. 3º da Emenda Constitucional nº 113 … passa a vigorar": outside the corpus.
  const out: Omit<DeferredChange, "effectiveFrom" | "vigencia">[] = [];
  let art: string | undefined;
  let paragraph: string | undefined;
  let inciso: string | undefined;
  let alinea: string | undefined;

  // A quoted grouping heading ("Seção V-A") is followed by its name ("Do Imposto de Competência Compartilhada …").
  let headingName = false;
  for (const line of article.body.filter((l) => l.quoted)) {
    // The block's closing quote follows the dispositivo's own final period: `… deste artigo." (NR)`.
    const text = unquoted(line.text);
    if (/^[.…\s]*$/.test(text)) continue;
    if (matchHeading(text)) {
      headingName = true;
      continue;
    }
    const named = headingName;
    headingName = false;
    if (named && !matchArticle(text) && !matchParagraphs(text) && !matchInciso(text) && !matchAlinea(text)) continue;
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
function deferredRevocations(article: ActArticle, published: string, names: string[], url: string): DeferredChange[] {
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
    const norm = normNamed(citation, names);
    if (!norm) throw new Error(`${url}: revocation names no known norm: "${line}"`);
    const cited = citation.slice(0, lastAt(citation, norm)).replace(/,?\s+d[oa]\s*$/, "").trim();
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

// --- Every command, for target matching (review, #10) -------------------------------------------------------

/** A dispositivo an act's commands target, whenever the change takes effect. */
export interface ActTarget {
  /** How the act names the norm, e.g. "Constituição Federal"; matched against the manifests' `citedAs`. */
  norm: string;
  id: string;
  /** The act's own article holding the command. */
  article: number;
  /**
   * `quoted`: given a wording (or "(Revogado)") in quotes; `renumbered`: the parágrafo único the command sentence
   * renumbers ("numerado o parágrafo único como § 1º", same LexML id); `revoked`: cited by a revocation article.
   */
  how: "quoted" | "renumbered" | "revoked";
}

export interface ActCommands {
  act: ActCitation;
  /** In the order the act gives them, each dispositivo once. */
  targets: ActTarget[];
  /** Commands this reader does not understand, one per article: a review must never pass over them. */
  problems: string[];
}

/**
 * Every dispositivo the act's alteration and revocation articles target, in force at publication or deferred.
 * Unlike `readAmendingAct`, an article it cannot read becomes a problem instead of an exception, so a review can
 * report it. Commands on texts outside the named norms (another EC, e.g. EC 136 on EC 113) are skipped.
 */
export function readActCommands(html: string, url: string, names: string[] = NORM_NAMES): ActCommands {
  const norms = byLength(names);
  const lines = visibleLines(html, {}, url);
  const act = citationOf(lines, url);
  const targets: ActTarget[] = [];
  const problems: string[] = [];
  const add = (target: ActTarget) => {
    if (!targets.some((t) => t.norm === target.norm && t.id === target.id)) targets.push(target);
  };

  for (const article of splitArticles(lines)) {
    try {
      if (isAlteration(article)) {
        for (const { norm, id } of quotedChanges(article, norms, url)) add({ norm, id, article: article.number, how: "quoted" });
        const norm = normNamed(article.head, norms);
        if (norm && /numerad[oa] o parágrafo único como § 1º/.test(article.head)) {
          const quoted = article.body.find((l) => l.quoted && matchArticle(l.text.replace(OPEN_QUOTE, "")));
          if (!quoted) throw new Error(`${url}: renumbers a parágrafo único but quotes no article`);
          add({ norm, id: `${matchArticle(quoted.text.replace(OPEN_QUOTE, ""))!.id}_par1`, article: article.number, how: "renumbered" });
        }
      } else if (isRevocation(article)) {
        for (const { norm, id } of revokedTargets(article, norms, url)) add({ norm, id, article: article.number, how: "revoked" });
      }
    } catch (error) {
      problems.push(`art. ${article.number}: ${(error as Error).message.replace(`${url}: `, "")}`);
    }
  }
  return { act, targets, problems };
}

/**
 * What a revocation article cites, dated or not: in its own sentence ("Revoga-se o inciso XXVII do caput do art. 7º
 * da Constituição Federal.") or in its items ("I - em 2027, o art. 195, I, "b", e IV, e § 12, da Constituição
 * Federal;"). An item ending in ":" ("I - os seguintes dispositivos da Constituição Federal:") names the norm of the
 * alíneas under it.
 */
function revokedTargets(article: ActArticle, names: string[], url: string): { norm: string; id: string }[] {
  const out: { norm: string; id: string }[] = [];
  let inherited: string | undefined;
  const cite = (raw: string, item: boolean) => {
    let text = raw.replace(/\s*\(Vigência\)\s*$/, "").replace(/^em \d{4}[,:]?\s*/, "");
    if (!text) return;
    if (text.endsWith(":")) {
      if (item) inherited = normNamed(text, names) ?? inherited;
      return;
    }
    text = trimItem(text).replace(/^(?:o|os|a|as)\s+/, "");
    const named = normNamed(text, names);
    // Another act's own text ("o art. 3º da Emenda Constitucional nº 113", "a Lei nº 9.999, de …"): outside the corpus.
    if (!named && new RegExp(`${SELF} nº`).test(text)) return;
    const norm = named ?? inherited;
    if (!norm) throw new Error(`${url}: revocation names no known norm: "${raw}"`);
    const path = named ? text.slice(0, lastAt(text, named)).replace(/,?\s+d[oa]\s*$/, "").trim() : text;
    const ids = /^arts?\.\s*\d+[º°o]?(?:-[A-Z])*\s*,/.test(path) || /^arts\./.test(path) ? compact(path, url) : [descendingId(path, url)];
    for (const id of ids) out.push({ norm, id });
  };
  cite(article.head.replace(REVOKES, "").replace(/^\s*:?\s*/, ""), false);
  for (const { text } of article.body) {
    const item = /^(?:[IVX]+\s*-|[a-z]\))\s*(.+)$/.exec(text);
    if (item) cite(item[1]!, true);
  }
  return out;
}

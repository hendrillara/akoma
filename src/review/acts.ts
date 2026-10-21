// Reads an amending act's commands from its official Planalto page: which dispositivos of the CF or the ADCT it
// targets. The quoted new text is the reliable source of targets; the command sentences add what quotes cannot say
// (renumbering, revocation).
import { matchAlinea, matchArticle, matchInciso, matchItem, matchParagraphs, romanToNumber, visibleLines } from "../pipeline/planalto.ts";

/** Planalto's page for an Emenda Constitucional. */
export function ecPageUrl(number: string): string {
  return `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc${number}.htm`;
}

export interface ActTarget {
  /** Dataset norm key: "cf" or "adct". */
  norm: string;
  id: string;
  /** The act's own article holding the command. */
  article: number;
  /**
   * `quoted`: new text given in quotes (new wording, insertion, or "(revogado)"); `renumbered`: a placeholder the
   * command sentence renumbers ("numerado o parágrafo único como § 1º"); `revoked`: a "Revoga-se …" command.
   */
  how: "quoted" | "renumbered" | "revoked";
}

export interface ActCommands {
  /** In the order the act gives them, each dispositivo once. */
  targets: ActTarget[];
  /** Commands that could not be read; a review must never pass over one. */
  problems: string[];
}

type Scope = "cf" | "adct" | "other";

interface ActArticle {
  number: number;
  /** `alteration`: "… passa(m) a vigorar …" + quoted text; `revocation`: "Revoga-se …"; `autonomous`: anything else. */
  kind: "alteration" | "revocation" | "autonomous";
  scope: Scope;
  /** "…, numerado o parágrafo único como § 1º:": the quoted article's parágrafo único becomes § 1º (same LexML id). */
  renumbersSole: boolean;
}

/** Where the quoted text stands: the dispositivo open at each level, as in the main parser. */
interface Cursor {
  art?: string | undefined;
  par?: string | undefined;
  inc?: string | undefined;
  ali?: string | undefined;
}

/** An elision ("……"): text left as it is. A label followed only by one is a placeholder, not a target. */
const ELISION = /^[.…\s]*$/;
const OPEN = /^["“]/;
/** A closing quote with its "(NR)" (sometimes left unclosed, "(NR"), "(AC)" or final period. */
const CLOSE = /["”]\s*(?:\(NR\)?|\(AC\)|\.)?\s*$/;
const REVOKES = /^(?:Revoga(?:m)?-se|Fica(?:m)? revogad[oa]s?)\b\s*:?\s*/i;

export function parseActCommands(html: string, url: string): ActCommands {
  const targets: ActTarget[] = [];
  const problems: string[] = [];
  let article: ActArticle | undefined;
  let cursor: Cursor | undefined;

  const add = (target: ActTarget) => {
    if (target.norm === "other") return; // a command on another act (e.g. EC 136 on EC 113): outside the corpus
    if (!targets.some((t) => t.norm === target.norm && t.id === target.id)) targets.push(target);
  };
  const revoke = (at: ActArticle, citation: string) => {
    const cited = citedDispositivo(citation, at.scope);
    if (cited) add({ ...cited, article: at.number, how: "revoked" });
    else problems.push(`art. ${at.number}: could not read the revocation "${citation.slice(0, 80)}"`);
  };

  for (const { text } of visibleLines(html, {}, url)) {
    if (/^Brasília,\s+\d/.test(text)) break;

    if (!cursor) {
      const opened = /^Art\.\s*(\d+)/.exec(text) ? matchArticle(text) : undefined;
      if (opened) {
        const sentence = opened.rest;
        article = {
          number: Number(/^Art\.\s*(\d+)/.exec(text)![1]),
          kind: /passa(?:m)? a vigorar/.test(sentence) ? "alteration" : REVOKES.test(sentence) ? "revocation" : "autonomous",
          scope: scopeOf(sentence),
          renumbersSole: /numerad[oa] o parágrafo único como § 1º/.test(sentence),
        };
        const cited = sentence.replace(REVOKES, "");
        if (article.kind === "revocation" && cited) revoke(article, cited);
        continue;
      }
      if (article?.kind === "revocation") {
        // "Revogam-se:" followed by a list: "I - o § 21 do art. 40 da Constituição Federal;".
        const item = /^(?:[IVXLC]+\s*[-–]|[a-z]\))\s*(.*)$/.exec(text);
        // "I - os seguintes dispositivos da Constituição Federal:" scopes the items under it.
        if (item && /:$/.test(item[1]!)) article.scope = scopeOf(item[1]!);
        else if (item) revoke(article, item[1]!);
        continue;
      }
      if (article?.kind !== "alteration" || !OPEN.test(text)) continue;
      cursor = {};
    }

    const at = article!;
    const unquoted = text.replace(OPEN, "");
    const closes = CLOSE.test(unquoted);
    const body = unquoted.replace(CLOSE, "").replace(/\s*\(Vigência\)\s*$/, "").trim();
    if (!ELISION.test(body)) {
      const target = place(cursor, body, at);
      if (typeof target === "string") problems.push(target);
      else if (target) add({ norm: at.scope, ...target, article: at.number });
    }
    if (closes) {
      // A renumbering the quotation does not show still targets the parágrafo único.
      if (at.renumbersSole && cursor.art) add({ norm: at.scope, id: `${cursor.art}_par1`, article: at.number, how: "renumbered" });
      cursor = undefined;
    }
  }
  if (cursor) problems.push(`art. ${article!.number}: a quotation never closes`);
  return { targets, problems };

  /** Moves the cursor to a quoted line's label; returns its target unless it is a placeholder, or a problem. */
  function place(at: Cursor, line: string, act: ActArticle): Pick<ActTarget, "id" | "how"> | string | undefined {
    const art = matchArticle(line);
    if (art) {
      at.art = art.id;
      at.par = at.inc = at.ali = undefined;
      return ELISION.test(art.rest) ? undefined : { id: `${art.id}_cpt`, how: "quoted" };
    }
    if (!at.art) return `art. ${act.number}: quoted "${line.slice(0, 40)}" before any article`;
    const caput = `${at.art}_cpt`;
    let id: string;
    let rest: string;
    const pars = matchParagraphs(line);
    const inc = pars ? undefined : matchInciso(line);
    const ali = pars || inc ? undefined : matchAlinea(line);
    const item = pars || inc || ali ? undefined : matchItem(line);
    if (pars?.length === 1) {
      at.par = id = `${at.art}_${pars[0]!.id}`;
      at.inc = at.ali = undefined;
      rest = pars[0]!.rest;
      // EC 141: "numerado o parágrafo único como § 1º" + a "§ 1º ……" placeholder.
      if (act.renumbersSole && id === `${at.art}_par1` && ELISION.test(rest)) return { id, how: "renumbered" };
    } else if (inc) {
      at.inc = id = `${at.par ?? caput}_${inc.id}`;
      at.ali = undefined;
      rest = inc.rest;
    } else if (ali) {
      at.ali = id = `${at.inc ?? at.par ?? caput}_${ali.id}`;
      rest = ali.rest;
    } else if (item && (at.ali ?? at.inc)) {
      id = `${at.ali ?? at.inc}_${item.id}`;
      rest = item.rest;
    } else return `art. ${act.number}: unrecognised quoted line "${line.slice(0, 80)}"`;
    return ELISION.test(rest) ? undefined : { id, how: "quoted" };
  }
}

/** What a command sentence's subject amends: "O art. 7º da Constituição Federal passa a vigorar …" → `cf`. */
function scopeOf(sentence: string): Scope {
  const subject = sentence.split(/passa(?:m)? a vigorar/)[0]!;
  if (/Ato das Disposições Constitucionais Transitórias|\(ADCT\)/.test(subject)) return "adct";
  if (/Emenda Constitucional nº/.test(subject)) return "other";
  return /Constituição Federal/.test(subject) ? "cf" : "other";
}

/**
 * One dispositivo cited in the descending style, innermost first: "o inciso XXVII do caput do art. 7º da Constituição
 * Federal", "a alínea "b" do inciso XVI do caput do art. 37", "o § 4º do art. 101 do Ato das Disposições …".
 * Lists, ranges and the compact style ("o art. 195, I, "b", e IV") are not read yet: they come back undefined.
 */
function citedDispositivo(citation: string, inherited: Scope): { norm: Scope; id: string } | undefined {
  // A command on another act ("o art. 3º da Emenda Constitucional nº 47, de 5 de julho de 2005") is outside the corpus.
  if (/Emenda Constitucional nº/.test(citation)) return { norm: "other", id: "" };
  const scope = /Ato das Disposições Constitucionais Transitórias|\(ADCT\)/.test(citation)
    ? "adct"
    : /Constituição Federal/.test(citation)
      ? "cf"
      : inherited;
  const path = citation
    .replace(/\s*\(Vigência\)\s*$/, "")
    .replace(/\s*[.;,]?(?:\s+(?:e|ou))?\s*$/, "")
    .replace(/\s+d[oa]\s+(?:Constituição Federal|Ato das Disposições Constitucionais Transitórias(?:\s*\(ADCT\))?)$/, "")
    .replace(/^(?:[oa]s?)\s+/i, "")
    .split(/\s+d[oa]\s+/)
    .reverse();
  let art: string | undefined;
  let par: string | undefined;
  let inc: string | undefined;
  let ali: string | undefined;
  let item: string | undefined;
  for (const unit of path) {
    let m: RegExpExecArray | null;
    if ((m = /^art\.\s*(\d+)\s*[º°o]?((?:-[A-Z])*)$/.exec(unit))) art = `art${m[1]}${letters(m[2]!)}`;
    else if (/^caput$/.test(unit)) par = undefined;
    else if (/^parágrafo único$/.test(unit)) par = "par1";
    else if ((m = /^§\s*(\d+)\s*[º°o]?((?:-[A-Z])*)$/.exec(unit))) par = `par${m[1]}${letters(m[2]!)}`;
    else if ((m = /^inciso\s+([IVXLCDM]+)((?:-[A-Z])*)$/.exec(unit)) && romanToNumber(m[1]!)) inc = `inc${romanToNumber(m[1]!)}${letters(m[2]!)}`;
    else if ((m = /^alínea\s+["“]([a-z])["”]$/.exec(unit))) ali = `ali${m[1]!.charCodeAt(0) - 96}`;
    else if ((m = /^item\s+(\d+)$/.exec(unit))) item = `ite${m[1]}`;
    else return undefined;
  }
  if (!art || scope === "other") return undefined;
  const parts = [art, par ?? "cpt", inc, ali, item].filter(Boolean);
  return { norm: scope, id: parts.join("_") };
}

/** "-A-B" → "-1-2" (LexML Parte 3). */
function letters(suffix: string): string {
  return suffix.replace(/-([A-Z])/g, (_, letter: string) => `-${letter.charCodeAt(0) - 64}`);
}

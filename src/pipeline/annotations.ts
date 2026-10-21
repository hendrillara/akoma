// Planalto's source annotations ("(Redação dada pela …)", "(Vide ADI 7047)", "Produção de efeitos"…) trail the
// dispositivo's text. This peels them off the end, keeping the text verbatim, and turns each into metadata.
import type { ActCitation, ActType, Amendment, Reference, ReferenceKind } from "../schema/dataset.ts";

/** A link on the dispositivo's line: annotations are usually links to the amending act or the STF case. */
export interface Link {
  /** The link's visible text, whitespace collapsed. */
  text: string;
  /** Absolute URL. */
  href: string;
}

export interface Peeled {
  /** The dispositivo's own wording, verbatim. */
  text: string;
  amendments: Amendment[];
  references: Reference[];
}

/** Words that open an annotation. "(Revogado)" alone is not one: it is the wording a revoked dispositivo keeps. */
const ANNOTATION =
  /^(?:Redação dada|Incluíd[oa]s?|Revogad[oa]s?\s+pel[oa]|Vide\b|Vigência|Produção de efeitos?|Renumerad[oa]s?|Transformad[oa]|Parágrafo único renumerado|Regulamento)/i;

export function peelAnnotations(raw: string, links: Link[]): Peeled {
  let text = raw.trim();
  const found: { annotation: string; href: string | undefined }[] = [];
  const unused = [...links];
  const hrefFor = (annotation: string): string | undefined => {
    const bare = normalise(annotation);
    const index = unused.findIndex((link) => {
      const linkText = normalise(link.text);
      return linkText.length >= 3 && (bare.includes(linkText) || linkText.includes(bare));
    });
    return index < 0 ? undefined : unused.splice(index, 1)[0]!.href;
  };

  for (;;) {
    // An annotation left unclosed by the page: "… (Redação dada pela …) (Vigência".
    const unclosed = /\(\s*(Vigência)\s*$/i.exec(text);
    if (unclosed) {
      found.unshift({ annotation: unclosed[1]!, href: hrefFor(unclosed[1]!) });
      text = text.slice(0, unclosed.index).trim();
      continue;
    }

    // "(…)" or "(…)." at the end, opened by an annotation keyword.
    const closing = /\)\s*\.?$/.exec(text);
    if (closing) {
      const open = matchingParen(text, closing.index);
      const inner = open === undefined ? undefined : text.slice(open + 1, closing.index).trim();
      if (open !== undefined && inner && ANNOTATION.test(inner)) {
        found.unshift({ annotation: inner, href: hrefFor(inner) });
        text = text.slice(0, open).trim();
        continue;
      }
    }

    // A bare annotation ("Produção de efeitos", "Incluído pela Emenda Constitucional nº 71, de 2012"): only when it
    // is the whole text of a link at the end of the line, so a sentence that merely ends in those words survives.
    const bare = [...unused].reverse().find((link) => ANNOTATION.test(link.text) && text.endsWith(link.text));
    if (bare) {
      unused.splice(unused.indexOf(bare), 1);
      found.unshift({ annotation: bare.text, href: bare.href });
      text = text.slice(0, -bare.text.length).trim();
      continue;
    }
    break;
  }

  const amendments: Amendment[] = [];
  const references: Reference[] = [];
  for (const { annotation, href } of found) {
    const amendment = toAmendment(annotation, href);
    if (amendment) amendments.push(amendment);
    else references.push(toReference(annotation, href));
  }
  return { text, amendments, references };
}

function matchingParen(text: string, close: number): number | undefined {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && --depth === 0) return i;
  }
  return undefined;
}

function normalise(text: string): string {
  return text.replace(/[()]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// --- Classification ---------------------------------------------------------------------------------------

const EFFECTS: [RegExp, Amendment["effect"]][] = [
  [/^Redação dada/i, "wording"],
  [/^Incluíd[oa]s?/i, "inserted"],
  [/^Revogad[oa]s?/i, "revoked"],
  [/^(?:Renumerad[oa]s?|Transformad[oa]|Parágrafo único renumerado)/i, "renumbered"],
];

function toAmendment(annotation: string, href: string | undefined): Amendment | undefined {
  const effect = EFFECTS.find(([pattern]) => pattern.test(annotation))?.[1];
  if (!effect) return undefined;
  const act = actIn(annotation, href);
  return { effect, annotation, ...(act && { act }) };
}

const REFERENCE_KINDS: [RegExp, ReferenceKind][] = [
  [/^Vigência/i, "vigencia"],
  [/^Produção de efeito/i, "producao_de_efeito"],
  [/^Regulamento/i, "regulamento"],
];

/** STF cases cited by Planalto: ADI (also printed "ADIN"), ADPF, ADC, ADO. */
const CASE = /^Vide\s+(ADIN?|ADPF|ADC|ADO)\b\s*(?:n[º°]\s*)?([\d.]+(?:-\d+)?)/i;

function toReference(annotation: string, href: string | undefined): Reference {
  const kind = REFERENCE_KINDS.find(([pattern]) => pattern.test(annotation))?.[1];
  if (kind) return { kind, annotation, ...(href && { href }) };

  const stfCase = CASE.exec(annotation);
  if (stfCase) {
    const court = stfCase[1]!.toUpperCase();
    const caseKind = (court === "ADIN" ? "adi" : court.toLowerCase()) as ReferenceKind;
    return { kind: caseKind, annotation, number: stfCase[2]!, ...(href && { href }) };
  }

  const act = actIn(annotation, href);
  if (act) return { kind: "act", annotation, act };
  return { kind: "other", annotation, ...(href && { href }) };
}

// --- Act citations ----------------------------------------------------------------------------------------

const ACT_TYPES: [RegExp, ActType][] = [
  [/^Emenda Constitucional de Revisão/i, "emenda_constitucional_de_revisao"],
  // "Emenda Constituição Constitucional" is a typo the page really has.
  [/^Emenda Constitu\S*(?: Constitucional)?/i, "emenda_constitucional"],
  [/^Lei Complementar/i, "lei_complementar"],
  [/^(?:Decreto-Lei|Del)\b/i, "decreto_lei"],
  [/^Decreto Legislativo/i, "decreto_legislativo"],
  [/^Decreto/i, "decreto"],
  [/^Medida Provisória/i, "medida_provisoria"],
  [/^Lei/i, "lei"],
];

/** The act cited by an annotation, e.g. "Emenda Constitucional nº 45, de 2004" or "Lei nº 13.105, de 2015". */
function actIn(annotation: string, href: string | undefined): ActCitation | undefined {
  const at = /(?:\bpel[oa]\s+|^Vide\s+|,\s*pel[oa]\s+)(?=Emenda|Lei|Decreto|Del\b|Medida)/i.exec(annotation);
  if (!at) return undefined;
  const citation = annotation.slice(at.index + at[0].length).trim();
  const match = ACT_TYPES.find(([pattern]) => pattern.test(citation));
  if (!match) return undefined;
  const [pattern, type] = match;
  const after = citation.replace(pattern, "");
  const numbered = /^\s*(?:n[º°o]\.?\s*)?([\d.]+)(?:\s*,\s*(?:de\s+)?(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}))?/i.exec(after);
  if (!numbered) return undefined;
  const year = yearOf(numbered[2]);
  return {
    citation,
    type,
    number: numbered[1]!.replace(/\.$/, ""),
    ...(year !== undefined && { year }),
    ...(href && { href }),
  };
}

function yearOf(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const last = date.split(/[./]/).at(-1)!;
  const year = Number(last);
  if (last.length === 4) return year;
  // Two-digit years ("de 31.3.92") are from the 1988 Constitution's lifetime.
  return year >= 88 ? 1900 + year : 2000 + year;
}

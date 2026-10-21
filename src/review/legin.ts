// Reads Câmara LEGIN's compiled text of a law for review layer 2 (ADR 0002). Its page is laid out like Planalto's,
// one block per dispositivo, so the generic parser reads it; only its annotations are in Câmara's own style:
// "(Inciso acrescido pela Lei nº 14.181, de 1º/7/2021)", "("Caput" do artigo com redação dada pela …)",
// "(VETADO na Lei nº 14.368, de 14/6/2022)", "(Retificado no DOU de 10/1/2007)".
import { matchingParen, type Link, type Peeled } from "../pipeline/annotations.ts";
import { parsePlanaltoPage } from "../pipeline/planalto.ts";
import type { ActCitation, ActType, Amendment, Reference } from "../schema/dataset.ts";
import { articleOf } from "../schema/lexml.ts";
import { actKey, type SecondaryDispositivo } from "./secondary.ts";

/** What opens a Câmara annotation: the kind of dispositivo it is about, or a retificação or veto note. */
const OPENS = /^(?:["“]?Caput["”]?|Inciso|Artigo|Parágrafo|Primitivo|Alínea|Item|Dispositivo|Retificado|VETADO\s+n[ao]\b)/i;
/** What a Câmara annotation about a dispositivo says happened to it. */
const DOES = /\b(?:acrescid[oa]s?|com redação dada|transformad[oa]|renumerad[oa]|revogad[oa]s?)\b/i;

const ACTS: [RegExp, ActType][] = [
  [/^Lei Complementar$/i, "lei_complementar"],
  [/^Lei$/i, "lei"],
  [/^Medida Provisória$/i, "medida_provisoria"],
  [/^Decreto-Lei$/i, "decreto_lei"],
];

export function readLegin(html: string, url: string): SecondaryDispositivo[] {
  const parsed = parsePlanaltoPage(html, {}, url, peelCamaraAnnotations).provisions;
  // Câmara annotates a whole article once, on whichever of its lines it chose ("(Artigo acrescido pela …)" can follow
  // the last inciso), so the acts it records are read per article: the page is compared per article (ADR 0002).
  const byArticle = new Map<string, Set<string>>();
  for (const p of parsed) {
    const article = articleOf(p.id);
    const acts = byArticle.get(article) ?? new Set<string>();
    for (const act of [...p.amendments.map((a) => a.act), ...p.references.map((r) => r.act)]) {
      if (act) acts.add(actKey(act.type, act.number));
    }
    byArticle.set(article, acts);
  }
  return parsed.map((p) => ({
    id: p.id,
    text: p.text,
    status: p.status === "vetoed" || p.status === "revoked" ? p.status : "in_force",
    acts: byArticle.get(articleOf(p.id))!,
  }));
}

/** Câmara's trailing annotations become metadata; the wording stays verbatim. "(VETADO na Lei …)" leaves "(VETADO)". */
function peelCamaraAnnotations(raw: string, _links: Link[]): Peeled {
  let text = raw.trim();
  const amendments: Amendment[] = [];
  const references: Reference[] = [];
  for (;;) {
    const closing = /\)\s*[.;]?$/.exec(text);
    const open = closing ? matchingParen(text, closing.index) : undefined;
    if (open === undefined) break;
    const inner = text.slice(open + 1, closing!.index).trim();
    if (!OPENS.test(inner)) break;
    if (/^VETADO/i.test(inner)) {
      for (const act of actsIn(inner)) references.unshift({ kind: "act", annotation: inner, act });
      text = `${text.slice(0, open)}(VETADO)${text.slice(closing!.index + 1).trim()}`.trim();
      break;
    }
    if (!/^Retificado/i.test(inner)) {
      if (!DOES.test(inner)) break;
      const effect: Amendment["effect"] = /transformad|renumerad/i.test(inner)
        ? "renumbered"
        : /revogad/i.test(inner)
          ? "revoked"
          : /redação dada/i.test(inner)
            ? "wording"
            : "inserted";
      for (const act of actsIn(inner)) amendments.unshift({ effect, annotation: inner, act });
    }
    text = text.slice(0, open).trim();
  }
  // A label kept only to say where its content went (art. 39 XI: "Dispositivo acrescido pela Medida Provisória nº
  // 1.890-67, …, transformado em inciso XIII, …"), unparenthesised: an editorial note, no wording.
  if (/^Dispositivo\s+acrescid[oa]\b.*\btransformad[oa]\s+em\b/i.test(text)) {
    for (const act of actsIn(text)) amendments.unshift({ effect: "renumbered", annotation: text, act });
    text = "";
  }
  return { text, amendments, references };
}

function actsIn(annotation: string): ActCitation[] {
  return [...annotation.matchAll(/(Lei Complementar|Lei|Medida Provisória|Decreto-Lei)\s+nº\s*([\d.]+(?:-\d+)?)/gi)].map((m) => ({
    citation: m[0],
    type: ACTS.find(([pattern]) => pattern.test(m[1]!))![1],
    number: m[2]!,
  }));
}


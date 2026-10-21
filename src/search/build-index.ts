// Build side of search: dispositivos + synonym dictionary → the prebuilt BM25 index the Worker reads (schema/search.ts).
import { readFile } from "node:fs/promises";
import type { Provision } from "../schema/dataset.ts";
import type { SearchIndex, SearchSynonym } from "../schema/search.ts";
import { ANALYZER, analyze } from "./analyze.ts";

/** The synonym dictionary as authored (data/synonyms.json): plain words, analysed when the index is built. */
export interface SynonymDictionary {
  entries: { when: string[]; add: string }[];
}

const DICTIONARY = new URL("../../data/synonyms.json", import.meta.url);

export async function loadSynonyms(): Promise<SynonymDictionary> {
  return JSON.parse(await readFile(DICTIONARY, "utf8")) as SynonymDictionary;
}

// BM25 parameters: the usual defaults.
const K1 = 1.2;
const B = 0.75;
/**
 * Each dispositivo is indexed with the text of the one it hangs under (an inciso with its caput, an alínea with its
 * inciso, a paragraph with the article's caput), at this weight: "natos:" alone says nothing, "São brasileiros: I -
 * natos:" does. Chosen on the evaluation set: 0.5 beat 0 and 1 on recall@10 (docs/search.md).
 */
const CONTEXT_WEIGHT = 0.5;
/** Weight of a term a synonym adds to the query, against 1 for a term the query typed. Chosen on the evaluation set. */
const SYNONYM_WEIGHT = 1;

export function buildSearchIndex(norms: string[], provisions: Provision[], dictionary: SynonymDictionary): SearchIndex {
  const byKey = new Map(provisions.map((p) => [`${p.norm}/${p.id}`, p]));
  const indexed = provisions.filter((p) => p.status === "in_force" && p.text !== "");

  const docs: string[] = [];
  const docNorm: number[] = [];
  const docLength: number[] = [];
  const postings: Record<string, number[]> = {};
  for (const provision of indexed) {
    const doc = docs.length;
    const tf = new Map<string, number>();
    let length = 0;
    const count = (text: string, weight: number) => {
      for (const term of analyze(text)) {
        tf.set(term, (tf.get(term) ?? 0) + weight);
        length += weight;
      }
    };
    count(provision.text, 1);
    const parent = parentId(provision.id);
    if (parent) count(byKey.get(`${provision.norm}/${parent}`)?.text ?? "", CONTEXT_WEIGHT);
    docs.push(`${provision.norm}/${provision.id}`);
    docNorm.push(norms.indexOf(provision.norm));
    docLength.push(round(length));
    for (const [term, count] of tf) (postings[term] ??= []).push(doc, round(count));
  }

  const synonyms = dictionary.entries.map(analyseSynonym);
  const avgDocLength = docLength.reduce((a, b) => a + b, 0) / Math.max(docs.length, 1);
  return {
    analyzer: ANALYZER,
    k1: K1,
    b: B,
    norms,
    docs,
    docNorm,
    docLength,
    avgDocLength: round(avgDocLength),
    postings,
    synonyms,
    synonymWeight: SYNONYM_WEIGHT,
  };
}

/** The dispositivo another hangs under: art5_cpt_inc10 → art5_cpt, art14_par1_inc2_ali1 → art14_par1_inc2, art14_par1 → art14_cpt. */
function parentId(id: string): string | undefined {
  const segments = id.split("_");
  if (segments.length > 2) return segments.slice(0, -1).join("_");
  return segments[1] === "cpt" ? undefined : `${segments[0]}_cpt`;
}

/** A `when` phrase made only of stopwords can never fire, and an empty `add` adds nothing: both are typos. */
function analyseSynonym(entry: SynonymDictionary["entries"][number]): SearchSynonym {
  const when = entry.when.map((phrase) => analyze(phrase));
  const add = [...new Set(analyze(entry.add))];
  if (when.length === 0 || when.some((phrase) => phrase.length === 0) || add.length === 0) {
    throw new Error(`synonyms ${JSON.stringify(entry.when)}: every "when" phrase and "add" need a word that is not a stopword`);
  }
  return { when, add };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

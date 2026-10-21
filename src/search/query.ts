// Query side of search: BM25 over the prebuilt index. Per query it analyses a short string, expands synonyms and walks
// the postings of a few terms; it never builds or rewrites the index (Workers Free allows ~10 ms of CPU per request).
import type { SearchIndex } from "../schema/search.ts";
import { analyze } from "./analyze.ts";

export interface Hit {
  /** `<norm>/<id>` of the dispositivo. */
  doc: string;
  score: number;
}

/** The best `limit` dispositivos for `query`, best first; ties keep dataset order, so results are deterministic. */
export function searchIndex(index: SearchIndex, query: string, options: { norm?: string; limit: number }): Hit[] {
  const only = options.norm === undefined ? -1 : index.norms.indexOf(options.norm);
  const total = index.docs.length;
  const scores = new Float64Array(total);
  const { k1, b, avgDocLength, docLength, docNorm } = index;

  for (const [term, weight] of queryTerms(index, query)) {
    const postings = index.postings[term];
    if (!postings) continue;
    const df = postings.length / 2;
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
    for (let i = 0; i < postings.length; i += 2) {
      const doc = postings[i]!;
      if (only !== -1 && docNorm[doc] !== only) continue;
      const tf = postings[i + 1]!;
      scores[doc]! += (weight * idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLength[doc]!) / avgDocLength));
    }
  }

  const hits: number[] = [];
  for (let doc = 0; doc < total; doc++) if (scores[doc]! > 0) hits.push(doc);
  hits.sort((x, y) => scores[y]! - scores[x]! || x - y);
  return hits.slice(0, options.limit).map((doc) => ({ doc: index.docs[doc]!, score: scores[doc]! }));
}

/** The query's terms at weight 1, plus the terms its synonym phrases add at the index's synonym weight. */
function queryTerms(index: SearchIndex, query: string): Map<string, number> {
  const typed = analyze(query);
  const terms = new Map<string, number>(typed.map((term) => [term, 1]));
  for (const synonym of index.synonyms) {
    if (!synonym.when.some((phrase) => contains(typed, phrase))) continue;
    for (const term of synonym.add) terms.set(term, Math.max(terms.get(term) ?? 0, index.synonymWeight));
  }
  return terms;
}

function contains(terms: string[], phrase: string[]): boolean {
  outer: for (let start = 0; start + phrase.length <= terms.length; start++) {
    for (let i = 0; i < phrase.length; i++) if (terms[start + i] !== phrase[i]) continue outer;
    return true;
  }
  return false;
}

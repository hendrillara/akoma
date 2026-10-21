// The prebuilt search index: made by the build, read as-is by the Worker. Plain JSON, so it is published like any
// other dataset file and parsed once per isolate; the Worker never builds or rewrites it per request.

export interface SearchIndex {
  /**
   * Name and version of the text analysis the index was built with (folding, stopwords, stemming). The Worker analyses
   * queries with its own copy of that code and refuses an index built with another one, since the terms would not match.
   */
  analyzer: string;
  /** BM25 parameters. */
  k1: number;
  b: number;
  /** Norm keys; `docNorm` points into this list. */
  norms: string[];
  /** One entry per indexed dispositivo: `<norm>/<id>`. Only dispositivos in force with text are indexed. */
  docs: string[];
  /** Per doc: index of its norm in `norms`. */
  docNorm: number[];
  /** Per doc: its length in terms, context terms counted at their weight. */
  docLength: number[];
  avgDocLength: number;
  /** Postings per term, flat: [doc, tf, doc, tf, …] with docs ascending; tf counts context terms at their weight. */
  postings: Record<string, number[]>;
  /** The synonym dictionary, already analysed: when the query holds a `when` phrase, its `add` terms join the query. */
  synonyms: SearchSynonym[];
  /** Weight of a term added by a synonym, relative to a term the query typed (1). */
  synonymWeight: number;
}

export interface SearchSynonym {
  /** Analysed phrases; each is a run of terms that must appear in this order in the analysed query. */
  when: string[][];
  /** Analysed terms added to the query. */
  add: string[];
}

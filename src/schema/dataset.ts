// The published dataset. Shared by the build pipeline (producer) and the Worker (consumer).

export interface Dataset {
  norms: NormEntry[];
  provisions: Provision[];
}

export interface NormEntry {
  /** Short stable key, e.g. "cf", "adct", "cdc". */
  key: string;
  /** LexML URN of the norm. */
  urn: string;
  title: string;
}

/** One dispositivo (caput, parágrafo, inciso…) with its verbatim text. */
export interface Provision {
  /** LexML Parte 3 id within its norm, e.g. "art5_cpt_inc10"; never reused. */
  id: string;
  /** Key of the norm it belongs to (NormEntry.key). */
  norm: string;
  /** Hierarchy from the outermost grouping down to this dispositivo, e.g. Título II › Capítulo I › Art. 5º › inciso X. */
  path: PathSegment[];
  /** Official wording in force, verbatim, without its label ("IV -", "§ 1º") or source annotations ("(Vide …)"). */
  text: string;
  provenance: Provenance;
}

export type PathKind = "titulo" | "capitulo" | "secao" | "subsecao" | "artigo" | "caput" | "paragrafo" | "inciso";

export interface PathSegment {
  kind: PathKind;
  /** Human-readable label, e.g. "Título II", "Art. 5º", "§ 1º", "parágrafo único", "inciso X". */
  label: string;
}

export interface Provenance {
  /** The official page the text was read from. */
  sourceUrl: string;
  /** When that page was retrieved: an ISO 8601 instant, or a date when only the capture day is known. */
  retrievedAt: string;
  /** "sha256:<hex>" of the UTF-8 text; the per-dispositivo change signal. */
  contentHash: string;
  /** Version of the dataset this record was built into. */
  datasetVersion: string;
}

// The published dataset. Shared by the build pipeline (producer) and the Worker (consumer).

export interface Dataset {
  norms: NormEntry[];
}

export interface NormEntry {
  /** Short stable key, e.g. "cf", "adct", "cdc". */
  key: string;
  /** LexML URN of the norm. */
  urn: string;
  title: string;
}

// The published dataset. Shared by the build pipeline (producer) and the Worker (consumer).

export interface Dataset {
  norms: NormEntry[];
  provisions: Provision[];
  /** The source pages the build read, once each (the CF and the ADCT share one): change detection's pre-filter. */
  pages?: SourcePage[];
}

/**
 * A source page as the build saw it. ETag and Last-Modified are only a pre-filter: they move without the text moving.
 * The per-dispositivo records are the real change signal.
 */
export interface SourcePage {
  url: string;
  /** When the page was retrieved: an ISO 8601 instant, or a date when only the capture day is known. */
  retrievedAt: string;
  etag?: string;
  lastModified?: string;
  /**
   * "sha256:<hex>" of the decoded page with every `<script>` element removed: Planalto's F5 WAF injects a script with
   * a random token into every response, so the raw bytes differ on every fetch.
   */
  contentHash: string;
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
  kind: ProvisionKind;
  /** The dispositivo's own label with ordinals normalised, e.g. "Art. 5º" (caput: "caput"), "§ 1º", "inciso X", "alínea a". */
  label: string;
  /** Hierarchy from the outermost grouping down to this dispositivo, e.g. Título II › Capítulo I › Art. 5º › inciso X. */
  path: PathSegment[];
  /**
   * Official wording, verbatim, without its label ("IV -", "§ 1º") or source annotations ("(Vide …)"), which become
   * `amendments` and `references`. A revoked dispositivo keeps what the page prints as its wording ("(revogado);"),
   * which is empty when the page records the revocation only as an annotation ("§§ 1º a 3º. (Revogados pela …)");
   * renderers show "(Revogado)" from `status`, never by inventing text here.
   * One normalisation: punctuation doubled where struck text was cut out mid-sentence is collapsed (art. 100 § 11
   * "devedor, <strike>…</strike>, a oferta" reads "devedor, a oferta").
   */
  text: string;
  status: ProvisionStatus;
  /** Acts that inserted, reworded, renumbered or revoked this dispositivo, in the order the page cites them. */
  amendments: Amendment[];
  /** "Vide" notes (other acts, STF cases such as ADI/ADPF) and vigência/effect notes the page attaches. */
  references: Reference[];
  provenance: Provenance;
}

export interface Amendment {
  effect: "wording" | "inserted" | "revoked" | "renumbered";
  /** The annotation as printed, without its parentheses, e.g. "Redação dada pela Emenda Constitucional nº 45, de 2004". */
  annotation: string;
  /** Absent only when the annotation names no act the parser recognises. */
  act?: ActCitation;
}

export interface ActCitation {
  /** As printed, e.g. "Emenda Constitucional nº 45, de 2004". */
  citation: string;
  type: ActType;
  /** As printed, e.g. "45", "13.105". */
  number: string;
  year?: number;
  /** The official page the annotation links to, when it links. */
  href?: string;
}

export type ActType =
  | "emenda_constitucional"
  | "emenda_constitucional_de_revisao"
  | "lei"
  | "lei_complementar"
  | "decreto_lei"
  | "decreto_legislativo"
  | "decreto"
  | "medida_provisoria";

export interface Reference {
  kind: ReferenceKind;
  /** The annotation as printed, without its parentheses, e.g. "Vide ADIN 3392", "Vigência". */
  annotation: string;
  /** Case number for STF references, as printed (e.g. "3392", "2.135-4"). */
  number?: string;
  /** The act a "Vide" note points to. */
  act?: ActCitation;
  /** Where the annotation links (an STF case page, the act's vigência clause…). */
  href?: string;
}

/**
 * `adi` | `adpf` | `adc` | `ado`: an STF case ("Vide ADI 7047"; "ADIN" counts as `adi`). Akoma does not check what
 * the STF decided. `act`: "Vide" another act. `vigencia`, `producao_de_efeito`: the page's pointer to when a change
 * takes effect. `regulamento`: the regulating act. `other`: any other "Vide" note (e.g. "Vide art. 96 - ADCT").
 */
export type ReferenceKind =
  | "adi"
  | "adpf"
  | "adc"
  | "ado"
  | "act"
  | "vigencia"
  | "producao_de_efeito"
  | "regulamento"
  | "other";

/**
 * The text-bearing dispositivos. An article has no record of its own: its caput carries it, and a whole article is
 * the group of records whose id starts with the article's id.
 */
export type ProvisionKind = "caput" | "paragrafo" | "inciso" | "alinea" | "item";

/**
 * The page's revoked/vetoed markers, and nothing more: `in_force` means the page does not mark the dispositivo revoked
 * or vetoed, not that its wording has taken effect. When a change takes effect later (EC 132's 2027/2033 phases,
 * EC 141 art. 7º XV) the page says so only through `references` of kind `vigencia`/`producao_de_efeito`.
 * Revoked and vetoed dispositivos keep their id and label (LC 95 art. 12 III c).
 */
export type ProvisionStatus = "in_force" | "revoked" | "vetoed";

export type PathKind = "parte" | "livro" | "titulo" | "capitulo" | "secao" | "subsecao" | "artigo" | ProvisionKind;

export interface PathSegment {
  kind: PathKind;
  /** Human-readable label, e.g. "Título II", "Art. 5º", "§ 1º", "parágrafo único", "inciso X", "alínea a", "item 1". */
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
  /** Always `NOTICE`: the text is unofficial and its vigência is not checked against STF decisions. */
  notice: string;
}

export const NOTICE =
  "Texto não oficial: confira a fonte. A vigência não é verificada contra decisões do STF. / Unofficial text: check the source. Vigência is not verified against STF decisions.";

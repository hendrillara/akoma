// The published dataset. Shared by the build pipeline (producer) and the Worker (consumer).

export interface Dataset {
  norms: NormEntry[];
  provisions: Provision[];
  /** Every norm's groupings (títulos, capítulos, seções…), in page order: the structure outline. */
  groupings?: Grouping[];
  /** Every norm's articles, in page order: what "get a whole article" returns, with its dispositivos. */
  articles?: Article[];
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

/**
 * A heading of the LC 95 hierarchy (Parte › Livro › Título › Capítulo › Seção › Subseção). Headings are not dispositivos
 * (LC 95 art. 10 sole paragraph); they are the outline an agent navigates a norm by.
 */
export interface Grouping {
  /** Key of the norm it belongs to (NormEntry.key). */
  norm: string;
  /** LexML Parte 3 grouping id, from the top level down: "tit2", "tit2_cap1", "tit6_cap1_sec5-1"; never reused. */
  id: string;
  kind: GroupingKind;
  /** As in `PathSegment`: "Título II", "Capítulo VI-A", "Seção V". */
  label: string;
  /** The heading's name verbatim, blocks joined by one space ("DOS DIREITOS E DEVERES INDIVIDUAIS E COLETIVOS"). */
  name: string;
  /** Id of the enclosing grouping; absent at the top level. */
  parent?: string;
  /** Annotations printed with the heading ("Incluído pela Lei nº 14.181, de 2021"), as on a dispositivo. */
  amendments: Amendment[];
  references: Reference[];
}

export type GroupingKind = "parte" | "livro" | "titulo" | "capitulo" | "secao" | "subsecao";

/**
 * An article: the container of its caput, parágrafos, incisos… It carries no text of its own (its caput does). Its
 * dispositivos are the records whose id's first segment is the article's id ("art5" holds "art5_cpt_inc10", not
 * "art50_cpt").
 */
export interface Article {
  /** Key of the norm it belongs to (NormEntry.key). */
  norm: string;
  /** LexML id, e.g. "art5", "art103-1". */
  id: string;
  /** As printed with ordinals normalised, e.g. "Art. 5º", "Art. 103-A". */
  label: string;
  /** Id of the innermost grouping the article sits in; absent when the norm has none (the ADCT). */
  grouping?: string;
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
  /**
   * Other ids that name this dispositivo elsewhere (normas.leg.br fragments such as "art1_par1u" or
   * "art5_cpt_inc79,emc-115-2022-02-10"), with attribution to Senado/LexML. Never an address: the API answers an alias
   * with 404 and this record's `id` as the suggestion.
   */
  aliases?: string[];
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
 * The text-bearing dispositivos. An article's text is its caput's; the article itself is an `Article` record, and a
 * whole article is the group of records whose id's first segment is the article's id.
 */
export type ProvisionKind = "caput" | "paragrafo" | "inciso" | "alinea" | "item";

/**
 * The page's revoked/vetoed markers, and nothing more: `in_force` means the page does not mark the dispositivo revoked
 * or vetoed, not that its wording has taken effect. When a change takes effect later (EC 132's 2027/2033 phases,
 * EC 141 art. 7º XV) the page says so only through `references` of kind `vigencia`/`producao_de_efeito`.
 * Revoked and vetoed dispositivos keep their id and label (LC 95 art. 12 III c). `renumbered`: the page keeps the label
 * only to say its content moved to another number (CDC art. 39 XI, "transformado em inciso XIII"); its text is empty
 * and the note is its `renumbered` amendment.
 */
export type ProvisionStatus = "in_force" | "revoked" | "vetoed" | "renumbered";

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

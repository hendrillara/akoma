// Deferred vigência (ADR 0003): stages an amending act's later changes on the dispositivos of the page, as `pending`
// entries, and promotes those whose start date the build's date has reached.
import type { ActCitation, Amendment, PendingChange, Provision } from "../schema/dataset.ts";
import { isUnder, type AmendingAct, type DeferredChange } from "./acts.ts";

/** A provision before hashing: the build computes `provenance.contentHash` once the text is final. */
export type Draft = Omit<Provision, "provenance"> & { provenance: Omit<Provision["provenance"], "contentHash"> };

/**
 * Applies the changes `acts` defer for one norm (those cited as `citedAs`) to its `drafts`, in place.
 * @param today the build's date (YYYY-MM-DD, Brasília): changes starting on or before it are promoted.
 * @param provenanceOf provenance for a dispositivo the act inserts, which the page does not have yet.
 */
export function applyDeferredChanges(
  drafts: Draft[],
  acts: { act: AmendingAct; retrievedAt: string }[],
  citedAs: string,
  today: string,
  provenanceOf: (act: { act: AmendingAct; retrievedAt: string }) => Draft["provenance"],
): void {
  // Every change, per dispositivo it reaches; a revocation of a § or an article reaches everything under it.
  const staged = new Map<string, Staged[]>();
  const stage = (id: string, entry: Staged) => {
    const list = staged.get(id) ?? [];
    // EC 132 revokes ADCT art. 82 § 2º twice for 2033 (quoted "(Revogado)" in art. 5 and listed in art. 22): once is enough.
    if (!list.some((e) => e.change.kind === entry.change.kind && e.change.effectiveFrom === entry.change.effectiveFrom && e.act === entry.act)) {
      list.push(entry);
    }
    staged.set(id, list);
  };

  for (const source of acts) {
    for (const change of source.act.changes.filter((c) => c.norm === citedAs)) {
      const entry = { change, act: source.act.act };
      if (change.kind === "revoked") {
        const reached = drafts.filter((d) => isUnder(d.id, change.id));
        if (!reached.length) throw new Error(`${source.act.act.citation} revokes ${citedAs} ${change.id}, which the page does not have`);
        for (const d of reached) stage(d.id, entry);
        continue;
      }
      if (!drafts.some((d) => d.id === change.id)) insert(drafts, change, source.act.act, provenanceOf(source));
      stage(change.id, entry);
    }
  }

  for (const [id, entries] of staged) {
    const draft = drafts.find((d) => d.id === id)!;
    entries.sort((a, b) => a.change.effectiveFrom.localeCompare(b.change.effectiveFrom));
    // The page may already show some phases (Planalto applied them): the latest phase it shows, and all before it, are
    // done. Only the later ones are outstanding, so a 2027 wording never overwrites text already moved to 2033.
    let done = -1;
    entries.forEach((e, i) => {
      if (shows(draft, e.change)) done = i;
    });
    const pending: PendingChange[] = [];
    for (const { change, act } of entries.slice(done + 1)) {
      const entry = pendingEntry(draft, change, act, pending.length > 0);
      if (pending.length || entry.note || change.effectiveFrom > today) pending.push(entry);
      else promote(draft, entry);
    }
    if (pending.length) draft.pending = pending;
  }
}

interface Staged {
  change: DeferredChange;
  act: ActCitation;
}

function shows(draft: Draft, change: DeferredChange): boolean {
  if (change.kind === "revoked") return draft.status === "revoked";
  return draft.status === "in_force" && normalise(draft.text) === normalise(change.text!);
}

/**
 * What the page and the act's quote must share for the page to count as showing a wording. Planalto's printing of the
 * same text varies in spacing ("docaputdeste"), quote marks and case, so those are ignored; words and punctuation count.
 */
function normalise(text: string): string {
  return text.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, "").toLowerCase();
}

/** @param afterAnother whether an earlier change to the same dispositivo is still pending (it inserts, this rewords). */
function pendingEntry(draft: Draft, change: DeferredChange, act: ActCitation, afterAnother: boolean): PendingChange {
  const effect =
    change.kind === "revoked" ? "revoked" : draft.status === "not_yet_in_force" && !afterAnother ? "inserted" : "wording";
  const later = laterAct(draft, act);
  return {
    effect,
    ...(change.text !== undefined && change.kind === "text" && { text: change.text }),
    effectiveFrom: change.effectiveFrom,
    vigencia: change.vigencia,
    act,
    ...(later && {
      note: `Alterado depois pela ${later.citation}: não se sabe se esta mudança ainda entra em vigor como redigida. / Amended since by ${later.citation}: whether this change still takes effect as written is not settled.`,
    }),
  };
}

/** A later act of the same kind that has amended the dispositivo since `act` (higher number), per the page. */
function laterAct(draft: Draft, act: ActCitation): ActCitation | undefined {
  return draft.amendments
    .map((a) => a.act)
    .find((a): a is ActCitation => !!a && a.type === act.type && Number(a.number.replace(/\./g, "")) > Number(act.number.replace(/\./g, "")));
}

const ANNOTATION: Record<PendingChange["effect"], string> = {
  wording: "Redação dada pela",
  inserted: "Incluído pela",
  revoked: "Revogado pela",
};

function promote(draft: Draft, entry: PendingChange): void {
  if (entry.effect === "revoked") {
    draft.status = "revoked";
    draft.text = "";
  } else {
    draft.status = "in_force";
    draft.text = entry.text!;
  }
  const amendment: Amendment = {
    effect: entry.effect,
    annotation: `${ANNOTATION[entry.effect]} ${entry.act.citation}`,
    act: entry.act,
    effectiveFrom: entry.effectiveFrom,
  };
  draft.amendments.push(amendment);
}

const KIND_OF: Record<string, Provision["kind"]> = { cpt: "caput", par: "paragrafo", inc: "inciso", ali: "alinea", ite: "item" };

/**
 * Adds a dispositivo the act inserts, which the page cannot have yet, as `not_yet_in_force`, in document order. Its
 * parent must be on the page: a quoted label the cursor misplaced must fail here, not mint a phantom dispositivo.
 */
function insert(drafts: Draft[], change: DeferredChange, act: ActCitation, provenance: Draft["provenance"]): void {
  const segments = change.id.split("_");
  const own = segments.at(-1)!;
  const kind = KIND_OF[own.replace(/[\d-]+$/, "")];
  if (!kind || kind === "caput" || segments.length < 2) {
    throw new Error(`${act.citation} inserts ${change.id}: inserting a whole article is not supported yet`);
  }
  // An article has no record of its own: its caput stands for it as the parent of its parágrafos.
  const parentId = segments.length === 2 ? `${segments[0]}_cpt` : segments.slice(0, -1).join("_");
  const parent = drafts.find((d) => d.id === parentId);
  if (!parent) throw new Error(`${act.citation} inserts ${change.id}, but its parent ${parentId} is not on the page`);
  // Children of the caput hang under `_cpt`, which adds no segment to their path.
  const base = parent.kind === "caput" ? parent.path.slice(0, -1) : parent.path;
  const draft: Draft = {
    id: change.id,
    norm: parent.norm,
    kind,
    label: labelOf(kind, change.label!),
    path: [...base, { kind, label: labelOf(kind, change.label!) }],
    text: "",
    status: "not_yet_in_force",
    amendments: [],
    references: [],
    provenance,
  };
  const article = segments[0]!;
  const after = drafts.findIndex((d) => isUnder(d.id, article) && compareIds(d.id, change.id) > 0);
  const lastOfArticle = drafts.findLastIndex((d) => isUnder(d.id, article));
  drafts.splice(after >= 0 ? after : lastOfArticle + 1, 0, draft);
}

/** The parser's label forms: "§ 17", "parágrafo único", "inciso I", "alínea a". */
function labelOf(kind: Provision["kind"], quoted: string): string {
  return kind === "paragrafo" && /^parágrafo único$/i.test(quoted) ? "parágrafo único" : quoted;
}

const RANK: Record<string, number> = { art: 0, cpt: 1, par: 2, inc: 3, ali: 4, ite: 5 };

/** Document order of two LexML ids: a parent before its children, caput children before parágrafos, numbers ascending. */
function compareIds(a: string, b: string): number {
  const as = a.split("_");
  const bs = b.split("_");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const [ka, na] = split(as[i]!);
    const [kb, nb] = split(bs[i]!);
    if (ka !== kb) return (RANK[ka] ?? 9) - (RANK[kb] ?? 9);
    for (let j = 0; j < Math.max(na.length, nb.length); j++) {
      const d = (na[j] ?? 0) - (nb[j] ?? 0);
      if (d) return d;
    }
  }
  return as.length - bs.length;
}

function split(segment: string): [string, number[]] {
  const kind = segment.replace(/[\d-]+$/, "");
  const numbers = segment.slice(kind.length).split("-").filter(Boolean).map(Number);
  return [kind, numbers];
}

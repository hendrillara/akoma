// Review layer 1: deterministic gates over a new build and its change report. Each gate returns findings; a problem
// from any of them makes the verdict `needs-human` (see verdict.ts).
import { createHash } from "node:crypto";
import { isUnder, NORM_NAMES, readActCommands, readAmendingAct, type ActTarget } from "../pipeline/acts.ts";
import type { NormManifest } from "../pipeline/build.ts";
import type { ChangeReport, ProvisionChange } from "../pipeline/changes.ts";
import {
  NOTICE,
  type ActCitation,
  type ActType,
  type Amendment,
  type Dataset,
  type Provision,
  type ProvisionKind,
  type ProvisionStatus,
  type Reference,
} from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";
import { actPage, verifyActPage } from "./act-pages.ts";
import { actKey } from "./secondary.ts";
import type { Finding } from "./verdict.ts";

export interface GateInput {
  /** The manifests both builds used: they map how an act names a norm ("Constituição Federal") to its key. */
  manifests: NormManifest[];
  previous: Dataset;
  next: Dataset;
  report: ChangeReport;
  /** Where the amending acts' official pages are read from: the same source as the new build. */
  source: Source;
}

/**
 * Schema, id stability (no removal without a revocation mark, no revoked id back in force), structural invariants,
 * dispositivo counts against the previous dataset, a promoted wording the page prints differently, and target
 * matching, in that order. The golden set and the full-text snapshot are test suites over the recorded
 * fixtures and gate every PR through `pnpm verify`; on a refresh, target matching is what explains each changed text.
 */
export async function reviewGates({ manifests, previous, next, report, source }: GateInput): Promise<Finding[]> {
  return [
    ...schema(next),
    ...removals(report),
    ...idReuse(report),
    ...invariants(next),
    ...counts(previous, next),
    ...pageDivergence(report),
    ...(await targetMatching(report, previous, next, manifests, source)),
  ];
}

const gate = (check: string, severity: Finding["severity"], message: string, about: Partial<Finding> = {}): Finding => ({
  layer: "gates",
  check,
  severity,
  ...about,
  message,
});

// --- Schema -----------------------------------------------------------------------------------------------

const STATUSES: ProvisionStatus[] = ["in_force", "revoked", "vetoed", "renumbered", "not_yet_in_force"];
const KIND_OF_SEGMENT: Record<string, ProvisionKind> = { cpt: "caput", par: "paragrafo", inc: "inciso", ali: "alinea", ite: "item" };
const ID = /^art\d+(?:-\d+)*(?:_(?:cpt|par\d+(?:-\d+)*|inc\d+(?:-\d+)*|ali\d+(?:-\d+)*|ite\d+(?:-\d+)*))+$/;

/** Each record has the shape the Worker relies on: a LexML id matching its kind, a known norm, its own text's hash. */
function schema(next: Dataset): Finding[] {
  const norms = new Set(next.norms.map((n) => n.key));
  const findings: Finding[] = [];
  for (const p of next.provisions) {
    const wrong = schemaIssue(p, norms);
    if (wrong) findings.push(gate("schema", "problem", wrong, { norm: p.norm, id: p.id }));
  }
  return findings;
}

function schemaIssue(p: Provision, norms: Set<string>): string | undefined {
  if (!norms.has(p.norm)) return `belongs to an unknown norm "${p.norm}"`;
  if (!ID.test(p.id)) return "is not a LexML Parte 3 id";
  const segment = /_([a-z]+)[\d-]*$/.exec(p.id)![1]!;
  if (KIND_OF_SEGMENT[segment] !== p.kind) return `has kind "${p.kind}", but its id ends in a "${segment}" segment`;
  if (p.path.at(-1)?.kind !== p.kind) return "has a path that does not end at itself";
  if (!STATUSES.includes(p.status)) return `has an unknown status "${p.status}"`;
  if (p.provenance.contentHash !== `sha256:${createHash("sha256").update(p.text, "utf8").digest("hex")}`) {
    return "has a content hash that is not its text's";
  }
  if (p.provenance.notice !== NOTICE) return "lacks the STF notice";
  return undefined;
}

// --- Id stability -----------------------------------------------------------------------------------------

/** A dispositivo leaves the dataset only by being marked revoked; one that vanished is a parser or page problem. */
function removals(report: ChangeReport): Finding[] {
  return report.changes
    .filter((c) => c.kind === "removed")
    .map((c) => gate("removal", "problem", "vanished from the page without a revocation mark", { norm: c.norm, id: c.id }));
}

/**
 * LC 95 art. 12 III c: a revoked, vetoed or renumbered dispositivo keeps its id, and the id never comes back in force.
 * (A `not_yet_in_force` one coming into force is a deferred insertion taking effect, not a reuse.)
 */
function idReuse(report: ChangeReport): Finding[] {
  const ended: ProvisionStatus[] = ["revoked", "vetoed", "renumbered"];
  return report.changes
    .filter((c) => c.before && c.after && ended.includes(c.before.status) && c.after.status === "in_force")
    .map((c) =>
      gate("id-reuse", "problem", `was ${c.before!.status} and is back in force under the same id`, { norm: c.norm, id: c.id }),
    );
}

// --- Structural invariants --------------------------------------------------------------------------------

/** Siblings are numbered monotonically, letter suffixes after their base (29, 29-A, 30; § 1º, § 1º-A, § 2º). */
function invariants(next: Dataset): Finding[] {
  const findings: Finding[] = [];
  const last = new Map<string, { numbers: number[]; id: string }>();
  for (const { norm, id } of next.provisions) {
    const parts = id.split("_");
    for (let depth = 0; depth < parts.length; depth++) {
      const part = parts[depth]!;
      if (part === "cpt") continue;
      const kind = part.replace(/[\d-]+$/, "");
      const numbers = part.slice(kind.length).split("-").map(Number);
      const key = `${norm}|${parts.slice(0, depth).join("_")}|${kind}`;
      const sibling = parts.slice(0, depth + 1).join("_");
      const previous = last.get(key);
      if (previous && previous.id !== sibling && compare(previous.numbers, numbers) >= 0) {
        findings.push(gate("invariants", "problem", `comes after ${previous.id}: siblings out of order`, { norm, id: sibling }));
      }
      last.set(key, { numbers, id: sibling });
    }
  }
  return findings;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// --- Counts against the previous dataset -----------------------------------------------------------------

/**
 * How far a norm's count of one kind of dispositivo (caput, parágrafo, inciso…) may move in one refresh: 2% of the
 * previous count, and at least 5. A parser regression shows up as dozens of dispositivos found or lost at once; a real
 * act that inserts that many (Lei 14.181/2021 put 69 into the CDC) deserves a person's look anyway.
 */
export const COUNT_TOLERANCE = { relative: 0.02, absolute: 5 } as const;

function counts(previous: Dataset, next: Dataset): Finding[] {
  const tally = (dataset: Dataset) => {
    const byKey = new Map<string, number>();
    for (const p of dataset.provisions) byKey.set(`${p.norm}|${p.kind}`, (byKey.get(`${p.norm}|${p.kind}`) ?? 0) + 1);
    return byKey;
  };
  const before = tally(previous);
  const after = tally(next);
  const findings: Finding[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])]) {
    const [norm, kind] = key.split("|") as [string, ProvisionKind];
    // A norm new to the dataset (or gone from it) has nothing to compare with.
    if (!previous.norms.some((n) => n.key === norm) || !next.norms.some((n) => n.key === norm)) continue;
    const was = before.get(key) ?? 0;
    const is = after.get(key) ?? 0;
    const allowed = Math.max(COUNT_TOLERANCE.absolute, Math.round(was * COUNT_TOLERANCE.relative));
    if (Math.abs(is - was) <= allowed) continue;
    const delta = is - was > 0 ? `+${is - was}` : `−${was - is}`;
    const message = `${kind}: ${was} → ${is} (${delta}), beyond the tolerance of ±${allowed} (2% of ${was}, at least 5)`;
    findings.push(gate("counts", "problem", message, { norm }));
  }
  return findings;
}

// --- Promoted wording against the page -------------------------------------------------------------------

/**
 * The build promotes an act's quoted wording until the page shows it (ADR 0003). When a change brings a new page
 * annotation of an act's change (no `effectiveFrom`) while the record keeps the build-applied one of the same act
 * (`effectiveFrom`), the page has caught up, but in a wording other than the act's quote, which the dataset still
 * holds. Only new annotations count: an act can change a dispositivo in force at publication and again later
 * (EC 132 on art. 146 III "d": 2023, then 2027), and then both annotations are rightly there.
 */
function pageDivergence(report: ChangeReport): Finding[] {
  const same = (a: Amendment, b: Amendment) => a.effect === b.effect && a.act?.type === b.act?.type && a.act?.number === b.act?.number;
  const findings: Finding[] = [];
  for (const c of report.changes) {
    const built = c.after?.amendments.find((b) => b.effectiveFrom && c.amendments.some((page) => !page.effectiveFrom && same(page, b)));
    if (!built) continue;
    const message = `the page now shows the change by ${built.act!.citation}, but not in the act's wording, which the build kept`;
    findings.push(gate("page-divergence", "problem", message, { norm: c.norm, id: c.id }));
  }
  return findings;
}

// --- Target matching --------------------------------------------------------------------------------------

/**
 * Every changed dispositivo must be targeted by an act it cites (a revocation, or a whole article, also covers
 * everything under it). For an act new to the dataset, the converse holds too: each of its targets must have changed,
 * whatever changed on it: the text in force, or a pending wording (deferred vigência, #6).
 * An act the previous dataset already cites (as an amendment or a pending change) is checked one way only: today's
 * changes are a later step of it (a deferred wording promoted, the page catching up with a promotion, ADR 0003) or
 * a new note on it, so most of its targets rightly stay as they were. Its unreadable articles are noted, not blocking:
 * a change they would explain still shows up as untargeted.
 * A dispositivo that vanished is the removal gate's, not reported here.
 */
async function targetMatching(
  report: ChangeReport,
  previous: Dataset,
  next: Dataset,
  manifests: NormManifest[],
  source: Source,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const position = new Map(next.provisions.map((p, i) => [`${p.norm}/${p.id}`, i]));
  const known = new Set(previous.provisions.flatMap(knownActs));
  const changes = report.changes.filter((c) => c.kind !== "removed");
  const names = normNames(manifests);

  const targetsOf = new Map<string, { norm: string; target: ActTarget }[]>();
  for (const cited of actsCitedBy(changes)) {
    const act = cited.label;
    const isNew = !known.has(cited.key);
    if (!cited.url) {
      findings.push(gate("target-matching", "problem", `cannot be resolved to its official page (${cited.problem}), so its commands cannot be read`, { act }));
      continue;
    }
    const snapshot = await source.get(cited.url);
    if (!snapshot) {
      findings.push(gate("target-matching", "problem", `its page ${cited.url} is not in the source`, { act }));
      continue;
    }
    let commands;
    try {
      commands = readActCommands(new TextDecoder(snapshot.encoding).decode(snapshot.body), snapshot.url, names);
    } catch (error) {
      findings.push(gate("target-matching", "problem", `its page could not be read: ${(error as Error).message}`, { act }));
      continue;
    }
    const unverified = verifyActPage(cited.citation, commands.act);
    if (unverified) {
      findings.push(gate("target-matching", "problem", unverified, { act }));
      continue;
    }
    const unread = commands.problems.map((p) => `could not read its commands: ${p}`);
    const targets: { norm: string; target: ActTarget }[] = [];
    for (const target of commands.targets) {
      const norm = manifests.find((m) => m.citedAs === target.norm)?.key;
      if (norm) targets.push({ norm, target });
      else unread.push(`its art. ${target.article} targets ${target.id} of "${target.norm}", a norm this build does not have`);
    }
    // Page order: the order a reader of the change report meets them.
    targets.sort((a, b) => (position.get(`${a.norm}/${a.target.id}`) ?? Infinity) - (position.get(`${b.norm}/${b.target.id}`) ?? Infinity));
    targetsOf.set(cited.key, targets);
    // Fail closed: an act whose commands cannot all be read, or that commands nothing on these norms, explains nothing.
    for (const message of unread) findings.push(gate("target-matching", "problem", message, { act }));
    if (!targets.length) findings.push(gate("target-matching", "problem", "its page holds no command on the norms of this build", { act }));
    if (!isNew) {
      const message = `already in the dataset: each change citing it must be one of its ${targets.length} targets; the others may stay as they are`;
      findings.push(gate("target-matching", "note", message, { act }));
      continue;
    }

    const unapplied = targets.filter(({ norm, target }) => !report.changes.some((c) => c.norm === norm && covers(target, c.id)));
    for (const { norm, target } of unapplied) {
      findings.push(gate("target-matching", "problem", `its art. ${target.article} targets it, but it did not change`, { act, norm, id: target.id }));
    }
    if (!unapplied.length && !unread.length) {
      const list = targets.map(({ norm, target }) => `${norm} ${target.id}`).join(", ");
      findings.push(gate("target-matching", "note", `targets ${targets.length} dispositivos, all changed: ${list}`, { act }));
    }
  }

  for (const c of changes) {
    const cited = citedActs(c);
    if (cited.some((a) => targetsOf.get(a.key)?.some(({ norm, target }) => norm === c.norm && covers(target, c.id)))) continue;
    const about = { norm: c.norm, id: c.id };
    if (c.fields.length === 1 && c.fields[0] === "references") {
      // Planalto adds "Vide" notes (STF cases, other acts) without any amending act; the wording is untouched.
      const notes = referenceDiff(c).join("; ");
      findings.push(gate("target-matching", "note", `changed only its references (${notes}); no act targets it`, about));
      continue;
    }
    const what = c.kind === "added" ? "added" : `${c.kind} (${c.fields.join(", ")})`;
    findings.push(
      gate(
        "target-matching",
        "problem",
        cited.length
          ? `${what}, citing ${cited.map((a) => a.label).join(", ")}, which ${cited.length === 1 ? "does" : "do"} not target it`
          : `${what} without citing an amending act`,
        about,
      ),
    );
  }
  return findings;
}

// --- Deferring acts the manifests do not list ------------------------------------------------------------

export interface DeferredActInput {
  manifests: NormManifest[];
  previous: Dataset;
  report: ChangeReport;
  source: Source;
  /** The build's date (YYYY-MM-DD, Brasília): only changes still to come need the manifest entry. */
  today: string;
}

/**
 * An amending act (an EC, a law, an MP) new to the dataset whose vigência clause defers changes that no manifest lists it for
 * in `deferredActs` (ADR 0003). The compiled page shows such a change only as a "(Vigência)" note, so without the
 * manifest entry its pending wording is never recorded, and the other layers may not notice: the gates accept a
 * references-only change on a target, and the LLM reviewer is not shown one. Each such act blocks with the fix.
 * An act whose page is missing is target matching's to report.
 */
export async function reviewDeferredActs({ manifests, previous, report, source, today }: DeferredActInput): Promise<Finding[]> {
  const known = new Set(previous.provisions.flatMap(knownActs));
  const listed = new Set(manifests.flatMap((m) => m.deferredActs ?? []));
  const names = normNames(manifests);
  const findings: Finding[] = [];
  for (const cited of actsCitedBy(report.changes.filter((c) => c.kind !== "removed"))) {
    const url = cited.url;
    if (!url || known.has(cited.key) || listed.has(url)) continue;
    const act = cited.label;
    const snapshot = await source.get(url);
    if (!snapshot) continue;
    let changes;
    try {
      changes = readAmendingAct(new TextDecoder(snapshot.encoding).decode(snapshot.body), snapshot.url, names).changes;
    } catch (error) {
      const message = `its vigência clause could not be read (${(error as Error).message}); if it defers changes, add ${url} to the deferredActs of the norms it changes`;
      findings.push(gate("deferred-act", "problem", message, { act }));
      continue;
    }
    const due = changes.flatMap((c) => {
      const norm = manifests.find((m) => m.citedAs === c.norm);
      return norm && c.effectiveFrom > today ? [{ norm: norm.key, id: c.id, from: c.effectiveFrom }] : [];
    });
    if (!due.length) continue;
    const list = due.map((d) => `${d.norm} ${d.id} (from ${d.from})`).join(", ");
    const norms = [...new Set(due.map((d) => d.norm))].join(" and ");
    const message = `defers changes to dispositivos the manifests do not list it for: ${list}. Add ${url} to the deferredActs of ${norms}, or its pending wordings are never recorded`;
    findings.push(gate("deferred-act", "problem", message, { act }));
  }
  return findings;
}

/** Whether a command on `target` reaches dispositivo `id`: itself, or anything under a revoked one or a whole article. */
function covers(target: ActTarget, id: string): boolean {
  return target.how === "revoked" || !target.id.includes("_") ? isUnder(id, target.id) : id === target.id;
}

/** An amending act a change or a record cites, whatever its type. */
export interface CitedAct {
  /** `actKey`: "emenda_constitucional:141", "lei:15999". */
  key: string;
  /** How findings and the LLM reviewer name it: "EC 141", "Lei 15.999", "MP 1.393". */
  label: string;
  /** As an annotation cites it (the first one that does). */
  citation: ActCitation;
  /**
   * Its official page, derived from its identity (act-pages.ts): an EC's canonical Planalto URL, any other act's page
   * as its annotation links it once the link is shown to be the act's. Absent when it cannot be resolved; `problem`
   * says why, and such an act blocks the merge, unfetched.
   */
  url?: string;
  problem?: string;
}

const SHORT: Record<ActType, string> = {
  emenda_constitucional: "EC",
  emenda_constitucional_de_revisao: "ECR",
  lei: "Lei",
  lei_complementar: "LC",
  decreto_lei: "Decreto-Lei",
  decreto_legislativo: "Decreto Legislativo",
  decreto: "Decreto",
  medida_provisoria: "MP",
};

export function citedAct(act: ActCitation): CitedAct {
  const page = actPage(act);
  return { key: actKey(act.type, act.number), label: `${SHORT[act.type]} ${act.number}`, citation: act, ...page };
}

/** The acts a record carries (`actKey`s): those it took effect by, and pending ones. */
export function knownActs(record: Provision): string[] {
  const acts = [...record.amendments.map((a) => a.act), ...(record.pending ?? []).map((p) => p.act)];
  return acts.flatMap((a) => (a ? [actKey(a.type, a.number)] : []));
}

/**
 * The amending acts a change cites anew: its new amendment annotations and pending changes, of any act, and the
 * constitutional amendments of its new "Vide" notes (the CF annotates a deferred change with "Vide Emenda
 * Constitucional"; a "Vide Lei" is a cross-reference, not a command). Once each: an act is resolved only when every
 * citation of it resolves (a link to anywhere else, on any of them, leaves it unresolved).
 */
export function citedActs(c: ProvisionChange): CitedAct[] {
  const acts: (ActCitation | undefined)[] = [
    ...c.amendments.map((a) => a.act),
    ...newReferences(c).map((r) => (r.act?.type === "emenda_constitucional" ? r.act : undefined)),
    ...newPending(c).map((p) => p.act),
  ];
  return merged(acts.flatMap((act) => (act ? [citedAct(act)] : [])));
}

function merged(cited: CitedAct[]): CitedAct[] {
  const byKey = new Map<string, CitedAct>();
  for (const one of cited) {
    const seen = byKey.get(one.key);
    if (!seen) byKey.set(one.key, one);
    else if (one.problem && !seen.problem) byKey.set(one.key, { key: seen.key, label: seen.label, citation: seen.citation, problem: one.problem });
    else if (!seen.url && !seen.problem && one.url) byKey.set(one.key, { ...seen, url: one.url });
  }
  return [...byKey.values()];
}

/** Every act the changes cite, once: the constitutional amendments first, by number, then the others by label. */
export function actsCitedBy(changes: ProvisionChange[]): CitedAct[] {
  const ec = (a: CitedAct) => (a.citation.type === "emenda_constitucional" ? 0 : 1);
  const number = (a: CitedAct) => Number(a.citation.number.replace(/\./g, "").replace(/-.*$/, ""));
  return merged(changes.flatMap(citedActs)).sort(
    (a, b) => ec(a) - ec(b) || (ec(a) === 0 ? number(a) - number(b) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
}

/** How acts may name the norms: the CF and the ADCT always, and every manifest's `citedAs`. */
export function normNames(manifests: NormManifest[]): string[] {
  return [...new Set([...NORM_NAMES, ...manifests.flatMap((m) => (m.citedAs ? [m.citedAs] : []))])];
}

function newPending(c: ProvisionChange): NonNullable<Provision["pending"]> {
  const before = new Set((c.before?.pending ?? []).map((p) => JSON.stringify(p)));
  return (c.after?.pending ?? []).filter((p) => !before.has(JSON.stringify(p)));
}

function newReferences(c: ProvisionChange): Reference[] {
  const before = new Set((c.before?.references ?? []).map((r) => JSON.stringify(r)));
  return (c.after?.references ?? []).filter((r) => !before.has(JSON.stringify(r)));
}

function referenceDiff(c: ProvisionChange): string[] {
  const after = new Set((c.after?.references ?? []).map((r) => JSON.stringify(r)));
  const gone = (c.before?.references ?? []).filter((r) => !after.has(JSON.stringify(r)));
  return [...newReferences(c).map((r) => `+ ${r.annotation}`), ...gone.map((r) => `− ${r.annotation}`)];
}

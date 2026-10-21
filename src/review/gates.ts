// Review layer 1: deterministic gates over a new build and its change report. Each gate returns findings; a problem
// from any of them makes the verdict `needs-human` (see verdict.ts).
import { createHash } from "node:crypto";
import { isUnder, readActCommands, type ActTarget } from "../pipeline/acts.ts";
import type { NormManifest } from "../pipeline/build.ts";
import type { ChangeReport, ProvisionChange } from "../pipeline/changes.ts";
import {
  NOTICE,
  type ActCitation,
  type Dataset,
  type Provision,
  type ProvisionKind,
  type ProvisionStatus,
  type Reference,
} from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";
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
 * Schema, id stability (no removal without a revocation mark, no revoked id back in force), structural invariants and
 * target matching, in that order. The golden set and the full-text snapshot are test suites over the recorded
 * fixtures and gate every PR through `pnpm verify`; on a refresh, target matching is what explains each changed text.
 */
export async function reviewGates({ manifests, next, report, source }: GateInput): Promise<Finding[]> {
  return [
    ...schema(next),
    ...removals(report),
    ...idReuse(report),
    ...invariants(next),
    ...(await targetMatching(report, next, manifests, source)),
  ];
}

/** Planalto's page for an Emenda Constitucional. */
function ecPageUrl(number: string): string {
  return `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc${number}.htm`;
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

// --- Target matching --------------------------------------------------------------------------------------

/**
 * The changed dispositivos must be exactly the ones the amending acts' commands target, both ways.
 * - A change is explained when an act it cites targets it (a revocation, or a whole article, also covers everything
 *   under it).
 * - A target is applied when its record changed in this report, whatever changed on it: the text in force, or a
 *   pending wording (deferred vigência, #6). It is also applied when the new record already cites the act, as an
 *   amendment or a pending change: the act took effect earlier, and the page is only catching up (ADR 0003).
 * - A dispositivo that vanished is the removal gate's; it counts as touched here, so it is reported once.
 */
async function targetMatching(report: ChangeReport, next: Dataset, manifests: NormManifest[], source: Source): Promise<Finding[]> {
  const findings: Finding[] = [];
  const position = new Map(next.provisions.map((p, i) => [`${p.norm}/${p.id}`, i]));
  const records = new Map(next.provisions.map((p) => [`${p.norm}/${p.id}`, p]));
  const changes = report.changes.filter((c) => c.kind !== "removed");
  const numbers = [...new Set(changes.flatMap(citedEcs))].sort((a, b) => Number(a) - Number(b));

  const targetsOf = new Map<string, { norm: string; target: ActTarget }[]>();
  for (const number of numbers) {
    const act = `EC ${number}`;
    const url = ecPageUrl(number);
    const snapshot = await source.get(url);
    if (!snapshot) {
      findings.push(gate("target-matching", "problem", `its page ${url} is not in the source`, { act }));
      continue;
    }
    let commands;
    try {
      commands = readActCommands(new TextDecoder(snapshot.encoding).decode(snapshot.body), snapshot.url);
    } catch (error) {
      findings.push(gate("target-matching", "problem", `its page could not be read: ${(error as Error).message}`, { act }));
      continue;
    }
    const problems = commands.problems.map((p) => `could not read its commands: ${p}`);
    const targets: { norm: string; target: ActTarget }[] = [];
    for (const target of commands.targets) {
      const norm = manifests.find((m) => m.citedAs === target.norm)?.key;
      if (norm) targets.push({ norm, target });
      else problems.push(`its art. ${target.article} targets ${target.id} of "${target.norm}", a norm this build does not have`);
    }
    // Page order: the order a reader of the change report meets them.
    targets.sort((a, b) => (position.get(`${a.norm}/${a.target.id}`) ?? Infinity) - (position.get(`${b.norm}/${b.target.id}`) ?? Infinity));
    targetsOf.set(number, targets);
    for (const problem of problems) findings.push(gate("target-matching", "problem", problem, { act }));

    const unapplied = targets.filter(
      ({ norm, target }) =>
        !report.changes.some((c) => c.norm === norm && covers(target, c.id)) &&
        !citesAct(records.get(`${norm}/${target.id}`), number),
    );
    for (const { norm, target } of unapplied) {
      findings.push(gate("target-matching", "problem", `its art. ${target.article} targets it, but it did not change`, { act, norm, id: target.id }));
    }
    if (!unapplied.length && !problems.length) {
      const list = targets.map(({ norm, target }) => `${norm} ${target.id}`).join(", ");
      findings.push(gate("target-matching", "note", `targets ${targets.length} dispositivos, all applied: ${list}`, { act }));
    }
  }

  for (const c of changes) {
    const cited = citedEcs(c);
    if (cited.some((n) => targetsOf.get(n)?.some(({ norm, target }) => norm === c.norm && covers(target, c.id)))) continue;
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
          ? `${what}, citing ${cited.map((n) => `EC ${n}`).join(", ")}, which ${cited.length === 1 ? "does" : "do"} not target it`
          : `${what} without citing an amending act`,
        about,
      ),
    );
  }
  return findings;
}

/** Whether a command on `target` reaches dispositivo `id`: itself, or anything under a revoked one or a whole article. */
function covers(target: ActTarget, id: string): boolean {
  return target.how === "revoked" || !target.id.includes("_") ? isUnder(id, target.id) : id === target.id;
}

/** Whether a record already carries EC `number`: as an amendment it took effect by, or as a pending change. */
function citesAct(record: Provision | undefined, number: string): boolean {
  const ec = (a: ActCitation | undefined) => a?.type === "emenda_constitucional" && a.number === number;
  return !!record && (record.amendments.some((a) => ec(a.act)) || (record.pending ?? []).some((p) => ec(p.act)));
}

/** The constitutional amendments a change cites anew: new amendment annotations, "Vide" notes or pending changes. */
function citedEcs(c: ProvisionChange): string[] {
  const acts: (ActCitation | undefined)[] = [
    ...c.amendments.map((a) => a.act),
    ...newReferences(c).map((r) => r.act),
    ...newPending(c).map((p) => p.act),
  ];
  return [...new Set(acts.filter((a) => a?.type === "emenda_constitucional").map((a) => a!.number))];
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

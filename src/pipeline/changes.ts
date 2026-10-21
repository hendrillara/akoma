// Change detection: compares a new build with the previous dataset and describes what changed, per dispositivo, with
// the amending act behind each change. The report is data (for the review gates) and Markdown (for the PR body).
import { createHash } from "node:crypto";
import type { Finding, ReviewLayer, Verdict } from "../review/verdict.ts";
import type { Amendment, Dataset, PathSegment, Provision, Reference } from "../schema/dataset.ts";
import { escape } from "../render/markdown.ts";
import { pathLabel } from "../schema/lexml.ts";

/**
 * `added`: a new id. `changed`: any part of the record moved (text, label, status, annotations…). `revoked`: the
 * record became `revoked`. `removed`: the id vanished with no revocation mark, which the review gates must stop.
 * `pending-activated`: the build promoted a pending change because its start date came (deferred vigência, ADR 0003):
 * the record gained an amendment carrying `effectiveFrom`. It takes precedence over `changed` and `revoked`.
 */
export type ChangeKind = "added" | "changed" | "pending-activated" | "revoked" | "removed";

/**
 * A record's fields that take part in change detection: everything but its provenance (retrieval time, version,
 * secondary-source outcome…) and its aliases, which come from the secondary source and change with it.
 */
export type RecordField = Exclude<keyof Provision, "provenance" | "aliases">;

export interface ProvisionChange {
  kind: ChangeKind;
  norm: string;
  id: string;
  /** Fields that differ, in record order; empty for `added` and `removed`. */
  fields: RecordField[];
  /** Amendments the new record cites and the previous one did not: the act behind the change (none for `removed`). */
  amendments: Amendment[];
  before?: Provision;
  after?: Provision;
}

/** Whether a value moved since the previous dataset; `new` when the previous dataset did not have the page. */
export type Comparison = "same" | "changed" | "new";

/** The pre-filter's view of one source page: its headers and its content without `<script>` elements. */
export interface PageCheck {
  url: string;
  etag: Comparison;
  lastModified: Comparison;
  content: Comparison;
}

export interface ChangeReport {
  pages: PageCheck[];
  /** In the new dataset's order; dispositivos that vanished come last, in the previous dataset's order. */
  changes: ProvisionChange[];
}

/**
 * The real change signal is a fingerprint of each whole record (provenance excluded), not `provenance.contentHash`,
 * which covers only the text: a revocation, a renumbering or a new "Vide" note can leave the text as it was.
 */
export function detectChanges(previous: Dataset, next: Dataset): ChangeReport {
  const key = (p: Provision) => `${p.norm}/${p.id}`;
  const before = new Map(previous.provisions.map((p) => [key(p), p]));
  const seen = new Set<string>();
  const changes: ProvisionChange[] = [];

  for (const after of next.provisions) {
    seen.add(key(after));
    const old = before.get(key(after));
    if (old && fingerprint(old) === fingerprint(after)) continue;
    changes.push(change(old, after));
  }
  for (const old of previous.provisions) if (!seen.has(key(old))) changes.push(change(old, undefined));

  return { pages: (next.pages ?? []).map((page) => checkPage(previous, page)), changes };
}

function change(before: Provision | undefined, after: Provision | undefined): ProvisionChange {
  const record = (after ?? before)!;
  const cited = new Set((before?.amendments ?? []).map(canonical));
  const amendments = (after?.amendments ?? []).filter((a) => !cited.has(canonical(a)));
  const kind: ChangeKind = !before
    ? "added"
    : !after
      ? "removed"
      : amendments.some((a) => a.effectiveFrom !== undefined)
        ? "pending-activated"
        : after.status === "revoked" && before.status !== "revoked"
          ? "revoked"
          : "changed";
  const fields = before && after ? recordFields(before, after).filter((f) => canonical(before[f]) !== canonical(after[f])) : [];
  return {
    kind,
    norm: record.norm,
    id: record.id,
    fields,
    amendments,
    ...(before && { before }),
    ...(after && { after }),
  };
}

/** Both records' fields but provenance and aliases, in the new record's order; fields added later (e.g. `pending`) count. */
function recordFields(before: Provision, after: Provision): RecordField[] {
  const keys = new Set([...Object.keys(after), ...Object.keys(before)]);
  keys.delete("provenance");
  keys.delete("aliases");
  return [...keys] as RecordField[];
}

function fingerprint(provision: Provision): string {
  const { provenance: _, aliases: __, ...record } = provision;
  return createHash("sha256").update(canonical(record), "utf8").digest("hex");
}

/** JSON with object keys sorted, so two equal records serialise the same whatever order their fields were set in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  ) ?? "undefined";
}

function checkPage(previous: Dataset, page: NonNullable<Dataset["pages"]>[number]): PageCheck {
  const old = previous.pages?.find((p) => p.url === page.url);
  const compare = (a: string | undefined, b: string | undefined): Comparison => (!old ? "new" : a === b ? "same" : "changed");
  return {
    url: page.url,
    etag: compare(old?.etag, page.etag),
    lastModified: compare(old?.lastModified, page.lastModified),
    content: compare(old?.contentHash, page.contentHash),
  };
}

// --- Markdown -----------------------------------------------------------------------------------------------

/** Section heading and summary wording per kind, in report order. */
const SECTIONS: Record<ChangeKind, { heading: string; summary: string }> = {
  added: { heading: "Added", summary: "added" },
  changed: { heading: "Changed", summary: "changed" },
  "pending-activated": { heading: "Pending activated", summary: "pending activated" },
  revoked: { heading: "Revoked", summary: "revoked" },
  removed: { heading: "Removed without a revocation mark", summary: "removed without a revocation mark" },
};

/**
 * The report as a PR body: a summary, the review verdict with its reasons (when given), the page pre-filter table,
 * then one section per kind of change.
 */
export function renderChangeReport(report: ChangeReport, verdict?: Verdict): string {
  const kinds = (Object.keys(SECTIONS) as ChangeKind[])
    .map((kind) => ({ kind, changes: report.changes.filter((c) => c.kind === kind) }))
    .filter((s) => s.changes.length);
  const total = report.changes.length;
  const summary = total
    ? `${total} ${total === 1 ? "dispositivo" : "dispositivos"} changed: ${kinds.map((s) => `${s.changes.length} ${SECTIONS[s.kind].summary}`).join(", ")}.`
    : "No dispositivo changed.";

  const out = ["## Change report", "", summary, ""];
  if (verdict) out.push(...verdictLines(verdict), "");
  if (report.pages.length) {
    out.push("| Page | ETag | Last-Modified | Content (without scripts) |", "| --- | --- | --- | --- |");
    for (const p of report.pages) out.push(`| ${p.url} | ${p.etag} | ${p.lastModified} | ${p.content} |`);
    out.push("");
  }
  for (const section of kinds) {
    out.push(`### ${SECTIONS[section.kind].heading} (${section.changes.length})`, "");
    for (const c of section.changes) out.push(...changeLines(c));
    out.push("");
  }
  return out.join("\n");
}

const LAYERS: Record<ReviewLayer, string> = {
  gates: "the deterministic gates",
  "cross-source": "the cross-source check",
  llm: "the LLM reviewer",
};

function verdictLines({ decision, findings }: Verdict): string[] {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const problems = findings.filter((f) => f.severity === "problem").length;
  const layers = [...new Set(findings.map((f) => LAYERS[f.layer]))];
  const tally = findings.length
    ? `${count(problems, "problem")} and ${count(findings.length - problems, "note")} from ${layers.join(", ")}.`
    : "Nothing to report.";
  return [`### Verdict: ${decision}`, "", `${tally} Any problem stops the automatic merge.`, "", ...findings.map(findingLine)];
}

function findingLine(f: Finding): string {
  const subject = [f.act, f.norm !== undefined && f.id !== undefined ? `${f.norm} \`${f.id}\`` : undefined].filter(Boolean).join(" ");
  return `- ${f.severity === "problem" ? "**Problem**" : "Note"} · ${f.check}${subject ? ` · ${subject}` : ""}: ${escape(f.message)}`;
}

function changeLines(c: ProvisionChange): string[] {
  const record = (c.after ?? c.before)!;
  const lines = [`- **${c.norm} \`${c.id}\`** · ${pathText(record.path)}`];
  const item = (text: string) => lines.push(`  - ${text}`);
  const quote = (text: string) => (text ? escape(text) : "*(none)*");

  if (c.kind === "removed") {
    item(`Text before: ${quote(c.before!.text)}`);
    item("Vanished from the page with no revocation mark.");
    return lines;
  }
  item(`Act: ${c.amendments.length ? c.amendments.map((a) => escape(a.annotation)).join("; ") : "none cited"}`);
  if (c.kind === "added") {
    item(`Text: ${quote(c.after!.text)}`);
    return lines;
  }

  const before = c.before!;
  const after = c.after!;
  for (const field of c.fields) {
    if (field === "label") item(`Label: ${before.label} → ${after.label}`);
    else if (field === "path") {
      // A new label already shows a move of the last segment.
      if (!c.fields.includes("label") || pathText(before.path.slice(0, -1)) !== pathText(after.path.slice(0, -1))) {
        item(`Path: ${pathText(before.path)} → ${pathText(after.path)}`);
      }
    } else if (field === "text") {
      item(`Text before: ${quote(before.text)}`);
      item(`Text after: ${quote(after.text)}`);
    } else if (field === "status") item(`Status: \`${before.status}\` → \`${after.status}\``);
    else if (field === "amendments") {
      // The ones gained are the act line above.
      const dropped = notIn(before.amendments, after.amendments);
      if (dropped.length) item(`No longer cited: ${dropped.map((a) => escape(a.annotation)).join("; ")}`);
    } else if (field === "references") {
      const notes = [
        ...notIn(after.references, before.references).map((r) => `+ ${escape(r.annotation)}`),
        ...notIn(before.references, after.references).map((r) => `− ${escape(r.annotation)}`),
      ];
      item(`References: ${notes.join("; ")}`);
    } else if (field === "pending") item(`Pending: ${pendingText(before)} → ${pendingText(after)}`);
    else item(`\`${field}\`: \`${canonical(before[field])}\` → \`${canonical(after[field])}\``);
  }
  return lines;
}

function notIn<T extends Amendment | Reference>(these: T[], those: T[]): T[] {
  const there = new Set(those.map(canonical));
  return these.filter((x) => !there.has(canonical(x)));
}

/** "wording from 2026-12-17; revoked from 2033-01-01", or "none". */
function pendingText(provision: Provision): string {
  const entries = provision.pending ?? [];
  return entries.length ? entries.map((e) => `${e.effect} from ${e.effectiveFrom}`).join("; ") : "none";
}

function pathText(path: PathSegment[]): string {
  return pathLabel(path);
}

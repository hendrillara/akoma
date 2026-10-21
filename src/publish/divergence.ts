// The text-divergence intake (#18), the part shared by the recheck and the daily job: reading the issue form, which is
// untrusted input, into a request made only of values found in the dataset; and the markers the job leaves in its own
// comments, which are the intake's only state (what was rechecked on which day, which confirmed divergence still
// awaits the daily job's PR). Nothing here returns text from the issue: a request holds a registered norm key and
// dataset ids, and a reason code when the form cannot be read.
import type { Dataset } from "../schema/dataset.ts";
import type { LabelledIssue } from "./github.ts";

/** The label the issue form applies; the recheck workflow runs only for issues that carry it. */
export const DIVERGENCE_LABEL = "text-divergence";

/** The form's field labels, exactly as in .github/ISSUE_TEMPLATE/text-divergence.yml (GitHub renders "### <label>"). */
const FIELDS = { norm: "Norma / Norm", dispositivo: "Dispositivo / Provision" } as const;

/** Longer field values are refused before any pattern runs on them. */
const MAX_NORM = 120;
const MAX_DISPOSITIVO = 120;
/** GitHub caps an issue body at 65,536 characters; anything longer did not come from GitHub. */
const MAX_BODY = 65_536;

/** A dispositivo, or a whole article (every dispositivo whose id starts with the article's). */
export interface Target {
  kind: "provision" | "article";
  /** A dataset id: "art5_cpt_inc10", or an article id such as "art6". */
  id: string;
}

export type InvalidReason = "no-form" | "norm" | "dispositivo" | "ambiguous";

export type DivergenceRequest = { ok: true; norm: string; target: Target } | { ok: false; reason: InvalidReason; norm?: string };

/**
 * The norm and the dispositivo an issue asks about, as values of the dataset. The "what looks wrong" field is never
 * read. A dispositivo is given as its id, a normas.leg.br alias of it, or its label as printed ("art. 5º, inciso X",
 * "inciso X do caput do art. 5º", "art. 6º"), which is matched against the dataset's own labels and must match one.
 */
export function readRequest(body: string | null | undefined, normKeys: string[], dataset: Dataset): DivergenceRequest {
  if (!body || body.length > MAX_BODY) return { ok: false, reason: "no-form" };
  const fields = sections(body);
  const normField = fields.get(FIELDS.norm);
  const dispositivoField = fields.get(FIELDS.dispositivo);
  if (normField === undefined || dispositivoField === undefined) return { ok: false, reason: "no-form" };

  if (normField.length > MAX_NORM) return { ok: false, reason: "norm" };
  // A dropdown option ("cf — Constituição Federal") or the bare key; the name after the dash is never read.
  const key = /^([a-z]{2,12})(?: — [^\n]*)?$/i.exec(normField)?.[1]?.toLowerCase();
  if (!key || !normKeys.includes(key)) return { ok: false, reason: "norm" };

  if (!dispositivoField || dispositivoField.length > MAX_DISPOSITIVO) return { ok: false, reason: "dispositivo", norm: key };
  const target = resolve(dispositivoField.replace(/^`+|`+$/g, "").trim(), key, dataset);
  return "reason" in target ? { ok: false, reason: target.reason, norm: key } : { ok: true, norm: key, target };
}

/** "### <label>" sections of a form body, each value trimmed, "_No response_" read as empty. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let label: string | undefined;
  let lines: string[] = [];
  const close = () => {
    if (label !== undefined && !out.has(label)) {
      const value = lines.join("\n").trim();
      out.set(label, value === "_No response_" ? "" : value);
    }
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("### ")) {
      close();
      label = line.slice(4).trim();
      lines = [];
    } else lines.push(line);
  }
  close();
  return out;
}

function resolve(given: string, norm: string, dataset: Dataset): Target | { reason: "dispositivo" | "ambiguous" } {
  const provisions = dataset.provisions.filter((p) => p.norm === norm);
  const articles = new Set(provisions.map((p) => p.id.split("_")[0]!));
  const lower = given.toLowerCase();
  if (provisions.some((p) => p.id === lower)) return { kind: "provision", id: lower };
  if (articles.has(lower)) return { kind: "article", id: lower };
  const aliased = provisions.filter((p) => p.aliases?.includes(given));
  if (aliased.length === 1) return { kind: "provision", id: aliased[0]!.id };

  // A label as printed: compared, as a citation key, with the key of every dispositivo's path from its article down.
  const wanted = citationKey(given);
  if (!wanted) return { reason: "dispositivo" };
  const matches = new Set<string>();
  for (const p of provisions) {
    const from = p.path.findIndex((s) => s.kind === "artigo");
    if (from < 0) continue;
    const labels = p.path.slice(from).map((s) => s.label);
    if (citationKey(labels.join(" ")) === wanted) matches.add(`provision:${p.id}`);
    if (citationKey(labels[0]!) === wanted) matches.add(`article:${p.id.split("_")[0]}`);
  }
  if (matches.size > 1) return { reason: "ambiguous" };
  const [match] = matches;
  if (!match) return { reason: "dispositivo" };
  const [kind, id] = match.split(":") as ["provision" | "article", string];
  return { kind, id };
}

const KINDS: Record<string, { kind: string; rank: number }> = {
  art: { kind: "art", rank: 0 },
  artigo: { kind: "art", rank: 0 },
  paragrafo: { kind: "paragrafo", rank: 1 },
  par: { kind: "paragrafo", rank: 1 },
  caput: { kind: "caput", rank: 1 },
  cpt: { kind: "caput", rank: 1 },
  inciso: { kind: "inciso", rank: 2 },
  inc: { kind: "inciso", rank: 2 },
  alinea: { kind: "alinea", rank: 3 },
  al: { kind: "alinea", rank: 3 },
  item: { kind: "item", rank: 4 },
};
const LINKING = new Set(["do", "da", "de", "e"]);

/**
 * A citation as a key that ignores spelling: "Art. 5º, inciso X" and "inciso X do caput do art. 5º" are both
 * "art 5 inciso x"; `undefined` when a word is not part of a citation. Linear: no pattern backtracks.
 */
export function citationKey(text: string): string | undefined {
  const words = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/§/g, " paragrafo ")
    .replace(/(\d)\s?[º°ª]/g, "$1 ")
    .replace(/(\d)o\b/g, "$1 ")
    .replace(/[^a-z0-9-]+/g, " ")
    .split(" ")
    .filter((w) => w && w !== "-" && !LINKING.has(w));
  const parts: { kind: string; rank: number; value?: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    const kind = KINDS[words[i]!];
    if (!kind) return undefined;
    if (kind.kind === "caput") {
      parts.push(kind);
      continue;
    }
    const value = words[++i];
    if (!value || KINDS[value]) return undefined;
    parts.push({ ...kind, value });
  }
  if (!parts.length) return undefined;
  // An inciso of the caput is cited with or without "do caput"; its path has no caput segment.
  const below = parts.some((p) => p.rank > 1);
  return parts
    .filter((p) => !(below && p.kind === "caput"))
    .sort((a, b) => a.rank - b.rank)
    .map((p) => (p.value ? `${p.kind} ${p.value}` : p.kind))
    .join(" ");
}

// --- Markers: the intake's state, in the job's own comments ----------------------------------------------------

/** What a recheck ended with; `duplicate`, `limited` and `invalid` fetched nothing. */
export type RecheckOutcome = "confirmed" | "not-confirmed" | "unreachable" | "invalid" | "duplicate" | "limited";

export interface Marker {
  kind: "recheck" | "followup";
  /** The Brasília day it was written. */
  day: string;
  /** "-" when the form named no valid norm or target. */
  norm: string;
  target: string;
  outcome?: RecheckOutcome;
}

const MARKER = /<!-- akoma:(recheck|followup) ([a-z0-9=_ .-]{1,200}) -->/g;

/** The hidden line that starts each of the job's comments on a divergence issue: validated values only. */
export function marker(m: Marker): string {
  const outcome = m.outcome ? ` outcome=${m.outcome}` : "";
  return `<!-- akoma:${m.kind} day=${m.day} norm=${m.norm} target=${m.target}${outcome} -->`;
}

/** The markers in one of the job's own comments (never read from anything else: anyone can write a marker). */
export function markers(comment: string): Marker[] {
  const out: Marker[] = [];
  for (const [, kind, fields] of comment.matchAll(MARKER)) {
    const f = Object.fromEntries(fields!.split(" ").map((pair) => pair.split("=") as [string, string]));
    if (!f.day || !f.norm || !f.target) continue;
    out.push({ kind: kind as Marker["kind"], day: f.day, norm: f.norm, target: f.target, ...(f.outcome && { outcome: f.outcome as RecheckOutcome }) });
  }
  return out;
}

export const sameMarker = (a: Marker, b: Marker) =>
  a.kind === b.kind && a.day === b.day && a.norm === b.norm && a.target === b.target && a.outcome === b.outcome;

/** A confirmed divergence still waiting for the daily job's PR: an open issue whose latest marker is that confirmation. */
export interface PendingRecheck {
  issue: number;
  norm: string;
  target: string;
}

export function pendingRechecks(issues: LabelledIssue[]): PendingRecheck[] {
  return issues
    .filter((i) => i.state === "open")
    .flatMap((i) => {
      const last = i.ownComments.flatMap(markers).at(-1);
      return last?.kind === "recheck" && last.outcome === "confirmed" ? [{ issue: i.number, norm: last.norm, target: last.target }] : [];
    })
    .sort((a, b) => a.issue - b.issue);
}

/** Whether a dataset id belongs to a target id: the id itself, or a dispositivo of the article (ids without "_"). */
export function inTarget(target: string, id: string): boolean {
  return target.includes("_") ? id === target : id.split("_")[0] === target;
}

/** A fence longer than any run of backticks in `text`, so quoted text can never close it. */
export function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

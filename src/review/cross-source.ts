// Review layer 2: cross-source agreement (ADR 0004). Each dispositivo's primary text is compared with the norm's
// secondary source, matched by the id its printed labels give it, and gets one outcome: `agrees`, `secondary-stale`
// or `unconfirmed`, with a note. An unexplained divergence is a `problem` finding, which blocks the merge.
import type {
  CrossSourceFinding,
  CrossSourceStatus,
  Dataset,
  Provision,
  SecondaryAgreement,
  SecondaryOutcome,
  SecondarySourceName,
} from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";
import type { NormManifest } from "../pipeline/build.ts";
import { KNOWN_DIVERGENCES, type KnownDivergence } from "./known-divergences.ts";
import { readLegin } from "./legin.ts";
import { readNormas } from "./normas.ts";
import { actKey, type SecondaryDispositivo } from "./secondary.ts";
import type { Finding } from "./verdict.ts";

/** The parts of a dispositivo the check reads. */
export type Checked = Pick<Provision, "id" | "text" | "status" | "amendments" | "pending">;

export interface CrossCheck {
  agreement: Map<string, SecondaryAgreement>;
  /** The secondary's own ids where they differ from Akoma's, per Akoma id. */
  aliases: Map<string, string[]>;
  status: CrossSourceStatus;
}

/**
 * Below this share of the primary's dispositivos found in the secondary, the secondary is assumed to have changed
 * shape (a renamed field turns every dispositivo into "missing"), and the build fails rather than pass vacuously.
 */
const ALIGNMENT_FLOOR = 0.95;
/**
 * Below this share of matched dispositivos whose wordings agree outright, the secondary is assumed to have changed
 * shape too (a renamed `text` field empties every wording); on the 2026-10-20/21 captures it is 95% (ADCT) to 98%.
 */
const AGREEMENT_FLOOR = 0.8;

export const NORMAS_ATTRIBUTION =
  "Aliases: URN fragments from normas.leg.br / LexML Brasil, © Senado Federal, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).";

/** Layer 2's findings for the verdict: `decide(gateFindings, crossSourceFindings(next), …)`. */
export function crossSourceFindings(dataset: Dataset): Finding[] {
  return (dataset.status?.crossSource ?? []).flatMap((s) => s.findings);
}

export async function crossCheck(manifest: NormManifest, provisions: Checked[], source: Source, kept = KNOWN_DIVERGENCES): Promise<CrossCheck> {
  const declared = manifest.secondarySources.find((s) => s.verified.usable);
  if (!declared) {
    return unconfirmedNorm(manifest.key, provisions, "No usable secondary source is declared for this norm.");
  }
  const snapshot = await source.get(declared.url);
  if (!snapshot) {
    return unconfirmedNorm(manifest.key, provisions, `The secondary source ${declared.name} was unavailable on this run.`, declared.name);
  }
  const body = new TextDecoder(snapshot.encoding).decode(snapshot.body);
  const secondary = declared.name === "normas.leg.br" ? readNormas(body, manifest.urn) : readLegin(body, snapshot.url);
  const { agreement, aliases, findings } = compare(manifest.key, declared.name, provisions, secondary, kept);
  return {
    agreement,
    aliases,
    status: {
      norm: manifest.key,
      source: { name: declared.name, url: snapshot.url, retrievedAt: snapshot.retrievedAt },
      outcomes: counts(agreement),
      findings,
    },
  };
}

function unconfirmedNorm(norm: string, provisions: Checked[], note: string, source?: SecondarySourceName): CrossCheck {
  const agreement = new Map(provisions.map((p) => [p.id, { outcome: "unconfirmed" as const, ...(source && { source }), note }]));
  return {
    agreement,
    aliases: new Map(),
    status: {
      norm,
      outcomes: { agrees: 0, "secondary-stale": 0, unconfirmed: provisions.length },
      findings: [{ layer: "cross-source", check: "unconfirmed", severity: "note", norm, message: `${note} Every dispositivo is unconfirmed.` }],
    },
  };
}

interface Compared {
  agreement: Map<string, SecondaryAgreement>;
  aliases: Map<string, string[]>;
  findings: CrossSourceFinding[];
}

function compare(
  norm: string,
  source: SecondarySourceName,
  provisions: Checked[],
  secondary: SecondaryDispositivo[],
  allKnown: KnownDivergence[],
): Compared {
  const agreement = new Map<string, SecondaryAgreement>();
  const aliases = new Map<string, string[]>();
  const findings: CrossSourceFinding[] = [];
  const byId = new Map<string, SecondaryDispositivo[]>();
  for (const s of secondary) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  const primary = new Map(provisions.map((p) => [p.id, p]));
  const known = allKnown.filter((k) => k.norm === norm && k.source === source);
  const used = new Set<KnownDivergence>();

  const finding = (check: string, severity: CrossSourceFinding["severity"], id: string | undefined, message: string, act?: string) =>
    findings.push({ layer: "cross-source", check, severity, norm, ...(id && { id }), ...(act && { act }), message });
  const record = (id: string, outcome: SecondaryOutcome, note?: string, check?: string, act?: string, severity: CrossSourceFinding["severity"] = "note") => {
    agreement.set(id, { outcome, source, ...(note && { note }) });
    if (check && note) finding(check, severity, id, note, act);
  };

  /** The secondary's dispositivo for this id; when its labels repeat, the one whose wording agrees. */
  const counterpart = (p: Checked) => {
    const candidates = byId.get(p.id) ?? [];
    return candidates.find((c) => comparable(c.text) === comparable(p.text)) ?? candidates[0];
  };
  /** The ids above a dispositivo, nearest first; an article's own annotations live on its caput. */
  const above = (id: string) => {
    const segments = id.split("_");
    const ids: string[] = [];
    for (let n = segments.length - 1; n > 0; n--) ids.push(segments.slice(0, n).join("_"), `${segments.slice(0, n).join("_")}_cpt`);
    return ids;
  };
  /** Amending acts the primary cites for this dispositivo that the secondary does not record, as the primary cites them. */
  const uncitedActs = (p: Checked, recorded: Set<string>) => [
    ...new Set(p.amendments.filter((a) => a.act && !recorded.has(actKey(a.act.type, a.act.number))).map((a) => a.act!.citation)),
  ];

  const comparableIds = provisions.filter((p) => p.status !== "not_yet_in_force");
  const found = comparableIds.filter((p) => byId.has(p.id)).length;
  if (comparableIds.length && found / comparableIds.length < ALIGNMENT_FLOOR) {
    throw new Error(
      `${norm}: only ${found} of ${comparableIds.length} dispositivos were found in ${source}; its response has probably changed shape (ADR 0004)`,
    );
  }

  const matched = comparableIds.filter((p) => byId.has(p.id));
  const equal = matched.filter((p) => byId.get(p.id)!.some((c) => comparable(c.text) === comparable(p.text))).length;
  if (matched.length && equal / matched.length < AGREEMENT_FLOOR) {
    throw new Error(
      `${norm}: only ${equal} of ${matched.length} matched dispositivos agree with ${source}; its response has probably changed shape (ADR 0004)`,
    );
  }

  for (const p of provisions) {
    const own = [...new Set((byId.get(p.id) ?? []).flatMap((c) => (c.alias ? [c.alias] : [])))];
    if (own.length) aliases.set(p.id, own);
    const s = counterpart(p);

    if (p.status === "not_yet_in_force") {
      record(p.id, "unconfirmed", "Not yet in force: there is no wording in force to confirm.", "not-yet-in-force");
      continue;
    }
    if (!s) {
      const nearest = above(p.id).map((id) => byId.get(id)?.[0]).find((x) => x !== undefined);
      const missing = uncitedActs(p, nearest?.acts ?? new Set());
      if (missing.length && p.amendments.some((a) => a.effect === "inserted")) {
        record(p.id, "secondary-stale", staleNote(missing[0]!, source), "secondary-stale", missing[0]);
      } else {
        const marked = p.status === "revoked" || p.status === "vetoed";
        record(p.id, "unconfirmed", `${source} has no dispositivo with this label.`, "missing-in-secondary", undefined, marked ? "note" : "problem");
      }
      continue;
    }

    if (comparable(p.text) === comparable(s.text) || ((p.status === "revoked" || p.status === "vetoed") && s.status === p.status)) {
      record(p.id, "agrees");
      continue;
    }
    const ahead = deferredAhead(p, s);
    if (ahead) {
      record(
        p.id,
        "agrees",
        `${source} already shows the change by ${ahead.citation} as current, dated from its publication; it takes effect on ${ahead.effectiveFrom} (see pending). The wording in force matches the secondary's previous version.`,
        "secondary-misdates-vigencia",
        ahead.citation,
      );
      continue;
    }
    const missing = uncitedActs(p, s.acts);
    if (missing.length) {
      record(p.id, "secondary-stale", staleNote(missing[0]!, source), "secondary-stale", missing[0]);
      continue;
    }
    const entry = known.find((k) => k.id === p.id && explains(k, p.text, s.text));
    if (entry) {
      used.add(entry);
      record(p.id, entry.right === "primary" ? "agrees" : "unconfirmed", `Known divergence, reviewed: ${entry.reason}`, "known-divergence");
      continue;
    }
    record(
      p.id,
      "unconfirmed",
      `The wording differs from ${source} and no amending act or reviewed known divergence explains it; held for review.`,
      "divergence",
      undefined,
      "problem",
    );
  }

  // Dispositivos only the secondary has.
  let underRevoked = 0;
  for (const [id, candidates] of byId) {
    if (primary.has(id)) continue;
    const status = candidates[0]!.status;
    if (above(id).some((a) => primary.get(a)?.status === "revoked")) underRevoked++;
    else if (status !== "in_force") {
      finding(`secondary-only-${status}`, "note", id, `${source} prints a ${status} dispositivo the primary omits; nothing in force differs.`);
    } else {
      finding("missing-in-primary", "problem", id, `${source} has a dispositivo in force with this label that the primary build does not; the parser may have dropped it.`);
    }
  }
  if (underRevoked) {
    finding("secondary-only-under-revoked", "note", undefined, `${underRevoked} dispositivos only in ${source} sit under revoked dispositivos, which the primary prints as one line.`);
  }
  for (const k of known) {
    if (!used.has(k)) finding("known-divergence-unused", "note", k.id, "A reviewed known divergence no longer applies; remove it from src/review/known-divergences.ts.");
  }
  return { agreement, aliases, findings };
}

/**
 * normas.leg.br versions by publication, not vigência: it shows a deferred change as current from the day the act
 * was published (EC 141, art. 7º XV). That is the secondary being early, not the primary being wrong, when the
 * primary holds that very change as pending and its wording in force is the secondary's previous version.
 */
function deferredAhead(p: Checked, s: SecondaryDispositivo): { citation: string; effectiveFrom: string } | undefined {
  const history = s.history ?? [];
  const latest = history.at(-1);
  if (!latest?.act || history.length < 2) return undefined;
  for (const change of p.pending ?? []) {
    if (actKey(change.act.type, change.act.number) !== latest.act) continue;
    const shown =
      change.effect === "revoked" ? s.status === "revoked" : change.text !== undefined && comparable(change.text) === comparable(latest.text);
    const before = history.slice(0, -1).some((v) => comparable(v.text) === comparable(p.text));
    if (shown && before) return { citation: change.act.citation, effectiveFrom: change.effectiveFrom };
  }
  return undefined;
}

function counts(agreement: Map<string, SecondaryAgreement>): Record<SecondaryOutcome, number> {
  const out = { agrees: 0, "secondary-stale": 0, unconfirmed: 0 };
  for (const a of agreement.values()) out[a.outcome]++;
  return out;
}

function staleNote(citation: string, source: string): string {
  return `The primary cites ${citation}, which ${source} does not record for this dispositivo or any above it: the secondary is behind.`;
}

/** Whether a reviewed known divergence accounts for the whole difference between the two wordings. */
function explains(known: KnownDivergence, primary: string, secondary: string): boolean {
  let edited = comparable(secondary);
  for (const edit of known.edits) {
    const from = comparable(edit.secondary);
    if (!from || !edited.includes(from)) return false;
    edited = edited.replace(from, comparable(edit.primary));
  }
  return edited === comparable(primary);
}

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

/**
 * The documented normalisation (ADR 0004) both wordings go through before they are compared. It drops what the two
 * sources print differently without changing the law: inline markup and entities, case, the diaeresis (pre-2009
 * spelling), ordinal marks, punctuation, quote and dash styles, and the spacing between words. Accents stay.
 */
export function comparable(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (entity, name: string) =>
      name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? entity),
    )
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/ü/g, "u")
    .replace(/(\d)\s*\.?\s*[º°ª]/g, "$1")
    .replace(/(\d)o(?![\p{L}\p{N}])/gu, "$1")
    .replace(/[º°]/g, "o")
    .replace(/ª/g, "a")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

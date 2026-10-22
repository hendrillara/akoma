// Review layer 3: an independent LLM reads the amending acts' official text and the diff, and maps each change to a
// command of an act. The model sits behind the `LlmReviewer` port (the adapters are claude.ts and openai.ts, which send
// the same prompt and the same request text; tests use a fake).
// The layer never trusts the answer as given: it checks the answer's shape and that it accounts for every change it
// was shown, and anything it cannot use (an error, a refusal, a malformed or incomplete answer) is a problem.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { NormManifest } from "../pipeline/build.ts";
import type { ChangeKind, ChangeReport, ProvisionChange } from "../pipeline/changes.ts";
import { visibleLines } from "../pipeline/planalto.ts";
import type { Dataset, Provision } from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";
import { readActCitation } from "../pipeline/acts.ts";
import { verifyActPage } from "./act-pages.ts";
import { actsCitedBy, knownActs } from "./gates.ts";
import type { Finding } from "./verdict.ts";
import { pathLabel } from "../schema/lexml.ts";

/** What the reviewer must answer: the schema its structured output is constrained to and validated against. */
export const ReviewerOutputSchema = z.object({
  /** Each change explained by a command: `change` is the ref it was given ("cf/art7_cpt_inc15"). */
  mappings: z.array(
    z.object({
      change: z.string(),
      /** The act as it was given, e.g. "EC 141". */
      act: z.string(),
      /** Where in the act, e.g. "art. 1º", "art. 3º". */
      command: z.string(),
      reason: z.string(),
    }),
  ),
  /** Changes no command of the given acts explains. */
  orphanChanges: z.array(z.object({ change: z.string(), reason: z.string() })),
  /** Commands of the given acts with no change in the diff. */
  unappliedCommands: z.array(
    z.object({
      act: z.string(),
      command: z.string(),
      /** The dispositivo the command targets, as the act names it, e.g. "inciso XXVII do caput do art. 7º". */
      target: z.string(),
      reason: z.string(),
    }),
  ),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;

/** The prompt file's name is its version, recorded with every answer; a new prompt is a new file. */
export const PROMPT_VERSION = "llm-reviewer.v1";

/** The reviewer's instructions, the same for every adapter. */
export function reviewerPrompt(): string {
  return readFileSync(new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url), "utf8");
}

/** The acts' text and the diff, each in its own block, as the prompt describes them. Every adapter sends these. */
export function requestTexts({ acts, changes }: ReviewRequest): string[] {
  const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return [
    ...acts.map(
      ({ act, url, inDataset, text }) =>
        `<amending_act act="${attribute(act)}" url="${attribute(url)}" in_dataset="${inDataset}">\n${text}\n</amending_act>`,
    ),
    `<diff>\n${JSON.stringify(changes)}\n</diff>`,
  ];
}

/** A schema mismatch on one line: "unappliedCommands: Invalid input: expected array, received undefined; …". */
export function schemaIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(answer)"}: ${issue.message}`).join("; ");
}

/** An amending act as the reviewer reads it: its official page's visible text. */
export interface ReviewedAct {
  /** "EC 142", "Lei 15.999". */
  act: string;
  url: string;
  /**
   * Whether the previous dataset already cites it: then today's changes are a later step of it (a deferred wording
   * promoted, the page catching up), and most of its commands rightly have no change in this diff.
   */
  inDataset: boolean;
  /** The page's text as a browser shows it, struck wording removed, one line per block. */
  text: string;
}

/** A dispositivo's state on one side of the diff. */
export interface ProvisionView {
  label: string;
  text: string;
  status: Provision["status"];
  pending?: { effect: string; text?: string; effectiveFrom: string; act: string }[];
}

export interface ReviewedChange {
  /** How the reviewer names it back: "<norm>/<id>". */
  ref: string;
  kind: ChangeKind;
  norm: string;
  /** How acts name the norm, e.g. "Constituição Federal". */
  normName: string;
  id: string;
  /** "Título II › Capítulo II › Art. 7º › inciso XV". */
  path: string;
  /** The record fields that moved (empty for an added or removed dispositivo). */
  fields: string[];
  /** The amendment annotations the page added, as printed, e.g. "Redação dada pela Emenda Constitucional nº 142, de 2026". */
  annotations: string[];
  before?: ProvisionView;
  after?: ProvisionView;
}

export interface ReviewRequest {
  acts: ReviewedAct[];
  changes: ReviewedChange[];
}

export interface ReviewerResult {
  /** The model that answered, as the API reports it. */
  model: string;
  /** The prompt version it was given, e.g. "llm-reviewer.v1". */
  prompt: string;
  output: ReviewerOutput;
}

/** The port: one call per refresh. A reviewer that cannot answer throws; the layer turns that into a problem. */
export interface LlmReviewer {
  review(request: ReviewRequest): Promise<ReviewerResult>;
}

export interface LlmReviewInput {
  manifests: NormManifest[];
  previous: Dataset;
  report: ChangeReport;
  /** Where the amending acts' official pages are read from: the same source as the new build. */
  source: Source;
  reviewer: LlmReviewer;
}

const finding = (check: string, severity: Finding["severity"], message: string, about: Partial<Finding> = {}): Finding => ({
  layer: "llm",
  check,
  severity,
  ...about,
  message,
});

/**
 * Asks the reviewer about every change but those that only moved "Vide" notes (Planalto adds them without any act;
 * the gates note them), with the text of every amending act those changes cite (an EC, a law, an MP…). No change: no
 * call.
 */
export async function reviewLlm({ manifests, previous, report, source, reviewer }: LlmReviewInput): Promise<Finding[]> {
  const changes = report.changes.filter((c) => !(c.fields.length === 1 && c.fields[0] === "references"));
  if (!changes.length) return [];

  const known = new Set(previous.provisions.flatMap(knownActs));
  const problems: Finding[] = [];
  const acts: ReviewedAct[] = [];
  for (const cited of actsCitedBy(changes)) {
    const act = cited.label;
    const url = cited.url;
    if (!url) {
      problems.push(finding("act-text", "problem", `cannot be resolved to its official page (${cited.problem}), so the reviewer cannot read it`, { act }));
      continue;
    }
    const snapshot = await source.get(url);
    if (!snapshot) {
      problems.push(finding("act-text", "problem", `its page ${url} is not in the source, so the reviewer cannot read it`, { act }));
      continue;
    }
    const html = new TextDecoder(snapshot.encoding).decode(snapshot.body);
    // The page must be the act's own before the reviewer is told it is.
    let unverified: string | undefined;
    try {
      unverified = verifyActPage(cited.citation, readActCitation(html, url));
    } catch (error) {
      unverified = `its page could not be read: ${(error as Error).message}`;
    }
    if (unverified) {
      problems.push(finding("act-text", "problem", `${unverified}, so the reviewer is not given it`, { act }));
      continue;
    }
    const text = visibleLines(html, {}, url).map((line) => line.text).join("\n");
    acts.push({ act, url, inDataset: known.has(cited.key), text });
  }
  if (!acts.length && !problems.length) {
    const message = `${changes.length} changed dispositivos to review, but none cites an amending act whose text the reviewer could read`;
    problems.push(finding("act-text", "problem", message));
  }
  if (problems.length) return problems;

  const request: ReviewRequest = { acts, changes: changes.map((c) => view(c, manifests)) };
  let result: ReviewerResult;
  try {
    result = await reviewer.review(request);
  } catch (error) {
    return [finding("reviewer", "problem", `the reviewer gave no usable answer: ${(error as Error).message}`)];
  }
  const checked = ReviewerOutputSchema.safeParse(result.output);
  if (!checked.success) {
    return [finding("reviewer", "problem", `the reviewer's answer does not match its schema: ${schemaIssues(checked.error)}`)];
  }
  return judge(request, { ...result, output: checked.data });
}

/** The reviewer's answer as findings: every change accounted for exactly once, and nothing it names invented. */
function judge(request: ReviewRequest, { model, prompt, output }: ReviewerResult): Finding[] {
  const by = `${model} (prompt ${prompt})`;
  const refs = new Map(request.changes.map((c) => [c.ref, c]));
  const acts = new Map(request.acts.map((a) => [a.act, a]));
  const about = (ref: string): Partial<Finding> => {
    const c = refs.get(ref);
    return c ? { norm: c.norm, id: c.id } : {};
  };
  const problems: Finding[] = [];
  const notes: Finding[] = [];

  for (const ref of new Set([...output.mappings.map((m) => m.change), ...output.orphanChanges.map((o) => o.change)])) {
    if (!refs.has(ref)) problems.push(finding("change-mapping", "problem", `${by} named a change that is not in the diff: "${ref}"`));
  }
  for (const m of output.mappings) {
    if (!acts.has(m.act)) {
      problems.push(finding("change-mapping", "problem", `${by} mapped it to "${m.act}", an act it was not given`, about(m.change)));
    }
  }
  const mapped = new Set(output.mappings.map((m) => m.change));
  for (const o of output.orphanChanges) {
    const message = mapped.has(o.change)
      ? `${by} both mapped it to a command and called it orphan: ${o.reason}`
      : `orphan change, per ${by}: ${o.reason}`;
    problems.push(finding("change-mapping", "problem", message, about(o.change)));
  }
  const orphan = new Set(output.orphanChanges.map((o) => o.change));
  for (const c of request.changes) {
    if (!mapped.has(c.ref) && !orphan.has(c.ref)) {
      problems.push(finding("change-mapping", "problem", `${by} neither mapped it to a command nor called it orphan`, about(c.ref)));
    }
  }
  for (const u of output.unappliedCommands) {
    const act = acts.get(u.act);
    const message = `unapplied command ${u.command} (targets ${u.target}), per ${by}: ${u.reason}`;
    if (!act) problems.push(finding("change-mapping", "problem", `${by} named an act it was not given: ${message}`, { act: u.act }));
    // Mirrors the gates: an act already in the dataset is checked one way only; its other commands applied earlier.
    else if (act.inDataset) notes.push(finding("change-mapping", "note", `${message}; the act is already in the dataset`, { act: u.act }));
    else problems.push(finding("change-mapping", "problem", message, { act: u.act }));
  }

  const summaries = request.acts.flatMap(({ act }) => {
    const ofAct = output.mappings.filter((m) => m.act === act && refs.has(m.change));
    if (!ofAct.length) return [];
    const count = new Set(ofAct.map((m) => m.change)).size;
    const list = ofAct.map((m) => `${refs.get(m.change)!.norm} ${refs.get(m.change)!.id} → ${m.command}`).join(", ");
    const total = request.changes.length;
    const how = count < total ? `${count} of the ${total} changes` : total === 1 ? "the only change" : `all ${total} changes`;
    return [finding("change-mapping", "note", `${by} mapped ${how} to its commands: ${list}`, { act })];
  });
  return [...problems, ...notes, ...summaries];
}

function view(c: ProvisionChange, manifests: NormManifest[]): ReviewedChange {
  const record = (c.after ?? c.before)!;
  const manifest = manifests.find((m) => m.key === c.norm);
  return {
    ref: `${c.norm}/${c.id}`,
    kind: c.kind,
    norm: c.norm,
    normName: manifest?.citedAs ?? manifest?.title ?? c.norm,
    id: c.id,
    path: pathLabel(record.path),
    fields: c.fields,
    annotations: c.amendments.map((a) => a.annotation),
    ...(c.before && { before: side(c.before) }),
    ...(c.after && { after: side(c.after) }),
  };
}

function side(p: Provision): ProvisionView {
  return {
    label: p.label,
    text: p.text,
    status: p.status,
    ...(p.pending?.length && {
      pending: p.pending.map((e) => ({
        effect: e.effect,
        ...(e.text !== undefined && { text: e.text }),
        effectiveFrom: e.effectiveFrom,
        act: e.act.citation,
      })),
    }),
  };
}

// The daily publish job (#12): check the sources, rebuild when a page moved or a pending change is due, review the
// changes with all three layers, and publish them as a PR that merges itself on `merge` or waits for the maintainer
// on `needs-human`. It also keeps the run status and opens one issue per kind of trouble (a failed job, a source
// unreachable for more than 48 hours). Every outside effect goes through a port, so a dry run over recorded sources
// does everything but touch GitHub and the checkout (docs/publishing.md).
import { build, pageContentHash, type NormManifest } from "../pipeline/build.ts";
import { detectChanges, type ChangeReport } from "../pipeline/changes.ts";
import { datasetFiles } from "../pipeline/files.ts";
import { crossSourceFindings } from "../review/cross-source.ts";
import { invariants, reviewDeferredActs, reviewGates } from "../review/gates.ts";
import { reviewLlm, type LlmReviewer } from "../review/llm.ts";
import { decide, type Finding, type Verdict } from "../review/verdict.ts";
import type { Dataset } from "../schema/dataset.ts";
import { loadEvalSet, searchRecall } from "../search/eval.ts";
import { redacting } from "../sources/redact.ts";
import type { Source } from "../sources/source.ts";
import { captureFiles, recording, type RecordingSource } from "./capture.ts";
import { brasiliaMidnight, inTarget, marker, pendingRechecks, type PendingRecheck } from "./divergence.ts";
import type { GitHub, Numbered } from "./github.ts";
import { fitBody, prBody } from "./pr-body.ts";
import {
  badge,
  hours,
  nextSources,
  outages,
  OUTAGE_HOURS,
  parseStatus,
  type Badge,
  type Checks,
  type ContentLag,
  type Outcome,
  type RunStatus,
} from "./status.ts";
import type { Workspace } from "./workspace.ts";

export interface TestResult {
  passed: boolean;
  /** `false` when the tests were not run (a dry run). */
  ran?: boolean;
  /** One line for the PR body and the status file. */
  summary: string;
  /** The test files that failed, when the run got that far (`FAIL  test/….test.ts` in vitest's output). */
  failedFiles?: string[];
}

/** Runs `pnpm verify` over the written dataset (in the workflow, a child process). */
export interface TestRunner {
  verify(): Promise<TestResult>;
}

export interface JobInput {
  manifests: NormManifest[];
  /** The dataset as the last publish committed it (dataset/dataset.json). */
  previous: Dataset;
  /** Where pages come from: live HTTP in the workflow, recorded captures in a dry run. */
  source: Source;
  /** The run's instant; its Brasília day is the build's date (ADR 0003). */
  now: Date;
  /** Review layer 3; `undefined` when there is no API key, which blocks any change the reviewer must see. */
  reviewer: LlmReviewer | undefined;
  /** The reviewer's model, for the PR body. */
  reviewerModel?: string;
  github: GitHub;
  workspace: Workspace;
  tests: TestRunner;
  /** The Actions run, linked from the PR and the issues. */
  runUrl?: string;
  /** GitHub's body limit; smaller only in tests. */
  bodyLimit?: number;
  /** The deploy workflow to dispatch after a merge: a merge made with the workflow token triggers no push workflow. */
  deployWorkflow?: string;
  /**
   * Rebuild even when no page moved and nothing is due: a divergence recheck (#18) saw Planalto print a dispositivo
   * differently from the published record and started this run.
   */
  rebuild?: boolean;
}

export interface JobResult {
  outcome: Outcome;
  today: string;
  message: string;
  report?: ChangeReport;
  verdict?: Verdict;
  /** The PR's body as sent (cut to GitHub's limit) and in full. */
  body?: string;
  fullReport?: string;
  pullRequest?: Numbered & { merged: boolean };
  status: RunStatus;
  badge: Badge;
  /** Set when the run failed: what went wrong. */
  error?: string;
}

/** The one branch the job publishes from: a PR still open is updated, never duplicated. */
export const PUBLISH_BRANCH = "publish/daily";
export const NEEDS_HUMAN = "needs-human";
export const FAILURE_LABEL = "publish-failure";
export const OUTAGE_LABEL = "source-outage";

export async function runDailyJob(input: JobInput): Promise<JobResult> {
  const { github, now } = input;
  const today = brasiliaDay(now);
  const previousStatus = parseStatus(await github.readStatus());
  // Personal data in page metadata is redacted before the build, the capture or any report sees a page.
  const source = recording(redacting(input.source));

  let core: Core;
  let error: string | undefined;
  try {
    core = await publish(input, source, today);
  } catch (e) {
    error = e instanceof Error ? (e.stack ?? e.message) : String(e);
    core = { outcome: "failed", message: `The job failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const open = core.pullRequest && !core.pullRequest.merged ? core.pullRequest.url : core.outcome === "failed" ? previousStatus?.openPullRequest : (await github.findOpenPullRequest(PUBLISH_BRANCH))?.url;
  // Every run that did not crash runs the tests: on a run with no change, over the published dataset/ in the checkout.
  let tested = core.testResult;
  if (!tested && core.outcome !== "failed") tested = await input.tests.verify();
  const tests = core.tests ?? (tested && { at: now.toISOString(), ...tested });
  // The dataset the run ends with: the one it merged, or the published one.
  const final = core.published ?? input.previous;
  const status: RunStatus = {
    version: 1,
    lastCheck: { at: now.toISOString(), today, outcome: core.outcome, message: core.message, ...(input.runUrl && { run: input.runUrl }) },
    ...(core.lastChange ? { lastChange: core.lastChange } : previousStatus?.lastChange && { lastChange: previousStatus.lastChange }),
    ...(open && { openPullRequest: open }),
    ...(tests ? { tests } : previousStatus?.tests && { tests: previousStatus.tests }),
    ...(final.schemaVersion && { schemaVersion: final.schemaVersion }),
    checks: await checks(final, tested, now),
    ...(final.status?.attributions?.length && { attributions: final.status.attributions }),
    contentLag: contentLag(final, previousStatus?.contentLag ?? [], now),
    sources: nextSources(previousStatus?.sources ?? [], source.attempts, now),
  };

  await reportFailure(input, core, error);
  await reportOutage(input, status);
  const shown = badge(status, now);
  await github.writeStatus([
    { path: "status.json", content: `${JSON.stringify(status, null, 2)}\n` },
    { path: "badge.json", content: `${JSON.stringify(shown)}\n` },
  ]);
  if (error !== undefined) await input.workspace.write("out/failure-reported", `${error}\n`);

  return {
    outcome: core.outcome,
    today,
    message: core.message,
    ...(core.report && { report: core.report }),
    ...(core.verdict && { verdict: core.verdict }),
    ...(core.body && { body: core.body, fullReport: core.fullReport! }),
    ...(core.pullRequest && { pullRequest: core.pullRequest }),
    status,
    badge: shown,
    ...(error !== undefined && { error }),
  };
}

interface Core {
  /** The dataset this run merged, when it merged one. */
  published?: Dataset;
  /** The tests the run ran on its refreshed dataset. */
  testResult?: TestResult;
  outcome: Outcome;
  message: string;
  report?: ChangeReport;
  verdict?: Verdict;
  body?: string;
  fullReport?: string;
  pullRequest?: Numbered & { merged: boolean };
  lastChange?: RunStatus["lastChange"];
  tests?: RunStatus["tests"];
}

async function publish(input: JobInput, source: RecordingSource, today: string): Promise<Core> {
  const { manifests, previous, github, workspace, now, runUrl } = input;

  // 1. Pre-filter: a conditional request per primary page, compared by content without scripts (Planalto's WAF
  // injects a fresh token into every response). The real change signal is the rebuilt records.
  const moved: string[] = [];
  const unreachable: string[] = [];
  for (const url of [...new Set(manifests.map((m) => m.primaryUrl))]) {
    const old = previous.pages?.find((p) => p.url === url);
    const probe = await source.probe(url, { ...(old?.etag && { etag: old.etag }), ...(old?.lastModified && { lastModified: old.lastModified }) });
    if (probe.status === "unavailable") unreachable.push(`${url} (${probe.error})`);
    else if (probe.status === "modified") {
      const html = new TextDecoder(probe.snapshot.encoding).decode(probe.snapshot.body);
      if (pageContentHash(html) !== old?.contentHash) moved.push(url);
    }
  }
  if (unreachable.length) {
    return { outcome: "unreachable", message: `Could not fetch ${unreachable.join(", ")}; nothing was built.` };
  }
  // ADR 0003: nothing on Planalto moves on a deferred change's start date, so a due one forces the rebuild.
  const due = previous.provisions.flatMap((p) =>
    (p.pending ?? []).filter((e) => !e.note && e.effectiveFrom <= today).map((e) => `${p.norm} ${p.id} (${e.act.citation}, from ${e.effectiveFrom})`),
  );
  if (!moved.length && !due.length && !input.rebuild) {
    return { outcome: "no-change", message: "No primary page changed (ETag, Last-Modified or content without scripts), and no pending change is due." };
  }
  const why = [
    moved.length && `pages changed: ${moved.join(", ")}`,
    due.length && `pending changes due: ${due.join("; ")}`,
    input.rebuild && "rebuild requested by a divergence recheck",
  ]
    .filter(Boolean)
    .join("; ");

  // 2. Build with the run's date, from fresh full pages.
  let next: Dataset;
  try {
    next = await build({ manifests, source, datasetVersion: today, today });
  } catch (error) {
    const failed = source.unavailable();
    if (!failed.length) throw error;
    return { outcome: "unreachable", message: `Rebuilt for ${why}, but could not fetch ${failed.join(", ")}: ${(error as Error).message}` };
  }
  const report = detectChanges(previous, next);
  // Divergence issues whose recheck confirmed a difference and still wait for this job's answer (#18).
  const pending = pendingRechecks(await github.ownComments(brasiliaMidnight(daysBefore(today, PENDING_DAYS))));
  if (!report.changes.length) {
    for (const p of pending) await github.commentOnIssue(p.issue, followUpNothing(p, today, runUrl));
    return { outcome: "no-change", message: `Rebuilt (${why}); no dispositivo changed.` };
  }

  // 3. Review: deterministic gates, cross-source agreement (recorded by the build), the LLM reviewer.
  const gates = [
    ...(await reviewGates({ manifests, previous, next, report, source })),
    ...(await reviewDeferredActs({ manifests, previous, report, source, today })),
  ];
  const llm = await reviewLlm({ manifests, previous, report, source, reviewer: input.reviewer ?? NO_API_KEY });

  // 4. The new dataset and the pages it was built from, so CI can regenerate it from committed files.
  const capture = `fixtures/${today}-daily`;
  await workspace.replace(capture, captureFiles(today, source.snapshots(), source.unavailable(), runUrl));
  await workspace.replace("dataset", datasetFiles(next));

  // 5. The job's own `pnpm verify`: CI does not run on a PR the workflow token opens.
  const tests = await input.tests.verify();
  const testFindings: Finding[] = tests.passed
    ? []
    : [{ layer: "gates", check: "verify", severity: "problem", message: `pnpm verify failed on the refreshed dataset: ${tests.summary}` }];
  const verdict = decide(gates, crossSourceFindings(next), llm, testFindings);

  // 6. The PR: one branch, updated while open; merged on `merge`, labelled on `needs-human`.
  const fullReport = prBody({
    today,
    report,
    verdict,
    tests,
    ...(input.reviewer && { reviewer: input.reviewerModel ?? "unnamed model" }),
    capture,
    ...(runUrl && { runUrl }),
    ...(pending.length && { answers: pending.map((p) => p.issue) }),
  });
  await workspace.write("out/change-report.md", fullReport);
  const body = fitBody(fullReport, runUrl, input.bodyLimit);
  const count = report.changes.length;
  const title = `Daily refresh ${today}: ${count} ${count === 1 ? "dispositivo" : "dispositivos"} changed`;
  await github.pushBranch(PUBLISH_BRANCH, ["dataset/", `${capture}/`], title);
  let pr = await github.findOpenPullRequest(PUBLISH_BRANCH);
  const existed = pr !== undefined;
  if (pr) await github.updatePullRequest(pr.number, { title, body });
  else pr = await github.createPullRequest({ branch: PUBLISH_BRANCH, title, body });

  const merged = verdict.decision === "merge";
  if (merged) {
    if (existed) await github.setLabel(pr.number, NEEDS_HUMAN, false);
    await github.mergePullRequest(pr.number);
    if (input.deployWorkflow) await github.dispatchWorkflow(input.deployWorkflow);
  } else await github.setLabel(pr.number, NEEDS_HUMAN, true);
  for (const p of pending) await github.commentOnIssue(p.issue, followUpPr(p, today, pr.url, merged, report));

  const at = now.toISOString();
  return {
    ...(merged && { published: next }),
    testResult: tests,
    outcome: "published",
    message: `${title}; verdict ${verdict.decision}${merged ? ", merged" : ", labelled needs-human"} (${why}).`,
    report,
    verdict,
    body,
    fullReport,
    pullRequest: { ...pr, merged },
    lastChange: { at, datasetVersion: today, changes: count, decision: verdict.decision, merged, pullRequest: pr.url },
    tests: { at, ...tests },
  };
}

/** Layer 3 with no API key: any change the reviewer must see gets a blocking finding, never a silent pass. */
const NO_API_KEY: LlmReviewer = {
  async review() {
    throw new Error("LLM review not run: no API key (ANTHROPIC_API_KEY is not set)");
  },
};

/** One open issue per failure streak: opened on the first failed run, commented on the next ones, closed on recovery. */
async function reportFailure({ github, runUrl }: JobInput, core: Core, error: string | undefined): Promise<void> {
  const open = await github.findOpenIssue(FAILURE_LABEL);
  const where = runUrl ? `Run: ${runUrl}` : "Run: (no run URL)";
  if (error !== undefined) {
    const details = `${core.message}\n\n${where}\n\n\`\`\`\n${error.slice(0, 4000)}\n\`\`\``;
    if (open) await github.commentOnIssue(open.number, `Failed again.\n\n${details}`);
    else await github.createIssue({ title: "Daily publish job failed", label: FAILURE_LABEL, body: `The daily publish job failed. This issue stays open, and later failures are added as comments, until a run succeeds; that run closes it.\n\n${details}` });
  } else if (open) {
    await github.closeIssue(open.number, `Recovered: the job ran again without failing (${core.outcome}). ${where}`);
  }
}

/** One open issue while any source stays unreachable for more than 48 hours; closed once none does. */
async function reportOutage({ github, runUrl, now }: JobInput, status: RunStatus): Promise<void> {
  const down = outages(status, now);
  const open = await github.findOpenIssue(OUTAGE_LABEL);
  if (down.length && !open) {
    const list = down.map((s) => `- ${s.url}: unreachable since ${s.failingSince}${s.lastSuccess ? ` (last success ${s.lastSuccess})` : ""}; last error: ${s.lastError}`).join("\n");
    await github.createIssue({
      title: `Source unreachable for more than ${OUTAGE_HOURS} hours`,
      label: OUTAGE_LABEL,
      body: `The daily job could not fetch these sources for more than ${OUTAGE_HOURS} hours:\n\n${list}\n\nIf Planalto blocks GitHub Actions runners, the R2 fallback (#13, ADR 0001) becomes the plan. A run that reaches every source again closes this issue.${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
    });
  } else if (!down.length && open) {
    await github.closeIssue(open.number, `Every source is reachable again (or no longer failing for more than ${OUTAGE_HOURS} hours).${runUrl ? ` Run: ${runUrl}` : ""}`);
  }
}

/** How far back the job looks for confirmed divergences still waiting for its answer. */
const PENDING_DAYS = 30;

function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The answer to a confirmed divergence: the PR, whether it touches the dispositivo, and what the review decided. */
function followUpPr(p: PendingRecheck, today: string, url: string, merged: boolean, report: ChangeReport): string {
  const touched = report.changes.some((c) => c.norm === p.norm && inTarget(p.target, c.id));
  const which = `\`${p.norm}\` \`${p.target}\``;
  return [
    marker({ kind: "followup", day: today, norm: p.norm, target: p.target }),
    `**PR de correção / Correction PR:** ${url}`,
    "",
    `PT: O job diário reconstruiu o dataset e abriu este PR, que ${touched ? "muda" : "**não muda**"} ${which}. Veredito da revisão: ${merged ? "merge (mesclado)" : "needs-human (aguarda o mantenedor)"}.`,
    "",
    `EN: The daily job rebuilt the dataset and opened this PR, which ${touched ? "changes" : "**does not change**"} ${which}. Review verdict: ${merged ? "merge (merged)" : "needs-human (waiting for the maintainer)"}.`,
    "",
  ].join("\n");
}

/** The answer to a confirmed divergence when the rebuild found nothing to publish. */
function followUpNothing(p: PendingRecheck, today: string, runUrl: string | undefined): string {
  return [
    marker({ kind: "followup", day: today, norm: p.norm, target: p.target }),
    "**Nada a publicar / Nothing to publish**",
    "",
    "PT: O job diário reconstruiu o dataset a partir das páginas oficiais e o resultado é igual ao dataset publicado, então nenhum PR foi aberto.",
    "",
    "EN: The daily job rebuilt the dataset from the official pages and the result equals the published dataset, so no PR was opened.",
    ...(runUrl ? ["", `Run: ${runUrl}`] : []),
    "",
  ].join("\n");
}

/** The golden-set suites (hand-verified dispositivos) among the job's tests. */
const GOLDEN_SUITES = ["test/cf-adct.test.ts", "test/cdc.test.ts"];

/** The run status's checks of `dataset`: search recall, structural invariants, and the golden sets from the tests. */
async function checks(dataset: Dataset, tests: TestResult | undefined, now: Date): Promise<Checks> {
  const search = searchRecall(dataset, await loadEvalSet());
  const problems = invariants(dataset).length;
  const golden =
    !tests || tests.ran === false ? null : tests.passed ? true : tests.failedFiles ? !tests.failedFiles.some((f) => GOLDEN_SUITES.includes(f)) : null;
  return {
    at: now.toISOString(),
    datasetVersion: dataset.provisions[0]?.provenance.datasetVersion ?? "",
    ...(search && { search }),
    invariants: { problems, passed: problems === 0 },
    golden: { suites: GOLDEN_SUITES, passed: golden },
  };
}

/** Each norm's secondary source, and how many dispositivos it is behind on, since the first run that saw it behind. */
function contentLag(dataset: Dataset, previous: ContentLag[], now: Date): ContentLag[] {
  return (dataset.status?.crossSource ?? []).flatMap((s) => {
    if (!s.source) return [];
    const stale = s.outcomes["secondary-stale"] ?? 0;
    const was = previous.find((p) => p.norm === s.norm && p.url === s.source!.url);
    const since = stale > 0 ? (was?.since ?? now.toISOString()) : undefined;
    return [
      {
        norm: s.norm,
        source: s.source.name,
        url: s.source.url,
        retrievedAt: s.source.retrievedAt,
        secondaryStale: stale,
        ...(since && { since, hours: hours(since, now) }),
      },
    ];
  });
}

/** The calendar day in Brasília, where a norm takes effect at the start of the day. */
export function brasiliaDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(instant);
}

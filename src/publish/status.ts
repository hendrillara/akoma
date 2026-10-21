// The run status: what the latest daily run saw (last check, last change, per-source reachability and lag, the
// latest test results), and the README badge made from it. It changes on every run, so it lives outside dataset/
// (whose files only change through a reviewed PR): the job rewrites it on its own branch (docs/publishing.md).
import type { Attempt } from "./capture.ts";

export type Outcome = "no-change" | "published" | "unreachable" | "failed";

export interface RunStatus {
  /** Format version of this file. */
  version: 1;
  lastCheck: {
    /** When the run started (ISO 8601). */
    at: string;
    /** Its date in Brasília: the day deferred changes are promoted for. */
    today: string;
    outcome: Outcome;
    message: string;
    run?: string;
  };
  /** The latest run that found a change and opened (or updated) a PR. */
  lastChange?: {
    at: string;
    datasetVersion: string;
    changes: number;
    decision: "merge" | "needs-human";
    merged: boolean;
    pullRequest: string;
  };
  /** The publish PR still open (one the review escalated, until the maintainer merges or closes it). */
  openPullRequest?: string;
  /** The latest `pnpm verify` the job ran (only runs that found a change run it). */
  tests?: { at: string; passed: boolean; summary: string };
  /** Every source the job has requested, by URL. */
  sources: SourceStatus[];
}

export interface SourceStatus {
  url: string;
  lastAttempt: string;
  lastSuccess?: string;
  /** The first failed request since the last success: set while the source is unreachable. */
  failingSince?: string;
  lastError?: string;
  /**
   * Hours since the job last fetched it successfully, as of the last check; `null` when it never did. Primary pages are
   * requested on every run; the other sources only on runs that rebuild, so their lag also grows on quiet days.
   */
  lagHours: number | null;
}

/** shields.io's endpoint badge format (https://shields.io/badges/endpoint-badge). */
export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

/** A source unreachable this long gets the outage issue. */
export const OUTAGE_HOURS = 48;

export function parseStatus(text: string | undefined): RunStatus | undefined {
  if (!text) return undefined;
  const status = JSON.parse(text) as RunStatus;
  if (status.version !== 1) throw new Error(`run status: unknown version ${String(status.version)}`);
  return status;
}

const hours = (from: string, to: Date) => Math.round(((to.getTime() - new Date(from).getTime()) / 3_600_000) * 10) / 10;

/** Folds this run's requests into the per-source record; sources not requested keep their record, lag updated. */
export function nextSources(previous: SourceStatus[], attempts: Attempt[], now: Date): SourceStatus[] {
  const at = now.toISOString();
  const byUrl = new Map(previous.map((s) => [s.url, { ...s }]));
  // One verdict per URL and run: reachable if any request to it succeeded.
  const runs = new Map<string, Attempt>();
  for (const a of attempts) if (!runs.get(a.url)?.ok) runs.set(a.url, a);
  for (const [url, attempt] of runs) {
    const s: SourceStatus = byUrl.get(url) ?? { url, lastAttempt: at, lagHours: null };
    s.lastAttempt = at;
    if (attempt.ok) {
      s.lastSuccess = at;
      delete s.failingSince;
      delete s.lastError;
    } else {
      s.failingSince ??= at;
      s.lastError = attempt.error ?? "unavailable";
    }
    byUrl.set(url, s);
  }
  return [...byUrl.values()]
    .map((s) => ({ ...s, lagHours: s.lastSuccess ? hours(s.lastSuccess, now) : null }))
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** Sources unreachable for more than OUTAGE_HOURS. */
export function outages(status: RunStatus, now: Date): SourceStatus[] {
  return status.sources.filter((s) => s.failingSince && hours(s.failingSince, now) > OUTAGE_HOURS);
}

export function badge(status: RunStatus, now: Date): Badge {
  const make = (message: string, color: string): Badge => ({ schemaVersion: 1, label: "akoma", message, color });
  const { outcome, today } = status.lastCheck;
  if (outcome === "failed") return make("job failed", "red");
  if (outages(status, now).length) return make("source outage", "red");
  if (outcome === "unreachable") return make("source unreachable", "yellow");
  if (status.openPullRequest) {
    return status.tests && !status.tests.passed ? make("tests failing", "red") : make("change awaiting review", "orange");
  }
  return make(`current · checked ${today}`, "brightgreen");
}

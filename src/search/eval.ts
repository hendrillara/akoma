// The search evaluation set (data/search-eval.json): realistic questions mapped to the dispositivos that answer them.
// recall@10 = the share of a question's expected dispositivos among the first 10 results, averaged over questions.
// `test/search.test.ts` enforces the thresholds through `GET /v1/search`; the daily job reports the same numbers in
// the run status on every run (docs/publishing.md).
import { readFile } from "node:fs/promises";
import type { Dataset } from "../schema/dataset.ts";
import { searchIndex } from "./query.ts";

export const RECALL_K = 10;
/** The first baseline (2026-10-21) rounded down: a change that loses a question fails; one that gains should raise them. */
export const RECALL_THRESHOLDS = { all: 0.85, holdout: 0.69, colloquial: 0.82 } as const;

export interface EvalQuestion {
  q: string;
  /** `norm/id` of each dispositivo that answers it. */
  expected: string[];
  /** Its key words are not the law's own ("licença-maternidade" for "licença à gestante"). */
  colloquial: boolean;
  /** Written after the analyser was tuned, to check it does not overfit. */
  holdout?: boolean;
}

const SET = new URL("../../data/search-eval.json", import.meta.url);

export async function loadEvalSet(): Promise<EvalQuestion[]> {
  return (JSON.parse(await readFile(SET, "utf8")) as { questions: EvalQuestion[] }).questions;
}

export interface SearchRecall {
  k: number;
  /** Mean recall@k over all questions, the holdout ones and the colloquial ones, rounded to 4 decimals. */
  all: number;
  holdout: number;
  colloquial: number;
  questions: number;
  /** Every mean at or above its threshold. */
  passed: boolean;
}

/**
 * recall@k of the dataset's prebuilt index over the questions it can answer (those whose expected dispositivos all
 * belong to its norms); `undefined` when the dataset has no index.
 */
export function searchRecall(dataset: Dataset, all: EvalQuestion[]): SearchRecall | undefined {
  const index = dataset.search;
  if (!index) return undefined;
  const norms = new Set(dataset.norms.map((n) => n.key));
  const questions = all.filter((q) => q.expected.every((e) => norms.has(e.split("/")[0]!)));
  const recall = new Map<EvalQuestion, number>();
  for (const question of questions) {
    const found = new Set(searchIndex(index, question.q, { limit: RECALL_K }).map((hit) => hit.doc));
    recall.set(question, question.expected.filter((e) => found.has(e)).length / question.expected.length);
  }
  const mean = (keep: (q: EvalQuestion) => boolean) => {
    const values = questions.filter(keep).map((q) => recall.get(q)!);
    return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10_000) / 10_000 : 0;
  };
  const overall = mean(() => true);
  const holdout = mean((q) => q.holdout === true);
  const colloquial = mean((q) => q.colloquial);
  const passed = overall >= RECALL_THRESHOLDS.all && holdout >= RECALL_THRESHOLDS.holdout && colloquial >= RECALL_THRESHOLDS.colloquial;
  return { k: RECALL_K, all: overall, holdout, colloquial, questions: questions.length, passed };
}

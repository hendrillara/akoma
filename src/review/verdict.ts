// The review verdict: every layer reports findings, and any problem from any layer escalates to the maintainer.

/**
 * `gates`: layer 1, deterministic gates and target matching (#10). `cross-source`: layer 2, agreement with a
 * secondary source (#8). `llm`: layer 3, the independent LLM reviewer (#11).
 */
export type ReviewLayer = "gates" | "cross-source" | "llm";

/** `problem` blocks the merge; `note` passes and is recorded (e.g. "secondary source is stale", an annotation-only change). */
export type Severity = "problem" | "note";

export interface Finding {
  layer: ReviewLayer;
  /** The check that produced it, e.g. "removal", "invariants", "target-matching". */
  check: string;
  severity: Severity;
  /** The dispositivo it is about, when it is about one. */
  norm?: string;
  id?: string;
  /** The amending act it is about, when it is about one, e.g. "EC 141". */
  act?: string;
  /** Plain text, specific enough for the maintainer to act on without rerunning anything. */
  message: string;
}

export interface Verdict {
  decision: "merge" | "needs-human";
  /** Every layer's findings, in the order the layers were given; problems and notes alike. */
  findings: Finding[];
}

/** Joins the findings of every layer that ran: `needs-human` as soon as one of them is a problem. */
export function decide(...layers: Finding[][]): Verdict {
  const findings = layers.flat();
  return { decision: findings.some((f) => f.severity === "problem") ? "needs-human" : "merge", findings };
}

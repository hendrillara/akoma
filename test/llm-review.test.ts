// Seam 1: review layer 3, the independent LLM reviewer, over two builds of recorded fixtures. The reviewer is a fake
// with a controlled answer; the real Claude adapter is exercised through handwritten API responses
// (test/fixtures/llm-review/, served by a fake fetch: no network, no credentials).
// Expected targets were read by hand from the simulated act's page (test/fixtures/refresh/ec142/emc142.htm): art. 1º
// alters art. 6º (caput quoted, parágrafo único numbered § 1º, § 2º quoted), art. 2º quotes art. 7º XIV as
// "(revogado)", art. 3º "Revoga-se o inciso XXVII do caput do art. 7º da Constituição Federal.".
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cf } from "../src/norms/cf.ts";
import { build } from "../src/pipeline/build.ts";
import { detectChanges, type ChangeReport } from "../src/pipeline/changes.ts";
import { claudeReviewer, DEFAULT_REVIEW_MODEL } from "../src/review/claude.ts";
import { reviewGates } from "../src/review/gates.ts";
import { reviewLlm, type LlmReviewer, type ReviewerOutput, type ReviewRequest } from "../src/review/llm.ts";
import { decide, type Verdict } from "../src/review/verdict.ts";
import type { Dataset } from "../src/schema/dataset.ts";
import type { Source } from "../src/sources/source.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const recorded = new URL("../fixtures/2026-10-20/", import.meta.url);
const acts = new URL("../fixtures/2026-10-21/", import.meta.url);
const ec142 = new URL("./fixtures/refresh/ec142/", import.meta.url);
const manifests = [cf, adct];

interface Builds {
  previous: Dataset;
  next: Dataset;
  report: ChangeReport;
  source: Source;
}

/** The recorded CF, then the simulated EC 142 refresh of it. */
async function ec142Builds(): Promise<Builds> {
  const source = await recordedSource(recorded, acts, ec142);
  const previous = await build({ manifests, source: await recordedSource(recorded, acts), datasetVersion: "previous-test" });
  const next = await build({ manifests, source, datasetVersion: "next-test" });
  return { previous, next, report: detectChanges(previous, next), source };
}

/** A reviewer that records what it was asked and gives a fixed answer. */
function fakeReviewer(output: ReviewerOutput): LlmReviewer & { requests: ReviewRequest[] } {
  const requests: ReviewRequest[] = [];
  return {
    requests,
    async review(request) {
      requests.push(request);
      return { model: "fake-reviewer", prompt: "fake", output };
    },
  };
}

/** Both layers, as the daily job joins them. */
async function verdictWith(builds: Builds, reviewer: LlmReviewer): Promise<Verdict> {
  const input = { manifests, ...builds };
  return decide(await reviewGates(input), await reviewLlm({ ...input, reviewer }));
}

/** The mapping a correct reviewer gives for EC 142 (read by hand from emc142.htm). */
const ec142Mapping: ReviewerOutput = {
  mappings: [
    { change: "cf/art6_cpt", act: "EC 142", command: "art. 1º", reason: "new caput quoted, adding \"e o cuidado\"" },
    { change: "cf/art6_par1", act: "EC 142", command: "art. 1º", reason: "\"numerado o parágrafo único como § 1º\"" },
    { change: "cf/art6_par2", act: "EC 142", command: "art. 1º", reason: "§ 2º quoted" },
    { change: "cf/art7_cpt_inc14", act: "EC 142", command: "art. 2º", reason: "XIV quoted as \"(revogado)\"" },
    { change: "cf/art7_cpt_inc27", act: "EC 142", command: "art. 3º", reason: "\"Revoga-se o inciso XXVII do caput do art. 7º\"" },
  ],
  orphanChanges: [],
  unappliedCommands: [],
};

describe("LLM review of the simulated EC 142, with a fake reviewer", () => {
  let builds: Builds;
  beforeAll(async () => {
    builds = await ec142Builds();
  });

  it("asks the reviewer about the act's official text and every change but the annotation-only one", async () => {
    const reviewer = fakeReviewer(ec142Mapping);
    await verdictWith(builds, reviewer);
    expect(reviewer.requests).toHaveLength(1);
    const [request] = reviewer.requests;
    expect(request!.acts.map(({ act, inDataset, url }) => ({ act, inDataset, url }))).toEqual([
      { act: "EC 142", inDataset: false, url: "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc142.htm" },
    ]);
    const text = request!.acts[0]!.text;
    expect(text).toContain("Art. 1º O art. 6º da Constituição Federal passa a vigorar com as seguintes alterações, numerado o parágrafo único como § 1º:");
    expect(text).toContain("Art. 3º Revoga-se o inciso XXVII do caput do art. 7º da Constituição Federal.");
    // Art. 7º XVIII only gained "(Vide ADI 9999)": the gates note it, and there is no wording to map.
    expect(request!.changes.map((c) => `${c.kind} ${c.ref}`)).toEqual([
      "changed cf/art6_cpt",
      "changed cf/art6_par1",
      "added cf/art6_par2",
      "revoked cf/art7_cpt_inc14",
      "revoked cf/art7_cpt_inc27",
    ]);
    const caput = request!.changes[0]!;
    expect(caput.before?.text).toContain("a assistência aos desamparados, na forma desta Constituição.");
    expect(caput.after?.text).toContain("a assistência aos desamparados e o cuidado, na forma desta Constituição.");
    expect(caput.annotations).toEqual(["Redação dada pela Emenda Constitucional nº 142, de 2026"]);
  });

  it("merges when the reviewer maps every change to a command and finds nothing unapplied", async () => {
    const verdict = await verdictWith(builds, fakeReviewer(ec142Mapping));
    expect(verdict.decision).toBe("merge");
    expect(verdict.findings.filter((f) => f.layer === "llm")).toEqual([
      {
        layer: "llm",
        check: "change-mapping",
        severity: "note",
        act: "EC 142",
        message:
          "fake-reviewer (prompt fake) mapped all 5 changes to its commands: cf art6_cpt → art. 1º, cf art6_par1 → art. 1º, cf art6_par2 → art. 1º, cf art7_cpt_inc14 → art. 2º, cf art7_cpt_inc27 → art. 3º",
      },
    ]);
  });
});

describe("LLM review of the simulated EC 142: the reviewer's reasons stop the merge", () => {
  let builds: Builds;
  beforeAll(async () => {
    builds = await ec142Builds();
  });

  const problems = (verdict: Verdict) => verdict.findings.filter((f) => f.severity === "problem");

  it("needs a human for an orphan change, with the reviewer's reason", async () => {
    const reason = "EC 142 art. 2º quotes XIV as \"(revogado)\", but the page's revocation of XIV cites no wording from the act";
    const verdict = await verdictWith(
      builds,
      fakeReviewer({
        ...ec142Mapping,
        mappings: ec142Mapping.mappings.filter((m) => m.change !== "cf/art7_cpt_inc14"),
        orphanChanges: [{ change: "cf/art7_cpt_inc14", reason }],
      }),
    );
    expect(verdict.decision).toBe("needs-human");
    expect(problems(verdict)).toEqual([
      {
        layer: "llm",
        check: "change-mapping",
        severity: "problem",
        norm: "cf",
        id: "art7_cpt_inc14",
        message: `orphan change, per fake-reviewer (prompt fake): ${reason}`,
      },
    ]);
  });

  it("needs a human for an unapplied command, with the reviewer's reason", async () => {
    const reason = "art. 1º quotes a new § 2º for art. 6º, and the diff has no such dispositivo";
    const verdict = await verdictWith(
      builds,
      fakeReviewer({
        ...ec142Mapping,
        mappings: ec142Mapping.mappings.filter((m) => m.change !== "cf/art6_par2"),
        orphanChanges: [{ change: "cf/art6_par2", reason: "an inserted § 2º the reviewer could not place" }],
        unappliedCommands: [{ act: "EC 142", command: "art. 1º", target: "§ 2º do art. 6º", reason }],
      }),
    );
    expect(verdict.decision).toBe("needs-human");
    expect(problems(verdict)).toContainEqual({
      layer: "llm",
      check: "change-mapping",
      severity: "problem",
      act: "EC 142",
      message: `unapplied command art. 1º (targets § 2º do art. 6º), per fake-reviewer (prompt fake): ${reason}`,
    });
  });

  it("needs a human when the answer leaves a change unaccounted for, or names one it was not shown", async () => {
    const verdict = await verdictWith(
      builds,
      fakeReviewer({
        ...ec142Mapping,
        mappings: [
          ...ec142Mapping.mappings.filter((m) => m.change !== "cf/art7_cpt_inc27"),
          { change: "cf/art7_cpt_inc28", act: "EC 142", command: "art. 3º", reason: "revoked" },
        ],
      }),
    );
    expect(problems(verdict).map((f) => f.message)).toEqual([
      'fake-reviewer (prompt fake) named a change that is not in the diff: "cf/art7_cpt_inc28"',
      "fake-reviewer (prompt fake) neither mapped it to a command nor called it orphan",
    ]);
    expect(problems(verdict)[1]).toMatchObject({ norm: "cf", id: "art7_cpt_inc27" });
  });

  it("needs a human when the reviewer cannot answer", async () => {
    const failing: LlmReviewer = {
      review: async () => {
        throw new Error("the API is unreachable");
      },
    };
    const verdict = await verdictWith(builds, failing);
    expect(verdict.decision).toBe("needs-human");
    expect(problems(verdict)).toEqual([
      { layer: "llm", check: "reviewer", severity: "problem", message: "the reviewer gave no usable answer: the API is unreachable" },
    ]);
  });

  it("needs a human when a reviewer's answer is not of the schema", async () => {
    const verdict = await verdictWith(builds, fakeReviewer({ mappings: ec142Mapping.mappings } as ReviewerOutput));
    expect(problems(verdict)).toHaveLength(1);
    expect(problems(verdict)[0]).toMatchObject({ layer: "llm", check: "reviewer" });
    expect(problems(verdict)[0]!.message).toBe(
      "the reviewer's answer does not match its schema: orphanChanges: Invalid input: expected array, received undefined; unappliedCommands: Invalid input: expected array, received undefined",
    );
  });
});

describe("LLM review of a refresh with nothing to map", () => {
  it("does not call the reviewer when nothing changed", async () => {
    const source = await recordedSource(recorded, acts, new URL("./fixtures/refresh/etag-only/", import.meta.url));
    const previous = await build({ manifests, source: await recordedSource(recorded, acts), datasetVersion: "previous-test" });
    const next = await build({ manifests, source, datasetVersion: "next-test" });
    const reviewer = fakeReviewer(ec142Mapping);
    const verdict = await verdictWith({ previous, next, report: detectChanges(previous, next), source }, reviewer);
    expect(reviewer.requests).toEqual([]);
    expect(verdict).toEqual({ decision: "merge", findings: [] });
  });
});

// EC 141 art. 10 I defers art. 7º XV to 2026-12-17 (ADR 0003); its other commands took effect in October.
describe("LLM review of EC 141's deferred art. 7º XV taking effect", () => {
  it("tells the reviewer the act is already in the dataset, and only notes the commands applied earlier", async () => {
    const source = await recordedSource(recorded, acts);
    const previous = await build({ manifests, source, datasetVersion: "eve", today: "2026-12-16" });
    const next = await build({ manifests, source, datasetVersion: "day", today: "2026-12-17" });
    const reviewer = fakeReviewer({
      mappings: [{ change: "cf/art7_cpt_inc15", act: "EC 141", command: "art. 1º", reason: "XV quoted; art. 10 I defers it" }],
      orphanChanges: [],
      unappliedCommands: [{ act: "EC 141", command: "art. 1º", target: "inciso XIII do caput do art. 7º", reason: "not in this diff" }],
    });
    const verdict = await verdictWith({ previous, next, report: detectChanges(previous, next), source }, reviewer);
    const [request] = reviewer.requests;
    expect(request!.acts.map((a) => `${a.act} ${a.inDataset}`)).toEqual(["EC 141 true"]);
    // EC 141 art. 1º's quoted XV, read by hand from fixtures/2026-10-20/planalto/emc141.htm.
    expect(request!.changes).toMatchObject([
      {
        ref: "cf/art7_cpt_inc15",
        kind: "pending-activated",
        after: { text: "repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;" },
      },
    ]);
    expect(verdict.decision).toBe("merge");
    expect(verdict.findings.filter((f) => f.layer === "llm").map((f) => `${f.severity}: ${f.message}`)).toEqual([
      "note: unapplied command art. 1º (targets inciso XIII do caput do art. 7º), per fake-reviewer (prompt fake): not in this diff; the act is already in the dataset",
      "note: fake-reviewer (prompt fake) mapped the only change to its commands: cf art7_cpt_inc15 → art. 1º",
    ]);
  });
});

// The real adapter, with the Claude API replaced by a fetch that serves a handwritten response body (or never answers).
// Every call passes an explicit fake key, so no credential on the machine is ever used.
describe("LLM review with the Claude adapter, over handwritten API responses", () => {
  let builds: Builds;
  beforeAll(async () => {
    builds = await ec142Builds();
  });

  const responses = new URL("./fixtures/llm-review/", import.meta.url);

  interface Sent {
    url: string;
    body: {
      model: string;
      system: string;
      output_config: { format: { type: string; schema: { required: string[] } } };
      messages: { role: string; content: { type: string; text: string }[] }[];
    };
  }

  /** A fetch that answers every request with one response file, and records what was sent. */
  function api(file: string, status = 200): { fetch: typeof fetch; sent: Sent[] } {
    const sent: Sent[] = [];
    return {
      sent,
      fetch: async (input, init) => {
        sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        const body = await readFile(new URL(file, responses), "utf8");
        return new Response(body, { status, headers: { "content-type": "application/json" } });
      },
    };
  }

  const reviewWith = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
    verdictWith(builds, claudeReviewer({ apiKey: "test-key-not-a-real-one", fetch, maxRetries: 0, ...(timeoutMs && { timeoutMs }) }));

  const llmProblems = (verdict: Verdict) => verdict.findings.filter((f) => f.layer === "llm" && f.severity === "problem");

  it("sends the act's text and the diff to the configured model, constrained to the reviewer's schema", async () => {
    const { fetch, sent } = api("ec142-mapping.json");
    await reviewWith(fetch);
    expect(sent).toHaveLength(1);
    const { url, body } = sent[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe(DEFAULT_REVIEW_MODEL);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toEqual(["mappings", "orphanChanges", "unappliedCommands"]);
    expect(body.system.length).toBeGreaterThan(0);
    const user = body.messages.map((m) => m.content.map((c) => c.text).join("\n")).join("\n");
    expect(user).toContain("Art. 3º Revoga-se o inciso XXVII do caput do art. 7º da Constituição Federal.");
    expect(user).toContain('"ref":"cf/art6_par2"');
    expect(user).not.toContain("art7_cpt_inc18");
  });

  it("merges on a well-formed answer that maps every change, naming the model that answered and the prompt", async () => {
    const verdict = await reviewWith(api("ec142-mapping.json").fetch);
    expect(verdict.decision).toBe("merge");
    expect(verdict.findings.filter((f) => f.layer === "llm")).toEqual([
      {
        layer: "llm",
        check: "change-mapping",
        severity: "note",
        act: "EC 142",
        message:
          "claude-opus-5 (prompt llm-reviewer.v1) mapped all 5 changes to its commands: cf art6_cpt → art. 1º, cf art6_par1 → art. 1º, cf art6_par2 → art. 1º, cf art7_cpt_inc14 → art. 2º, cf art7_cpt_inc27 → art. 3º",
      },
    ]);
  });

  it.each([
    ["malformed JSON", "malformed.json", 200, /^the reviewer gave no usable answer: claude-opus-5's answer is not the reviewer's schema: it is not JSON \(Unterminated string/],
    ["a missing field", "missing-field.json", 200, /^the reviewer gave no usable answer: claude-opus-5's answer is not the reviewer's schema: unappliedCommands: Invalid input: expected array, received undefined$/],
    ["a refusal", "refusal.json", 200, /^the reviewer gave no usable answer: claude-opus-5 refused to answer/],
    ["a cut-off answer", "max-tokens.json", 200, /^the reviewer gave no usable answer: claude-opus-5 stopped before finishing \(max_tokens\)/],
    ["an API error", "api-error-500.json", 500, /^the reviewer gave no usable answer: the Claude API answered 500: Internal server error$/],
  ])("needs a human on %s, never merges", async (_, file, status, message) => {
    const verdict = await reviewWith(api(file, status).fetch);
    expect(verdict.decision).toBe("needs-human");
    const problems = llmProblems(verdict);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ layer: "llm", check: "reviewer" });
    expect(problems[0]!.message).toMatch(message);
  });

  it("needs a human when the API does not answer in time", async () => {
    const silent: typeof fetch = (_, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const verdict = await reviewWith(silent, 50);
    expect(verdict.decision).toBe("needs-human");
    expect(llmProblems(verdict).map((f) => f.message)).toEqual(["the reviewer gave no usable answer: the Claude API did not answer within 50 ms"]);
  });
});

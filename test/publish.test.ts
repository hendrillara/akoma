// Seam 1: the daily publish job end to end (recorded sources + the previous dataset in; the change report, the
// verdict, the PR and issue actions and the run status out), and the published dataset's regeneration guard.
// GitHub is a fake port that records what the job asks of it; the LLM reviewer is a fake with a controlled answer, or
// the one the environment selects over handwritten API responses.
// Expected changes and targets were read by hand from the acts' pages (fixtures/2026-10-20/planalto/emc141.htm; the
// simulated test/fixtures/refresh/ec142/emc142.htm) and the scenario READMEs.
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adct } from "../src/norms/adct.ts";
import { cdc } from "../src/norms/cdc.ts";
import { cf, emc } from "../src/norms/cf.ts";
import { norms } from "../src/norms/index.ts";
import { build, type NormManifest } from "../src/pipeline/build.ts";
import { memoryGitHub, type MemoryGitHub } from "../src/publish/github.ts";
import { runDailyJob, type TestRunner } from "../src/publish/job.ts";
import { buildDataset, checkDataset, type PublishedBuild } from "../src/publish/published.ts";
import { diskWorkspace, memoryWorkspace } from "../src/publish/workspace.ts";
import type { LlmReviewer, ReviewerOutput } from "../src/review/llm.ts";
import { selectReviewer } from "../src/review/select.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import type { RawSnapshot, Source } from "../src/sources/source.ts";

const root = new URL("../", import.meta.url);
const fixtures = new URL("fixtures/", root);

describe("the published dataset: dataset/ is the regeneration of the committed captures", () => {
  // A repository with a copy of the two hand-made captures, so the daily captures the job commits later never move
  // these expectations; `pnpm build:dataset` and `pnpm check:dataset` (in `pnpm verify`) are the same two calls on the
  // repository itself.
  let published: PublishedBuild;
  let dir: string;
  let repo: URL;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "akoma-dataset-"));
    for (const day of ["2026-10-20", "2026-10-21"]) await cp(new URL(`fixtures/${day}/`, root), join(dir, "fixtures", day), { recursive: true });
    repo = pathToFileURL(`${dir}/`);
    published = await buildDataset(repo);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is dated and versioned by the latest capture, never by the clock", () => {
    // fixtures/2026-10-21/index.json: "capturedOn": "2026-10-21".
    expect({ today: published.today, version: published.datasetVersion, captures: published.captures }).toEqual({
      today: "2026-10-21",
      version: "2026-10-21",
      captures: ["2026-10-20", "2026-10-21"],
    });
    expect(published.files.map((f) => f.path)).toContain("dataset.json");
  });

  it("names every hand edit: a changed text, a deleted mirror and an added file", async () => {
    expect((await checkDataset(repo)).diff).toEqual({ changed: [], missing: [], extra: [] });
    const art5 = new URL("dataset/cf/art5.json", repo);
    const json = await readFile(art5, "utf8");
    await writeFile(art5, json.replace("Todos são iguais perante a lei", "Todos são iguais perante a lei e o rei"));
    await unlink(new URL("dataset/cdc/art49.md", repo));
    await writeFile(new URL("dataset/cf/art999.json", repo), "{}\n");

    expect((await checkDataset(repo)).diff).toEqual({ changed: ["cf/art5.json"], missing: ["cdc/art49.md"], extra: ["cf/art999.json"] });
  });
});

// --- The daily job ------------------------------------------------------------------------------------------

const recorded = new URL("fixtures/2026-10-20/", root);
// EC 132's page and LEGIN: every CF/ADCT build reads the acts in the manifests' `deferredActs` (ADR 0003).
const acts = new URL("fixtures/2026-10-21/", root);
const scenario = (name: string) => new URL(`test/fixtures/refresh/${name}/`, root);
const manifests = [cf, adct];
const RUN = "https://github.com/hendrillara/akoma/actions/runs/1";

/** The recorded captures, with a scenario folder's files served in place of theirs. */
async function sourceWith(folder?: URL): Promise<Source> {
  return folder ? recordedSource(recorded, acts, folder) : recordedSource(recorded, acts);
}

/** A reviewer that gives a fixed answer. */
function fakeReviewer(output: ReviewerOutput): LlmReviewer {
  return {
    async review() {
      return { model: "fake-reviewer", prompt: "fake", output };
    },
  };
}

const passing: TestRunner = { async verify() { return { passed: true, summary: "pnpm verify passed" }; } };

/** The mapping a correct reviewer gives for EC 142 (read by hand from emc142.htm). */
const ec142Mapping: ReviewerOutput = {
  mappings: [
    { change: "cf/art6_cpt", act: "EC 142", command: "art. 1º", reason: "new caput quoted" },
    { change: "cf/art6_par1", act: "EC 142", command: "art. 1º", reason: "\"numerado o parágrafo único como § 1º\"" },
    { change: "cf/art6_par2", act: "EC 142", command: "art. 1º", reason: "§ 2º quoted" },
    { change: "cf/art7_cpt_inc14", act: "EC 142", command: "art. 2º", reason: "XIV quoted as \"(revogado)\"" },
    { change: "cf/art7_cpt_inc27", act: "EC 142", command: "art. 3º", reason: "\"Revoga-se o inciso XXVII do caput do art. 7º\"" },
  ],
  orphanChanges: [],
  unappliedCommands: [],
};

let previous: Dataset;
beforeAll(async () => {
  // The dataset as the last publish left it: the recorded captures.
  previous = await build({ manifests, source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
});

/** One run of the job, in dry-run: GitHub and the working tree are in memory. */
async function run(options: {
  source: Source;
  now: string;
  manifests?: NormManifest[];
  previous?: Dataset;
  github?: MemoryGitHub; reviewer?: LlmReviewer | undefined; tests?: TestRunner; bodyLimit?: number;
  /** The rest of what `selectReviewer` returns: the provider and model the PR body names, or why there is none. */
  reviewerProvider?: string; reviewerModel?: string; reviewerUnavailable?: string }) {
  const github = options.github ?? memoryGitHub();
  const workspace = memoryWorkspace();
  const result = await runDailyJob({
    manifests: options.manifests ?? manifests,
    previous: options.previous ?? previous,
    source: options.source,
    now: new Date(options.now),
    reviewer: "reviewer" in options ? options.reviewer : fakeReviewer(ec142Mapping),
    ...(options.reviewerProvider && { reviewerProvider: options.reviewerProvider }),
    ...(options.reviewerModel && { reviewerModel: options.reviewerModel }),
    ...(options.reviewerUnavailable && { reviewerUnavailable: options.reviewerUnavailable }),
    github,
    workspace,
    tests: options.tests ?? passing,
    runUrl: RUN,
    deployWorkflow: "deploy.yml",
    ...(options.bodyLimit && { bodyLimit: options.bodyLimit }),
  });
  return { result, github, workspace };
}

describe("daily job: the simulated EC 142 arrives, and every review layer passes", () => {
  let out: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    out = await run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z" });
  });

  it("opens a PR with the change report and the verdict, merges it and redeploys", () => {
    expect(out.result.outcome).toBe("published");
    expect(out.result.verdict?.decision).toBe("merge");
    expect(out.github.log).toEqual([
      "push publish/daily: dataset/, fixtures/2026-10-23-daily/",
      "create PR #1 from publish/daily: Daily refresh 2026-10-23: 6 dispositivos changed",
      "merge PR #1",
      "dispatch deploy.yml",
    ]);
    const body = out.github.pulls[0]!.body;
    expect(body).toContain("**Verdict: merge.** Every review layer passed, so the job merges this PR.");
    // The change report as test/changes.test.ts pins it, with the verdict in it.
    expect(body).toContain("## Change report\n\n6 dispositivos changed: 1 added, 3 changed, 2 revoked.\n\n### Verdict: merge");
    expect(body).toContain("- **cf `art6_par2`** · Título II › Capítulo II › Art. 6º › § 2º");
  });

  it("writes the new dataset and the pages it was built from", () => {
    const paths = [...out.workspace.files.keys()];
    expect(paths).toContain("dataset/cf/art6.json");
    expect(paths).toContain("fixtures/2026-10-23-daily/index.json");
    const art6 = JSON.parse(out.workspace.text("dataset/cf/art6.json")) as { provisions: Provision[] };
    expect(art6.provisions.find((p) => p.id === "art6_par2")?.text).toBe("O cuidado é direito de todos e dever do Estado, da família e da sociedade, na forma da lei.");
  });

  it("keeps every dispositivo EC 142 does not touch byte for byte, golden set included, but its version and fetch time", () => {
    // The six EC 142 changes (test/fixtures/refresh/README.md, edits 1–6); everything else must come through as it was.
    const touched = new Set(["art6_cpt", "art6_par1", "art6_par2", "art7_cpt_inc14", "art7_cpt_inc18", "art7_cpt_inc27"].map((id) => `cf/${id}`));
    const next = JSON.parse(out.workspace.text("dataset/dataset.json")) as Dataset;
    const after = new Map(next.provisions.map((p) => [`${p.norm}/${p.id}`, p]));
    const comparable = (p: Provision) => JSON.stringify({ ...p, provenance: { ...p.provenance, datasetVersion: "", retrievedAt: "" } });
    const untouched = previous.provisions.filter((p) => !touched.has(`${p.norm}/${p.id}`));
    expect(untouched.length).toBe(previous.provisions.length - 5); // art6_par2 is new
    const moved = untouched.filter((p) => !after.has(`${p.norm}/${p.id}`) || comparable(after.get(`${p.norm}/${p.id}`)!) !== comparable(p));
    expect(moved.map((p) => `${p.norm}/${p.id}`)).toEqual([]);
    // Two of the golden set's dispositivos (test/cf-adct.test.ts), by their text in the recorded page.
    expect(after.get("cf/art5_cpt_inc10")!.text).toBe(
      "são invioláveis a intimidade, a vida privada, a honra e a imagem das pessoas, assegurado o direito a indenização pelo dano material ou moral decorrente de sua violação;",
    );
    expect(after.get("adct/art1_cpt")!.provenance.datasetVersion).toBe("2026-10-23");
  });

  it("finds every count of dispositivos per norm and kind within the tolerance", () => {
    expect(out.result.verdict?.findings.filter((f) => f.check === "counts")).toEqual([]);
  });
});

describe("daily job: dispositivo counts against the previous dataset", () => {
  it("escalates when a norm's count of one kind moves beyond the tolerance", async () => {
    // A previous dataset without art. 5º's 79 incisos (I to LXXIX): the refresh reads them all again, as a parser that
    // suddenly finds (or loses) dozens of dispositivos would. Each is also an untargeted change, but the count gate
    // names the scale of it on its own.
    const art5 = /^art5_cpt_inc\d+$/;
    const shrunk = { ...previous, provisions: previous.provisions.filter((p) => !(p.norm === "cf" && art5.test(p.id))) };
    expect(previous.provisions.length - shrunk.provisions.length).toBe(79);
    const { result } = await run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z", previous: shrunk });
    expect(result.verdict?.decision).toBe("needs-human");
    const counts = result.verdict?.findings.filter((f) => f.check === "counts");
    expect(counts).toHaveLength(1);
    expect(counts![0]).toMatchObject({ layer: "gates", severity: "problem", norm: "cf" });
    expect(counts![0]!.message).toMatch(/^inciso: (\d+) → \d+ \(\+79\), beyond the tolerance of ±\d+ \(2% of \1, at least 5\)$/);
  });
});

describe("daily job: a report longer than GitHub allows in a PR body", () => {
  it("cuts the body at the limit, says so, and keeps the full report for the run's artifact", async () => {
    const { github, workspace } = await run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z", bodyLimit: 1500 });
    const body = github.pulls[0]!.body;
    expect(body.length).toBeLessThanOrEqual(1500);
    expect(body).toContain(`**Report truncated** at GitHub's 1,500-character limit. The full report is the \`change-report\` artifact of [the run](${RUN}).`);
    expect(body).not.toContain("### Revoked (2)");
    expect(workspace.text("out/change-report.md")).toContain("### Revoked (2)");
  });
});

describe("daily job: a failing `pnpm verify`", () => {
  it("blocks the merge with the test summary", async () => {
    const failing: TestRunner = { async verify() { return { passed: false, summary: "check:dataset: dataset/ is not the regeneration" }; } };
    const { result, github } = await run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z", tests: failing });
    expect(result.verdict?.findings.filter((f) => f.severity === "problem")).toEqual([
      { layer: "gates", check: "verify", severity: "problem", message: "pnpm verify failed on the refreshed dataset: check:dataset: dataset/ is not the regeneration" },
    ]);
    expect(github.log).toContain("label PR #1 needs-human");
    expect(result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "tests failing", color: "red" });
  });
});

describe("daily job: EC 142 with the four planted faults (test/fixtures/refresh/README.md, ec142-faults)", () => {
  let out: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    out = await run({ source: await sourceWith(scenario("ec142-faults")), now: "2026-10-23T09:00:00Z" });
  });

  it("opens the PR, labels it needs-human and leaves it open", () => {
    expect(out.result.outcome).toBe("published");
    expect(out.result.verdict?.decision).toBe("needs-human");
    expect(out.github.log).toEqual([
      "push publish/daily: dataset/, fixtures/2026-10-23-daily/",
      "create PR #1 from publish/daily: Daily refresh 2026-10-23: 7 dispositivos changed",
      "label PR #1 needs-human",
    ]);
    expect(out.github.pulls[0]).toMatchObject({ state: "open", labels: ["needs-human"] });
  });

  it("says why in the body: the gates' problems, one per fault", () => {
    const body = out.github.pulls[0]!.body;
    expect(body).toContain("**Verdict: needs-human.**");
    expect(body).toContain("### Verdict: needs-human");
    // F2: art. 7º XXXIV vanished with no revocation mark.
    expect(body).toContain("- **Problem** · removal · cf `art7_cpt_inc34`: vanished from the page without a revocation mark");
  });

  it("records the open PR in the status, and the badge asks for review", () => {
    expect(out.result.status.openPullRequest).toBe("https://github.com/hendrillara/akoma/pull/1");
    expect(out.result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "change awaiting review", color: "orange" });
  });

  it("updates that same PR on the next day instead of opening another", async () => {
    const again = await run({ source: await sourceWith(scenario("ec142-faults")), now: "2026-10-24T09:00:00Z", github: out.github });
    expect(again.github.log.slice(3)).toEqual([
      "push publish/daily: dataset/, fixtures/2026-10-24-daily/",
      "update PR #1: Daily refresh 2026-10-24: 7 dispositivos changed",
      "label PR #1 needs-human",
    ]);
    expect(again.github.pulls).toHaveLength(1);
  });
});

describe("daily job: no API key for the LLM reviewer", () => {
  it("never passes silently: layer 3 blocks the merge", async () => {
    const { result, github } = await run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z", reviewer: undefined });
    expect(result.verdict?.decision).toBe("needs-human");
    expect(result.verdict?.findings.filter((f) => f.severity === "problem")).toEqual([
      {
        layer: "llm",
        check: "reviewer",
        severity: "problem",
        message: "the reviewer gave no usable answer: LLM review not run: no API key (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set)",
      },
    ]);
    expect(github.pulls[0]!.body).toContain(
      "LLM reviewer (layer 3): **not run: no API key (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set)**, which blocks the merge.",
    );
    expect(github.log).toContain("label PR #1 needs-human");
  });
});

// The provider the daily job's environment selects (scripts/publish.ts passes `process.env` to `selectReviewer`), each
// adapter's API served by a fetch that records the host and answers with a handwritten response
// (test/fixtures/llm-review/): no network, and only made-up keys.
describe("daily job: the LLM reviewer the environment selects", () => {
  const OPENAI_KEY = "test-openai-key-not-a-real-one";
  const ANTHROPIC_KEY = "test-anthropic-key-not-a-real-one";

  /** Serves `folder/file` and records each request's URL and model. */
  function api(folder: string, file: string) {
    const calls: { url: string; model: string }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), model: JSON.parse(String(init?.body)).model });
      return new Response(await readFile(new URL(`test/fixtures/llm-review/${folder}${file}`, root)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return { fetch, calls };
  }
  /** A fetch for either API, by host. */
  function both() {
    const openai = api("openai/", "ec142-mapping.json");
    const anthropic = api("", "ec142-mapping.json");
    const fetch: typeof globalThis.fetch = (input, init) =>
      (new URL(String(input)).host === "api.openai.com" ? openai.fetch : anthropic.fetch)(input, init);
    return { fetch, openai: openai.calls, anthropic: anthropic.calls };
  }
  const runWith = async (env: Record<string, string | undefined>, fetch: typeof globalThis.fetch) =>
    run({ source: await sourceWith(scenario("ec142")), now: "2026-10-23T09:00:00Z", ...selectReviewer(env, { fetch, maxRetries: 0 }) });

  it("reviews with OpenAI's gpt-6-luna when only OPENAI_API_KEY is set, and the PR body names provider and model", async () => {
    const apis = both();
    const { result, github } = await runWith({ OPENAI_API_KEY: OPENAI_KEY }, apis.fetch);
    expect(apis.openai).toEqual([{ url: "https://api.openai.com/v1/responses", model: "gpt-6-luna" }]);
    expect(apis.anthropic).toEqual([]);
    expect(result.verdict?.decision).toBe("merge");
    expect(github.pulls[0]!.body).toContain("- LLM reviewer (layer 3): OpenAI `gpt-6-luna`.");
  });

  it("prefers OpenAI when both keys are set and no provider is named, also when the variable is empty (an unset Actions variable)", async () => {
    for (const env of [{}, { AKOMA_REVIEW_PROVIDER: "" }]) {
      const apis = both();
      await runWith({ ...env, OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY }, apis.fetch);
      expect(apis.openai).toHaveLength(1);
      expect(apis.anthropic).toEqual([]);
    }
  });

  it("reviews with Claude when only ANTHROPIC_API_KEY is set, or when AKOMA_REVIEW_PROVIDER names anthropic", async () => {
    for (const env of [{ ANTHROPIC_API_KEY: ANTHROPIC_KEY }, { AKOMA_REVIEW_PROVIDER: "anthropic", OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY }]) {
      const apis = both();
      const { result, github } = await runWith(env, apis.fetch);
      expect(apis.anthropic).toEqual([{ url: "https://api.anthropic.com/v1/messages", model: "claude-opus-5" }]);
      expect(apis.openai).toEqual([]);
      expect(result.verdict?.decision).toBe("merge");
      expect(github.pulls[0]!.body).toContain("- LLM reviewer (layer 3): Anthropic `claude-opus-5`.");
    }
  });

  it("sends AKOMA_REVIEW_MODEL as the model to whichever provider is selected", async () => {
    const apis = both();
    const { github } = await runWith({ OPENAI_API_KEY: OPENAI_KEY, AKOMA_REVIEW_MODEL: "gpt-6-astra" }, apis.fetch);
    expect(apis.openai.map((c) => c.model)).toEqual(["gpt-6-astra"]);
    expect(github.pulls[0]!.body).toContain("- LLM reviewer (layer 3): OpenAI `gpt-6-astra`.");
  });

  it.each([
    [
      "the named provider's key is missing (never the other provider instead)",
      { AKOMA_REVIEW_PROVIDER: "openai", ANTHROPIC_API_KEY: ANTHROPIC_KEY },
      "no API key (AKOMA_REVIEW_PROVIDER is openai and OPENAI_API_KEY is not set)",
    ],
    [
      "the named provider's key is missing, the other way round",
      { AKOMA_REVIEW_PROVIDER: "anthropic", OPENAI_API_KEY: OPENAI_KEY },
      "no API key (AKOMA_REVIEW_PROVIDER is anthropic and ANTHROPIC_API_KEY is not set)",
    ],
    [
      "the provider is not one Akoma knows",
      { AKOMA_REVIEW_PROVIDER: "gemini", OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
      'unknown provider (AKOMA_REVIEW_PROVIDER is "gemini"; it must be openai or anthropic)',
    ],
    ["neither key is set", {}, "no API key (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set)"],
  ])("blocks the merge, calling no API, when %s", async (_, env, why) => {
    const apis = both();
    const { result, github } = await runWith(env, apis.fetch);
    expect([...apis.openai, ...apis.anthropic]).toEqual([]);
    expect(result.verdict?.decision).toBe("needs-human");
    expect(result.verdict?.findings.filter((f) => f.severity === "problem").map((f) => f.message)).toEqual([
      `the reviewer gave no usable answer: LLM review not run: ${why}`,
    ]);
    expect(github.pulls[0]!.body).toContain(`- LLM reviewer (layer 3): **not run: ${why}**, which blocks the merge.`);
  });
});

describe("daily job: nothing to publish", () => {
  it("opens no PR when only the headers and the WAF token changed", async () => {
    const { result, github, workspace } = await run({ source: await sourceWith(scenario("etag-only")), now: "2026-10-22T09:00:00Z" });
    expect(result.outcome).toBe("no-change");
    // Decided by the pre-filter, without a rebuild: the job redacts the page it fetches, and the committed captures
    // the dataset was built from are already redacted the same way, so their content hashes still agree.
    expect(result.message).toMatch(/^No primary page changed/);
    expect(github.log).toEqual([]);
    expect(workspace.files.size).toBe(0);
    expect(result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "current · checked 2026-10-22", color: "brightgreen" });
  });

  it("does not even rebuild when the pages answer not-modified and nothing is due", async () => {
    const { result } = await run({ source: await sourceWith(), now: "2026-10-22T09:00:00Z" });
    expect(result.outcome).toBe("no-change");
    // Only the conditional request for the compiled CF page (the ADCT shares it).
    expect(result.status.sources.map((s) => s.url)).toEqual([cf.primaryUrl]);
  });
});

describe("daily job: EC 141's deferred change comes into force on 2026-12-17 (ADR 0003)", () => {
  // EC 141 art. 1º (fixtures/2026-10-20/planalto/emc141.htm): "XV - repouso semanal remunerado de 2 (dois) dias, um dos
  // quais preferencialmente aos domingos;"; art. 10 I defers it 2 months from the DOU of 16.10.2026.
  const xv: ReviewerOutput = {
    mappings: [{ change: "cf/art7_cpt_inc15", act: "EC 141", command: "art. 1º", reason: "XV quoted; in force from 2026-12-17 (art. 10 I)" }],
    orphanChanges: [],
    unappliedCommands: [],
  };

  it("rebuilds though the page did not move, and publishes the promotion", async () => {
    // 2026-12-17T09:00Z is 06:00 in Brasília: the start date itself.
    const { result, workspace } = await run({ source: await sourceWith(), now: "2026-12-17T09:00:00Z", reviewer: fakeReviewer(xv) });
    expect(result.outcome).toBe("published");
    expect(result.report?.changes.map((c) => `${c.kind} ${c.id}`)).toEqual(["pending-activated art7_cpt_inc15"]);
    expect(result.verdict?.decision).toBe("merge");
    const art7 = JSON.parse(workspace.text("dataset/cf/art7.json")) as { provisions: Provision[] };
    expect(art7.provisions.find((p) => p.id === "art7_cpt_inc15")?.text).toBe("repouso semanal remunerado de 2 (dois) dias, um dos quais preferencialmente aos domingos;");
  });

  it("still waits on the eve (23:30 on 2026-12-16 in Brasília)", async () => {
    const { result } = await run({ source: await sourceWith(), now: "2026-12-17T02:30:00Z", reviewer: fakeReviewer(xv) });
    expect(result.outcome).toBe("no-change");
  });
});

/** The recorded source with some URLs unreachable, as a blocked or broken server would leave them. */
function unreachable(source: Source, urls: string[]): Source {
  return {
    async get(url) {
      return urls.includes(url) ? undefined : source.get(url);
    },
    async probe(url, validators) {
      return urls.includes(url) ? { status: "unavailable", error: "connection reset" } : source.probe!(url, validators);
    },
  };
}

/** A source that crashes the run, as a bug would. */
function crashing(): Source {
  return {
    async get() {
      throw new Error("parser exploded");
    },
    async probe() {
      throw new Error("parser exploded");
    },
  };
}

describe("daily job: the run status's checks, on every run", () => {
  it("reports the tests, search recall, invariants, golden sets, schema, attribution and each secondary's lag even with no change", async () => {
    // The whole registry, as the workflow runs it: the evaluation set's questions are about all three norms.
    const github = memoryGitHub();
    const published = await build({ manifests: norms, source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
    const source = await sourceWith();
    const day = (now: string) => run({ source, now, github, manifests: norms, previous: published });
    await day("2026-10-22T09:00:00Z");
    const { result } = await day("2026-10-23T09:00:00Z");
    expect(result.outcome).toBe("no-change");
    const status = result.status;
    // The tests ran although nothing changed (the checkout's dataset/ is the published one).
    expect(status.tests).toEqual({ at: "2026-10-23T09:00:00.000Z", passed: true, summary: "pnpm verify passed" });
    expect(status.schemaVersion).toBe("1.0.0");
    expect(status.checks).toMatchObject({
      at: "2026-10-23T09:00:00.000Z",
      datasetVersion: "2026-10-21",
      // data/search-eval.json, against the thresholds test/search.test.ts enforces.
      search: { k: 10, questions: 184, passed: true },
      invariants: { problems: 0, passed: true },
      golden: { suites: ["test/cf-adct.test.ts", "test/cdc.test.ts"], passed: true },
    });
    expect(status.checks!.search!.all).toBeGreaterThanOrEqual(0.85);
    expect(status.attributions).toEqual([expect.stringMatching(/normas\.leg\.br \/ LexML Brasil, © Senado Federal, CC BY 4\.0/)]);
    // normas.leg.br is behind Planalto on one CF dispositivo (art. 100 § 5º, EC 136/2025; test/cross-source.test.ts),
    // seen since the first run; on none of the ADCT's.
    expect(status.contentLag).toEqual([
      { norm: "cf", source: "normas.leg.br", url: cf.secondarySources[0]!.url, retrievedAt: "2026-10-20", secondaryStale: 1, since: "2026-10-22T09:00:00.000Z", hours: 24 },
      { norm: "adct", source: "normas.leg.br", url: adct.secondarySources[0]!.url, retrievedAt: "2026-10-20", secondaryStale: 0 },
      { norm: "cdc", source: "camara-legin", url: cdc.secondarySources[0]!.url, retrievedAt: "2026-10-21T04:48:50Z", secondaryStale: 0 },
    ]);
  });

  it("says the golden sets failed when their suites fail in the job's tests", async () => {
    const failing: TestRunner = { async verify() { return { passed: false, summary: "1 failed", failedFiles: ["test/cdc.test.ts"] }; } };
    const { result } = await run({ source: await sourceWith(), now: "2026-10-23T09:00:00Z", tests: failing });
    expect(result.status.checks!.golden).toEqual({ suites: ["test/cf-adct.test.ts", "test/cdc.test.ts"], passed: false });
  });
});

describe("daily job: Planalto unreachable for days", () => {
  const github = memoryGitHub();
  let base: Source;
  const day = (iso: string) => run({ source: unreachable(base, [cf.primaryUrl]), now: iso, github });
  beforeAll(async () => {
    base = await sourceWith();
  });

  it("builds nothing and opens no issue within 48 hours", async () => {
    const first = await day("2026-10-22T09:00:00Z");
    const second = await day("2026-10-24T08:00:00Z"); // 47 hours later
    expect([first.result.outcome, second.result.outcome]).toEqual(["unreachable", "unreachable"]);
    expect(github.log).toEqual([]);
    expect(second.result.status.sources).toEqual([
      { url: cf.primaryUrl, lastAttempt: "2026-10-24T08:00:00.000Z", failingSince: "2026-10-22T09:00:00.000Z", lastError: "connection reset", lagHours: null },
    ]);
    expect(second.result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "source unreachable", color: "yellow" });
  });

  it("opens one outage issue past 48 hours, and no second one on the next runs", async () => {
    const third = await day("2026-10-24T10:00:00Z"); // 49 hours after the first failure
    await day("2026-10-25T09:00:00Z");
    expect(github.issues.map((i) => `${i.label} ${i.state}: ${i.title}`)).toEqual(["source-outage open: Source unreachable for more than 48 hours"]);
    expect(github.issues[0]!.body).toContain(`- ${cf.primaryUrl}: unreachable since 2026-10-22T09:00:00.000Z; last error: connection reset`);
    expect(third.result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "source outage", color: "red" });
    // An unreachable source is not a failed job.
    expect(github.issues.filter((i) => i.label === "publish-failure")).toEqual([]);
  });

  it("closes the issue once the page answers again, and the badge is green", async () => {
    const back = await run({ source: base, now: "2026-10-26T09:00:00Z", github });
    expect(back.result.outcome).toBe("no-change");
    expect(github.issues[0]!.state).toBe("closed");
    expect(back.result.status.sources).toEqual([{ url: cf.primaryUrl, lastAttempt: "2026-10-26T09:00:00.000Z", lastSuccess: "2026-10-26T09:00:00.000Z", lagHours: 0 }]);
    expect(back.result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "current · checked 2026-10-26", color: "brightgreen" });
    // The status file the job wrote is the one it returned; the badge file is shields.io's endpoint format.
    expect(JSON.parse(github.status.get("status.json")!)).toEqual(back.result.status);
    expect(JSON.parse(github.status.get("badge.json")!)).toEqual(back.result.badge);
  });
});

describe("daily job: a crashing run", () => {
  it("opens one failure issue, comments on it while failing, and closes it on recovery", async () => {
    const github = memoryGitHub();
    const first = await run({ source: crashing(), now: "2026-10-22T09:00:00Z", github });
    await run({ source: crashing(), now: "2026-10-23T09:00:00Z", github });
    expect(first.result.outcome).toBe("failed");
    expect(first.result.badge).toEqual({ schemaVersion: 1, label: "akoma", message: "job failed", color: "red" });
    expect(first.workspace.files.has("out/failure-reported")).toBe(true);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]).toMatchObject({ label: "publish-failure", title: "Daily publish job failed", state: "open" });
    expect(github.issues[0]!.body).toContain("The job failed: parser exploded");
    expect(github.issues[0]!.body).toContain(`Run: ${RUN}`);
    expect(github.issues[0]!.comments).toHaveLength(1);

    await run({ source: await sourceWith(), now: "2026-10-24T09:00:00Z", github });
    expect(github.issues[0]!.state).toBe("closed");
    expect(github.log).toEqual(["create issue #1 [publish-failure]: Daily publish job failed", "comment on issue #1", "close issue #1"]);
  });
});

describe("daily job: what it writes regenerates to the same dataset", () => {
  it("commits a capture from which the CI guard rebuilds exactly its dataset/", async () => {
    const dir = await mkdtemp(join(tmpdir(), "akoma-job-"));
    const repo = pathToFileURL(`${dir}/`);
    try {
      for (const day of ["2026-10-20", "2026-10-21"]) await cp(new URL(`fixtures/${day}/`, root), join(dir, "fixtures", day), { recursive: true });
      await runDailyJob({
        manifests,
        previous,
        source: await sourceWith(scenario("ec142")),
        now: new Date("2026-10-23T09:00:00Z"),
        reviewer: fakeReviewer(ec142Mapping),
        github: memoryGitHub(),
        workspace: diskWorkspace(repo),
        tests: passing,
      });
      const { published: regenerated, diff } = await checkDataset(repo, manifests);
      expect(regenerated.captures).toEqual(["2026-10-20", "2026-10-21", "2026-10-23-daily"]);
      expect(diff).toEqual({ changed: [], missing: [], extra: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records a page it could not fetch as unavailable, so the regeneration does not read an older capture's", async () => {
    // normas.leg.br down on the day EC 142 arrives: the CF and ADCT are unconfirmed, as the live run saw them.
    const normas = cf.secondarySources[0]!.url;
    const { workspace } = await run({ source: unreachable(await sourceWith(scenario("ec142")), [normas]), now: "2026-10-23T09:00:00Z" });
    const index = JSON.parse(workspace.text("fixtures/2026-10-23-daily/index.json")) as { unavailable: string[]; snapshots: { url: string }[] };
    expect(index.unavailable).toEqual([normas]);
    expect(index.snapshots.map((s) => s.url)).not.toContain(normas);
  });
});

describe("daily job: the CDC reworded by a law (test/fixtures/refresh/cdc-law, simulated Lei 15.999/2026)", () => {
  // test/fixtures/refresh/cdc-law/L15999.htm, art. 1º: "O art. 49 da Lei nº 8.078, de 1990 (Código de Defesa do
  // Consumidor), passa a vigorar com a seguinte redação:", quoting the caput with "no prazo de 14 dias";
  // art. 2º: "Esta Lei entra em vigor na data de sua publicação."
  const lei15999 = "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15999.htm";
  const reviewer = fakeReviewer({
    mappings: [{ change: "cdc/art49_cpt", act: "Lei 15.999", command: "art. 1º", reason: "new caput quoted" }],
    orphanChanges: [],
    unappliedCommands: [],
  });
  let before: Dataset;
  beforeAll(async () => {
    before = await build({ manifests: [cdc], source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
  });

  it("reads the law's commands like an amendment's and merges: every layer passes", async () => {
    const source = await recordedSource(recorded, acts, scenario("cdc-law"));
    const { result, github } = await run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before, reviewer });
    expect(result.report?.changes.map((c) => `${c.kind} ${c.norm} ${c.id}`)).toEqual(["changed cdc art49_cpt"]);
    expect(result.verdict?.findings.filter((f) => f.severity === "problem")).toEqual([]);
    expect(result.verdict?.findings).toContainEqual({
      layer: "gates",
      check: "target-matching",
      severity: "note",
      act: "Lei 15.999",
      message: "targets 1 dispositivos, all changed: cdc art49_cpt",
    });
    expect(result.verdict?.decision).toBe("merge");
    expect(github.pulls[0]!.body).not.toContain("Why a change by a law needs a human");
  });

  it("escalates when the law's page cannot be read, naming the page", async () => {
    const source = unreachable(await recordedSource(recorded, acts, scenario("cdc-law")), [lei15999]);
    const { result } = await run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before, reviewer });
    expect(result.verdict?.decision).toBe("needs-human");
    expect(result.verdict?.findings.filter((f) => f.severity === "problem")).toEqual([
      { layer: "gates", check: "target-matching", severity: "problem", act: "Lei 15.999", message: `its page ${lei15999} is not in the source` },
      {
        layer: "gates",
        check: "target-matching",
        severity: "problem",
        norm: "cdc",
        id: "art49_cpt",
        message: "changed (text, amendments), citing Lei 15.999, which does not target it",
      },
      { layer: "llm", check: "act-text", severity: "problem", act: "Lei 15.999", message: `its page ${lei15999} is not in the source, so the reviewer cannot read it` },
    ]);
  });
});

describe("daily job: an amending act's page is fetched only from its own Planalto address", () => {
  // The cdc-law refresh, with the annotation's link (or the law's page) tampered with. The act's address is derived
  // from its identity (Lei nº 15.999, de 2026 → _ato2023-2026/2026/lei/L15999.htm, src/review/act-pages.ts); a link
  // anywhere else is never requested, and the act is unresolved, which blocks the merge.
  const cdcUrl = cdc.primaryUrl;
  const lei15999 = "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15999.htm";
  const link = '<a href="../_ato2023-2026/2026/lei/L15999.htm#art1">';
  const reviewer = fakeReviewer({
    mappings: [{ change: "cdc/art49_cpt", act: "Lei 15.999", command: "art. 1º", reason: "new caput quoted" }],
    orphanChanges: [],
    unappliedCommands: [],
  });

  /** The cdc-law source with one page's bytes edited, logging every URL the job asks for. */
  async function tampered(url: string, find: string, replace: string) {
    const base = await recordedSource(recorded, acts, scenario("cdc-law"));
    const requested: string[] = [];
    const edit = (snapshot: RawSnapshot | undefined) => {
      if (!snapshot || snapshot.url !== url) return snapshot;
      const text = Buffer.from(snapshot.body).toString("latin1");
      expect(text.split(find)).toHaveLength(2);
      return { ...snapshot, body: new Uint8Array(Buffer.from(text.replace(find, replace), "latin1")) };
    };
    const source: Source = {
      async get(u) {
        requested.push(u);
        return edit(await base.get(u));
      },
      async probe(u, validators) {
        requested.push(u);
        const result = await base.probe!(u, validators);
        return result.status === "modified" ? { status: "modified", snapshot: edit(result.snapshot)! } : result;
      },
    };
    const before = await build({ manifests: [cdc], source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
    const ran = await run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before, reviewer });
    return { ...ran, requested };
  }

  const problems = (result: Awaited<ReturnType<typeof tampered>>["result"]) =>
    result.verdict?.findings.filter((f) => f.severity === "problem" && f.act === "Lei 15.999").map((f) => `${f.layer}: ${f.message}`);

  it("never requests a link to another host, to another Planalto page or over plain http, and escalates", async () => {
    const outside = "its annotation links to a page outside https://www.planalto.gov.br/ccivil_03/, which is never fetched";
    const other = "its annotation links to a Planalto page that is not this act's, which is never fetched";
    const crafted: [string, string][] = [
      ["https://evil.example/ccivil_03/_ato2023-2026/2026/lei/L15999.htm", outside],
      ["http://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15999.htm", outside],
      ["../_ato2023-2026/2026/lei/L15998.htm", other],
      ["../../ccivil_03/outra/pagina.htm", other],
    ];
    for (const [href, why] of crafted) {
      const { result, requested } = await tampered(cdcUrl, link, `<a href="${href}#art1">`);
      expect(result.verdict?.decision).toBe("needs-human");
      expect(requested.filter((u) => /L1599[89]|evil|outra/.test(u))).toEqual([]);
      expect(problems(result)).toEqual([
        `gates: cannot be resolved to its official page (${why}), so its commands cannot be read`,
        `llm: cannot be resolved to its official page (${why}), so the reviewer cannot read it`,
      ]);
    }
  });

  it("escalates an act cited with no link at all: its address is never guessed for a fetch", async () => {
    const { result, requested } = await tampered(cdcUrl, link, "<a>");
    expect(result.verdict?.decision).toBe("needs-human");
    expect(requested).not.toContain(lei15999);
    expect(problems(result)).toEqual([
      "gates: cannot be resolved to its official page (its annotations give no link to its official page), so its commands cannot be read",
      "llm: cannot be resolved to its official page (its annotations give no link to its official page), so the reviewer cannot read it",
    ]);
  });

  it("escalates when the page at the act's address is the page of another act", async () => {
    const { result } = await tampered(lei15999, "LEI Nº 15.999, DE 22", "LEI Nº 15.998, DE 22");
    expect(result.verdict?.decision).toBe("needs-human");
    expect(problems(result)).toEqual([
      "gates: its page is the page of Lei nº 15.998, de 2026, not of Lei nº 15.999, de 2026",
      "llm: its page is the page of Lei nº 15.998, de 2026, not of Lei nº 15.999, de 2026, so the reviewer is not given it",
    ]);
  });
});

describe("daily job: a dispositivo of the real Lei 14.181/2021 appears (test/fixtures/refresh/cdc-before-14181)", () => {
  // fixtures/2026-10-21/planalto/L14181.htm, read by hand: art. 1º quotes, for the CDC, art. 4º IX–X, art. 5º VI–VII,
  // art. 6º XI–XIII, art. 51 XVII–XIX, arts. 54-A (caput, §§ 1º–3º), 54-B (caput, I–V, §§ 1º–3º), 54-C (caput, I–V,
  // parágrafo único), 54-D (caput, I–III, parágrafo único), 54-E (caput), 54-F (caput, I–II, §§ 1º–4º, § 3º I–II),
  // 54-G (caput, I–III, §§ 1º–2º), 104-A (caput, §§ 1º–5º, § 4º I–IV), 104-B (caput, §§ 1º–4º) and 104-C (caput,
  // §§ 1º–2º): 69 dispositivos. Art. 2º amends the Estatuto do Idoso, outside the corpus; art. 5º: in force on publication.
  it("reads every command of the official page and merges the dispositivo it targets", async () => {
    const before = await build({ manifests: [cdc], source: await sourceWith(scenario("cdc-before-14181")), datasetVersion: "2026-10-15", today: "2026-10-15" });
    const reviewer = fakeReviewer({
      mappings: [{ change: "cdc/art6_cpt_inc13", act: "Lei 14.181", command: "art. 1º", reason: "inciso XIII quoted" }],
      orphanChanges: [],
      unappliedCommands: [],
    });
    const { result } = await run({ source: await sourceWith(), now: "2026-10-22T09:00:00Z", manifests: [cdc], previous: before, reviewer });
    expect(result.report?.changes.map((c) => `${c.kind} ${c.norm} ${c.id}`)).toEqual(["added cdc art6_cpt_inc13"]);
    const lei = result.verdict?.findings.filter((f) => f.act === "Lei 14.181");
    expect(lei).toEqual([
      {
        layer: "gates",
        check: "target-matching",
        severity: "note",
        act: "Lei 14.181",
        message: "already in the dataset: each change citing it must be one of its 69 targets; the others may stay as they are",
      },
      { layer: "llm", check: "change-mapping", severity: "note", act: "Lei 14.181", message: "fake-reviewer (prompt fake) mapped the only change to its commands: cdc art6_cpt_inc13 → art. 1º" },
    ]);
    expect(result.verdict?.decision).toBe("merge");
  });
});

describe("daily job: personal data in page metadata (test/fixtures/redaction)", () => {
  // The CDC refresh of cdc-law, with a LEGIN page whose metadata names people in every form its README lists.
  const names = ["Fulana", "Beltrano", "Sicrano", "Mevio", "Ticio", "Sempronio", "Graco", "Tizio", "Fulano", "Zutano", "Mengano", "Perengano", "Tertius", "Quartus"];
  const plantedPage = new URL("test/fixtures/redaction/legin.html", root);
  const captured = "fixtures/2026-10-23-daily/camara-legin/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html";

  async function redactionRun(folder = "") {
    const source = await recordedSource(recorded, acts, scenario("cdc-law"), new URL(`test/fixtures/redaction/${folder}`, root));
    const before = await build({ manifests: [cdc], source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
    return run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before });
  }

  /** Everything the job wrote or sent anywhere: files, PR bodies, issues and comments, the run status. */
  function everything({ github, workspace }: Awaited<ReturnType<typeof redactionRun>>): string {
    return [
      ...[...workspace.files.values()].map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("latin1"))),
      ...github.pulls.map((p) => p.body),
      ...github.issues.flatMap((i) => [i.title, i.body, ...i.comments]),
      ...github.status.values(),
    ].join("\n");
  }

  it("never lets a planted name into anything it writes, whatever the markup", async () => {
    const ran = await redactionRun();
    expect(ran.result.outcome).toBe("published");
    const written = everything(ran);
    for (const name of names) expect(written).not.toContain(name);
  });

  it("fails closed on a page it cannot redact with certainty: nothing from it is kept, the job fails", async () => {
    // A tag cut off by the end of the page, which the parser keeps in no node; a NUL byte (not windows-1252 or UTF-8
    // text). The job stops before the build, so no capture, dataset or PR exists, and the failure issue names the page.
    for (const folder of ["malformed/", "nul/"]) {
      const ran = await redactionRun(folder);
      expect(ran.result.outcome).toBe("failed");
      expect(ran.result.error).toMatch(/^RedactionError: redact: https:\/\/www2\.camara\.leg\.br\/legin\/.*: .*; nothing from this page is kept/);
      expect(ran.github.pulls).toEqual([]);
      expect([...ran.workspace.files.keys()]).toEqual(["out/failure-reported"]);
      const written = everything(ran);
      for (const name of names) expect(written).not.toContain(name);
    }
  });

  it("redacts a body that starts like JSON as HTML: only a known JSON endpoint's JSON passes through unread", async () => {
    const ran = await redactionRun("json-prefix/");
    expect(ran.result.outcome).toBe("published");
    expect(ran.workspace.text(captured).startsWith('{"autor": 1}\n<!DOCTYPE HTML')).toBe(true);
    const written = everything(ran);
    for (const name of names) expect(written).not.toContain(name);
    // The normas.leg.br API's JSON is a known JSON endpoint's: the CF build reads it as served (cross-source.test.ts).
  });

  it("keeps only the charset declaration and blanks every meta, comment, raw-text content and Office block", async () => {
    const { workspace } = await redactionRun();
    const legin = workspace.text(captured);
    // Kept as served: the charset declaration, and the plain stylesheet link (none on this page).
    expect(legin).toContain('<meta http-equiv="content-type" content="text/html; charset=utf-8"/>');
    // Every other meta, in any markup (reversed or repeated attributes, a ">" in a value, an encoded attribute name,
    // property and itemprop, inside raw text), and the charset-shaped ones carrying other values: a fixed tag.
    const metas = [...legin.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
    expect(new Set(metas)).toEqual(
      new Set(['<meta http-equiv="content-type" content="text/html; charset=utf-8"/>', '<meta content="[redacted]"/>', '<meta content="[redacted]">']),
    );
    // The page's own 13 metas (one the charset), 7 planted ones and the 2 charset-shaped ones; the 2 inside raw text
    // are gone with its content.
    expect(metas.length).toBe(13 + 7 + 2);
    expect(legin).toContain("\n<link/>\n");
    // Every comment (the conditional one with Word's properties, CDATA, <![if …]>, <?…?>) is emptied.
    expect([...legin.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]).every((c) => c === "<!---->")).toBe(true);
    // Raw-text and RCDATA elements keep their tags and lose their content.
    for (const tag of ["script", "style", "title", "noscript", "noframes", "textarea", "xmp", "iframe", "noembed"]) {
      expect(legin).toContain(`<${tag}></${tag}>`);
    }
    // The Office blocks keep their tags and lose their content.
    expect(legin).toContain("<xml></xml>");
    expect(legin).toContain("<cp:coreProperties></cp:coreProperties>");
    expect(legin).toContain("<o:Author></o:Author>");
  });

  it("leaves every byte outside the head as served, so the build reads the same law", async () => {
    const { workspace } = await redactionRun();
    const legin = workspace.text(captured);
    const planted = await readFile(plantedPage, "utf8");
    const body = (page: string) => page.slice(page.indexOf("</head>"));
    expect(body(legin)).toEqual(body(planted));
    expect(body(legin).length).toBeGreaterThan(200_000);
  });
});

describe("daily job: a new amendment that defers a change its manifest does not list (ADR 0003)", () => {
  // EC 141 art. 10 I (fixtures/2026-10-20/planalto/emc141.htm): "após decorridos 2 (dois) meses de sua publicação, em
  // relação à alteração promovida pelo art. 1º desta Emenda Constitucional no inciso XV do caput do art. 7º". The CF
  // page shows only "(Vide Emenda Constitucional nº 141, de 2026) (Vigência)" there, so without EC 141 in the CF's
  // `deferredActs` its pending wording would never be recorded. EC 140 art. 14: "entra em vigor na data de sua
  // publicação", nothing deferred.
  const cfBefore = { ...cf, deferredActs: cf.deferredActs!.filter((url) => url !== emc(141)) };
  const mapped = (ids: string[], act: string) => ids.map((id) => ({ change: `cf/${id}`, act, command: "art. 1º", reason: "quoted" }));
  // A reviewer that accounts for every change it is shown (the page annotates each with EC 140 or EC 141).
  const reviewer = fakeReviewer({
    mappings: [
      ...mapped(["art7_cpt_inc13", "art7_par1", "art7_par2", "art7_par3"], "EC 141"),
      ...mapped(["art40_par4", "art40_par5-1", "art198_cpt_inc4", "art198_par4-1", "art198_par4-2", "art198_par10", "art201_par8-1"], "EC 140"),
    ],
    orphanChanges: [],
    unappliedCommands: [],
  });

  it("blocks the merge and says which act to add to which manifest", async () => {
    const before = await build({ manifests: [cfBefore, adct], source: await sourceWith(scenario("before-ec140-141")), datasetVersion: "2026-10-15", today: "2026-10-15" });
    const { result } = await run({ source: await sourceWith(), now: "2026-10-21T09:00:00Z", manifests: [cfBefore, adct], previous: before, reviewer });
    expect(result.verdict?.findings.filter((f) => f.severity === "problem")).toEqual([
      {
        layer: "gates",
        check: "deferred-act",
        severity: "problem",
        act: "EC 141",
        message: `defers changes to dispositivos the manifests do not list it for: cf art7_cpt_inc15 (from 2026-12-17). Add ${emc(141)} to the deferredActs of cf, or its pending wordings are never recorded`,
      },
      // Here layer 2 sees it too, but only because normas.leg.br dates EC 141's change from publication (ADR 0004);
      // a secondary source that follows the vigência would agree with the page, and only the gate above would remain.
      {
        layer: "cross-source",
        check: "divergence",
        severity: "problem",
        norm: "cf",
        id: "art7_cpt_inc15",
        message: "The wording differs from normas.leg.br and no amending act or reviewed known divergence explains it; held for review.",
      },
    ]);
  });
});

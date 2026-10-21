// Seam 1: the daily publish job end to end (recorded sources + the previous dataset in; the change report, the
// verdict, the PR and issue actions and the run status out), and the published dataset's regeneration guard.
// GitHub is a fake port that records what the job asks of it; the LLM reviewer is a fake with a controlled answer.
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
import { build, type NormManifest } from "../src/pipeline/build.ts";
import { memoryGitHub, type MemoryGitHub } from "../src/publish/github.ts";
import { runDailyJob, type TestRunner } from "../src/publish/job.ts";
import { diffPublished, publishedBuild, writePublished, type PublishedBuild } from "../src/publish/published.ts";
import { diskWorkspace, memoryWorkspace } from "../src/publish/workspace.ts";
import type { LlmReviewer, ReviewerOutput } from "../src/review/llm.ts";
import type { Dataset, Provision } from "../src/schema/dataset.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import type { Source } from "../src/sources/source.ts";

const root = new URL("../", import.meta.url);
const fixtures = new URL("fixtures/", root);

describe("the published dataset: dataset/ is the regeneration of the committed captures", () => {
  // A copy of the two hand-made captures, so the daily captures the job commits later never move these expectations.
  // `pnpm check:dataset` (in `pnpm verify`) runs the same comparison on the repository's own fixtures/ and dataset/.
  let published: PublishedBuild;
  let dir: string;
  let copy: URL;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "akoma-dataset-"));
    for (const day of ["2026-10-20", "2026-10-21"]) await cp(new URL(`fixtures/${day}/`, root), join(dir, "fixtures", day), { recursive: true });
    published = await publishedBuild(pathToFileURL(`${dir}/fixtures/`));
    copy = pathToFileURL(`${dir}/dataset/`);
    await writePublished(published.files, copy);
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
    expect(await diffPublished(published.files, copy)).toEqual({ changed: [], missing: [], extra: [] });
    const art5 = new URL("cf/art5.json", copy);
    const json = await readFile(art5, "utf8");
    await writeFile(art5, json.replace("Todos são iguais perante a lei", "Todos são iguais perante a lei e o rei"));
    await unlink(new URL("cdc/art49.md", copy));
    await writeFile(new URL("cf/art999.json", copy), "{}\n");

    expect(await diffPublished(published.files, copy)).toEqual({ changed: ["cf/art5.json"], missing: ["cdc/art49.md"], extra: ["cf/art999.json"] });
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
  github?: MemoryGitHub; reviewer?: LlmReviewer | undefined; tests?: TestRunner; bodyLimit?: number }) {
  const github = options.github ?? memoryGitHub();
  const workspace = memoryWorkspace();
  const result = await runDailyJob({
    manifests: options.manifests ?? manifests,
    previous: options.previous ?? previous,
    source: options.source,
    now: new Date(options.now),
    reviewer: "reviewer" in options ? options.reviewer : fakeReviewer(ec142Mapping),
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
        message: "the reviewer gave no usable answer: LLM review not run: no API key (ANTHROPIC_API_KEY is not set)",
      },
    ]);
    expect(github.pulls[0]!.body).toContain("LLM reviewer (layer 3): **not run: no API key**");
    expect(github.log).toContain("label PR #1 needs-human");
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
      const regenerated = await publishedBuild(new URL("fixtures/", repo), manifests);
      expect(regenerated.captures).toEqual(["2026-10-20", "2026-10-21", "2026-10-23-daily"]);
      expect(await diffPublished(regenerated.files, new URL("dataset/", repo))).toEqual({ changed: [], missing: [], extra: [] });
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
  it("escalates, and the PR body explains that v1 reviews only constitutional amendments", async () => {
    const source = await recordedSource(recorded, acts, scenario("cdc-law"));
    const before = await build({ manifests: [cdc], source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
    const { result, github } = await run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before });
    expect(result.report?.changes.map((c) => `${c.kind} ${c.norm} ${c.id}`)).toEqual(["changed cdc art49_cpt"]);
    expect(result.verdict?.decision).toBe("needs-human");
    expect(github.pulls[0]!.body).toContain(
      "> **Why a change by a law needs a human.** 1 change cites only acts other than constitutional amendments (Lei nº 15.999, de 2026). In v1, target matching and the LLM reviewer read only constitutional amendments",
    );
  });
});

describe("daily job: personal data in page metadata (test/fixtures/redaction)", () => {
  // The CDC refresh of cdc-law, with a LEGIN page whose metadata names people in every form its README lists.
  const names = ["Fulana", "Beltrano", "Sicrano", "Mevio", "Ticio", "Sempronio", "Graco", "Tizio", "Fulano", "Zutano", "Mengano", "Perengano", "Tertius", "Quartus"];
  const plantedPage = new URL("test/fixtures/redaction/legin.html", root);
  const captured = "fixtures/2026-10-23-daily/camara-legin/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html";

  async function redactionRun() {
    const source = await recordedSource(recorded, acts, scenario("cdc-law"), new URL("test/fixtures/redaction/", root));
    const before = await build({ manifests: [cdc], source: await sourceWith(), datasetVersion: "2026-10-21", today: "2026-10-21" });
    return run({ source, now: "2026-10-23T09:00:00Z", manifests: [cdc], previous: before });
  }

  it("never lets a planted name into anything it writes, whatever the markup", async () => {
    const { result, github, workspace } = await redactionRun();
    expect(result.outcome).toBe("published");
    const written = [
      ...[...workspace.files.values()].map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("latin1"))),
      ...github.pulls.map((p) => p.body),
      ...github.issues.flatMap((i) => [i.body, ...i.comments]),
      ...github.status.values(),
    ].join("\n");
    for (const name of names) expect(written).not.toContain(name);
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

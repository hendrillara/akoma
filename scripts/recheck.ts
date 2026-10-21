// `pnpm recheck`: the text-divergence recheck (src/publish/recheck.ts; docs/publishing.md), run by
// .github/workflows/recheck.yml when an issue labelled `text-divergence` is opened or edited.
//
//   node scripts/recheck.ts                      the workflow's run: the event from GITHUB_EVENT_PATH, live sources, gh
//   node scripts/recheck.ts --dry-run --event <file> [--recorded <folder>…] [--now <instant>]
//                                                no GitHub: prints the comment and the actions it would take
//
// The issue body is untrusted. It is read here from the event file, never from the workflow's expressions or the
// environment, and only the recheck reads it (as data). This script logs the outcome and validated ids only: Actions
// logs are public. Environment (the workflow sets it): GH_TOKEN (gh, to comment and to start publish.yml), and
// GITHUB_EVENT_PATH, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { norms } from "../src/norms/index.ts";
import { ghCli, memoryGitHub } from "../src/publish/github.ts";
import { readPublished } from "../src/publish/published.ts";
import { runRecheck, type IssueEvent } from "../src/publish/recheck.ts";
import { httpSource } from "../src/sources/http.ts";
import { recordedSource } from "../src/sources/recorded.ts";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const list = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return [];
  const values: string[] = [];
  for (const value of args.slice(i + 1)) {
    if (value.startsWith("--")) break;
    values.push(value);
  }
  return values;
};

const eventPath = dryRun ? option("--event") : process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error(dryRun ? "--dry-run needs --event <file>" : "GITHUB_EVENT_PATH is not set");
const event = JSON.parse(readFileSync(eventPath, "utf8")) as IssueEvent;

const recorded = list("--recorded");
const source = recorded.length
  ? await recordedSource(...recorded.map((folder) => new URL(`${folder.replace(/\/?$/, "/")}`, `file://${process.cwd()}/`)))
  : httpSource({ log: (line) => console.log(line) });
const now = option("--now") ? new Date(option("--now")!) : new Date();
if (Number.isNaN(now.getTime())) throw new Error(`--now: not an instant: ${option("--now")}`);

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
const runUrl = GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined;
const github = dryRun ? memoryGitHub() : ghCli({ cwd: fileURLToPath(root), statusBranch: "status", base: "main" });

const result = await runRecheck({
  event,
  manifests: norms,
  previous: await readPublished(new URL("dataset/", root)),
  source,
  now,
  github,
  ...(runUrl && { runUrl }),
  publishWorkflow: "publish.yml",
});

// Only our own values: the outcome, and a norm key and target id the recheck validated against the dataset.
console.log(`recheck: issue #${event.issue.number}: ${result.outcome}${result.norm ? ` ${result.norm}` : ""}${result.target ? ` ${result.target}` : ""}`);
if (dryRun) {
  const memory = github as ReturnType<typeof memoryGitHub>;
  console.log(`recheck: dry run, nothing posted. GitHub actions it would take:\n${memory.log.map((l) => `  ${l}`).join("\n") || "  (none)"}`);
  if (result.comment) console.log(`\n${result.comment}`);
}

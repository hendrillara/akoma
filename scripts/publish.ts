// `pnpm publish:daily`: the daily publish job (src/publish/job.ts; docs/publishing.md).
//
//   node scripts/publish.ts                      the workflow's run: live sources, git + gh, `pnpm verify`
//   node scripts/publish.ts --rebuild            the same, rebuilding even when no page moved (a divergence recheck
//                                                confirmed a difference and started the run; #18)
//   node scripts/publish.ts --dry-run [options]  everything but GitHub and the checkout: writes out/dry-run/ (the
//                                                PR body, the actions it would take, the status, and in workspace/
//                                                the capture and dataset/ it would commit)
//
// Dry-run options:
//   --recorded <folder>…   replay these capture folders instead of fetching (later folders win), e.g.
//                          --recorded fixtures/2026-10-20 fixtures/2026-10-21 test/fixtures/refresh/ec142
//   --now <ISO instant>    the run's instant (default: now); its Brasília day is the build's date
//   --status <file>        the run status the previous run left (default: none)
//
// Environment (the workflow sets them): the layer 3 reviewer's OPENAI_API_KEY and/or ANTHROPIC_API_KEY,
// AKOMA_REVIEW_PROVIDER (openai | anthropic; unset: OpenAI if its key is set, else Claude) and AKOMA_REVIEW_MODEL
// (src/review/select.ts; no usable key → the review blocks any change it must see), GITHUB_SERVER_URL +
// GITHUB_REPOSITORY + GITHUB_RUN_ID (the run link), GH_TOKEN (gh).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { norms } from "../src/norms/index.ts";
import { ghCli, memoryGitHub } from "../src/publish/github.ts";
import { runDailyJob, type TestResult, type TestRunner } from "../src/publish/job.ts";
import { readPublished } from "../src/publish/published.ts";
import { diskWorkspace, memoryWorkspace } from "../src/publish/workspace.ts";
import { selectReviewer } from "../src/review/select.ts";
import { cli, nowFrom, runUrlFromEnv, sourceFrom } from "./cli.ts";

const root = new URL("../", import.meta.url);
const args = cli();
const { dryRun } = args;
const option = args.option;

const source = await sourceFrom(args);
const now = nowFrom(args);

const reviewer = selectReviewer(process.env);
const runUrl = runUrlFromEnv();

const github = dryRun ? memoryGitHub() : ghCli({ cwd: fileURLToPath(root), statusBranch: "status", base: "main" });
if (dryRun && option("--status")) await github.writeStatus([{ path: "status.json", content: readFileSync(option("--status")!, "utf8") }]);
const workspace = dryRun ? memoryWorkspace() : diskWorkspace(root);
const tests: TestRunner = dryRun ? { async verify() { return { passed: true, ran: false, summary: "This is a dry run." }; } } : { verify: verify };

const result = await runDailyJob({
  manifests: norms,
  previous: await readPublished(new URL("dataset/", root)),
  source,
  now,
  ...reviewer,
  github,
  workspace,
  tests,
  ...(runUrl && { runUrl }),
  ...(args.has("--rebuild") && { rebuild: true }),
  // A merge made with the workflow token starts no `push` workflow; `workflow_dispatch` is the exception.
  ...(existsSync(new URL(".github/workflows/deploy.yml", root)) && { deployWorkflow: "deploy.yml" }),
});

console.log(`publish: ${result.outcome} (${result.today}): ${result.message}`);
if (result.verdict) console.log(`publish: verdict ${result.verdict.decision}, ${result.verdict.findings.filter((f) => f.severity === "problem").length} problems`);
if (dryRun) {
  const out = diskWorkspace(new URL("out/dry-run/", root));
  const memory = github as ReturnType<typeof memoryGitHub>;
  const files = workspace as ReturnType<typeof memoryWorkspace>;
  await out.write("actions.txt", `${memory.log.join("\n")}\n`);
  await out.write("status.json", memory.status.get("status.json") ?? "");
  await out.write("badge.json", memory.status.get("badge.json") ?? "");
  if (result.body) await out.write("pr-body.md", result.body);
  if (files.files.has("out/change-report.md")) await out.write("change-report.md", files.text("out/change-report.md"));
  // What the run would commit (the capture and dataset/), to inspect or to regenerate from.
  for (const [path, content] of files.files) if (!path.startsWith("out/")) await out.write(`workspace/${path}`, content);
  const { report: _, body: __, fullReport: ___, ...summary } = result;
  await out.write("result.json", `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`publish: dry run, nothing pushed. GitHub actions it would take:\n${memory.log.map((l) => `  ${l}`).join("\n") || "  (none)"}\nWritten: out/dry-run/`);
}
process.exit(result.outcome === "failed" ? 1 : 0);

/**
 * `pnpm verify` on the checkout (the written dataset, or the published one on a run with no change): typecheck, both
 * seams, the Map check and the regeneration guard. The failed test files, from vitest's "FAIL  test/…" lines, let the
 * run status say whether the golden sets passed.
 */
function verify(): Promise<TestResult> {
  return new Promise((resolve) => {
    // The tests and their dependencies never see the write token or an API key.
    const { GH_TOKEN: _token, GITHUB_TOKEN: _github, ANTHROPIC_API_KEY: _anthropic, OPENAI_API_KEY: _openai, ...env } = process.env;
    const child = spawn("pnpm", ["verify"], { cwd: fileURLToPath(root), env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      process.stdout.write(output);
      const tests = /Tests\s+(.+)/.exec(output)?.[1]?.trim();
      const tail = output.trim().split("\n").slice(-15).join("\n");
      const failedFiles = [...new Set([...output.matchAll(/FAIL\s+(test\/[\w./-]+\.test\.ts)/g)].map((m) => m[1]!))];
      resolve(
        code === 0
          ? { passed: true, summary: `pnpm verify passed${tests ? ` (tests: ${tests})` : ""}.` }
          : { passed: false, summary: `exit code ${code}. Last lines:\n\n\`\`\`\n${tail}\n\`\`\``, ...(tests && { failedFiles }) },
      );
    });
  });
}

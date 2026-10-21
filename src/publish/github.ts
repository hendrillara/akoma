// The GitHub port of the daily job: the branch, the PR, its label and merge, the issues, and the run status. Two
// adapters: `memoryGitHub` (dry runs and tests: records what the job asks, calls nothing) and `ghCli` (the
// workflow: git and the `gh` CLI, authenticated by the workflow's token).
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export interface Numbered {
  number: number;
  url: string;
}

export interface GitHub {
  /** Commits `paths` of the working tree onto HEAD as `branch`, force-pushes it, and returns to HEAD. */
  pushBranch(branch: string, paths: string[], message: string): Promise<void>;
  /** The open PR from `branch`, if any. */
  findOpenPullRequest(branch: string): Promise<Numbered | undefined>;
  createPullRequest(pr: { branch: string; title: string; body: string }): Promise<Numbered>;
  updatePullRequest(number: number, pr: { title: string; body: string }): Promise<void>;
  /** Adds (`on`) or removes a label, creating the label first when the repository lacks it. */
  setLabel(number: number, label: string, on: boolean): Promise<void>;
  mergePullRequest(number: number): Promise<void>;
  /** Starts a `workflow_dispatch` workflow on the default branch. */
  dispatchWorkflow(workflow: string): Promise<void>;
  /** The open issue carrying `label` (the job's dedupe key), if any. */
  findOpenIssue(label: string): Promise<Numbered | undefined>;
  createIssue(issue: { title: string; body: string; label: string }): Promise<Numbered>;
  commentOnIssue(number: number, body: string): Promise<void>;
  closeIssue(number: number, comment: string): Promise<void>;
  /** The run status file as the previous run left it (`undefined` before the first run). */
  readStatus(): Promise<string | undefined>;
  /** Replaces the run status files (`status.json`, `badge.json`) with these. */
  writeStatus(files: { path: string; content: string }[]): Promise<void>;
}

/** Labels the job manages, with the colour and description it creates them with. */
export const LABELS: Record<string, { color: string; description: string }> = {
  "needs-human": { color: "d93f0b", description: "A daily refresh the automated review did not pass: the maintainer decides" },
  "publish-failure": { color: "b60205", description: "The daily publish job failed (one open issue at a time)" },
  "source-outage": { color: "b60205", description: "A source has been unreachable for more than 48 hours (one open issue at a time)" },
};

// --- In memory ----------------------------------------------------------------------------------------------

export interface MemoryPull extends Numbered {
  branch: string;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "merged";
}

export interface MemoryIssue extends Numbered {
  title: string;
  body: string;
  label: string;
  state: "open" | "closed";
  comments: string[];
}

export interface MemoryGitHub extends GitHub {
  /** Every action, one line each, in order (status writes aside). */
  log: string[];
  pulls: MemoryPull[];
  issues: MemoryIssue[];
  status: Map<string, string>;
}

/** A GitHub that keeps everything in memory: the dry run's port, and the tests'. Reuse it across runs to chain them. */
export function memoryGitHub(repo = "https://github.com/hendrillara/akoma"): MemoryGitHub {
  let counter = 0;
  const pulls: MemoryPull[] = [];
  const issues: MemoryIssue[] = [];
  const log: string[] = [];
  const status = new Map<string, string>();
  const pull = (n: number) => pulls.find((p) => p.number === n)!;
  const issue = (n: number) => issues.find((i) => i.number === n)!;

  return {
    log,
    pulls,
    issues,
    status,
    async pushBranch(branch, paths) {
      log.push(`push ${branch}: ${paths.join(", ")}`);
    },
    async findOpenPullRequest(branch) {
      return pulls.find((p) => p.branch === branch && p.state === "open");
    },
    async createPullRequest({ branch, title, body }) {
      const number = ++counter;
      pulls.push({ number, url: `${repo}/pull/${number}`, branch, title, body, labels: [], state: "open" });
      log.push(`create PR #${number} from ${branch}: ${title}`);
      return pull(number);
    },
    async updatePullRequest(number, { title, body }) {
      Object.assign(pull(number), { title, body });
      log.push(`update PR #${number}: ${title}`);
    },
    async setLabel(number, label, on) {
      const p = pull(number);
      p.labels = on ? [...new Set([...p.labels, label])] : p.labels.filter((l) => l !== label);
      log.push(`${on ? "label" : "unlabel"} PR #${number} ${label}`);
    },
    async mergePullRequest(number) {
      pull(number).state = "merged";
      log.push(`merge PR #${number}`);
    },
    async dispatchWorkflow(workflow) {
      log.push(`dispatch ${workflow}`);
    },
    async findOpenIssue(label) {
      return issues.find((i) => i.label === label && i.state === "open");
    },
    async createIssue({ title, body, label }) {
      const number = ++counter;
      issues.push({ number, url: `${repo}/issues/${number}`, title, body, label, state: "open", comments: [] });
      log.push(`create issue #${number} [${label}]: ${title}`);
      return issue(number);
    },
    async commentOnIssue(number, body) {
      issue(number).comments.push(body);
      log.push(`comment on issue #${number}`);
    },
    async closeIssue(number, comment) {
      issue(number).comments.push(comment);
      issue(number).state = "closed";
      log.push(`close issue #${number}`);
    },
    async readStatus() {
      return status.get("status.json");
    },
    async writeStatus(files) {
      status.clear();
      for (const f of files) status.set(f.path, f.content);
    },
  };
}

// --- git + gh CLI -------------------------------------------------------------------------------------------

const run = promisify(execFile);

export interface GhCliOptions {
  /** The repository checkout the job runs in. */
  cwd: string;
  /** Branch holding the run status files (pushed by the job, never merged). */
  statusBranch: string;
  /** The default branch: the PR's base and where workflows are dispatched. The publish branch starts from HEAD. */
  base: string;
}

/**
 * The workflow's adapter. `gh` reads `GH_TOKEN` (the workflow token); git pushes with the checkout's credentials.
 * Commits are authored by the GitHub Actions bot, never by a person.
 */
export function ghCli({ cwd, statusBranch, base }: GhCliOptions): GitHub {
  const git = async (...args: string[]) => (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const gh = async (...args: string[]) => (await run("gh", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const bot = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];
  const ensured = new Set<string>();
  const ensureLabel = async (label: string) => {
    if (ensured.has(label)) return;
    const spec = LABELS[label];
    // --force updates the label when it exists, so this is idempotent.
    await gh("label", "create", label, "--force", ...(spec ? ["--color", spec.color, "--description", spec.description] : []));
    ensured.add(label);
  };
  /** Long bodies go through a file: they can exceed the argument size limit. */
  const withBody = async <T>(body: string, use: (file: string) => Promise<T>): Promise<T> => {
    const dir = await mkdtemp(join(tmpdir(), "akoma-gh-"));
    try {
      const file = join(dir, "body.md");
      await writeFile(file, body);
      return await use(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const numbered = (json: string): Numbered | undefined => (JSON.parse(json) as Numbered[])[0];

  return {
    async pushBranch(branch, paths, message) {
      const start = (await git("rev-parse", "HEAD")).trim();
      await git("checkout", "--quiet", "-B", branch);
      await git("add", "--all", "--", ...paths);
      await git(...bot, "commit", "--quiet", "-m", message);
      await git("push", "--quiet", "--force", "origin", `${branch}:refs/heads/${branch}`);
      await git("checkout", "--quiet", start);
    },
    async findOpenPullRequest(branch) {
      return numbered(await gh("pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"));
    },
    async createPullRequest({ branch, title, body }) {
      const url = (await withBody(body, (file) => gh("pr", "create", "--head", branch, "--base", base, "--title", title, "--body-file", file))).trim();
      return { number: Number(url.split("/").at(-1)), url };
    },
    async updatePullRequest(number, { title, body }) {
      await withBody(body, (file) => gh("pr", "edit", String(number), "--title", title, "--body-file", file));
    },
    async setLabel(number, label, on) {
      await ensureLabel(label);
      await gh("pr", "edit", String(number), on ? "--add-label" : "--remove-label", label);
    },
    async mergePullRequest(number) {
      await gh("pr", "merge", String(number), "--squash", "--delete-branch");
    },
    async dispatchWorkflow(workflow) {
      await gh("workflow", "run", workflow, "--ref", base);
    },
    async findOpenIssue(label) {
      return numbered(await gh("issue", "list", "--label", label, "--state", "open", "--json", "number,url", "--limit", "1"));
    },
    async createIssue({ title, body, label }) {
      await ensureLabel(label);
      const url = (await withBody(body, (file) => gh("issue", "create", "--title", title, "--label", label, "--body-file", file))).trim();
      return { number: Number(url.split("/").at(-1)), url };
    },
    async commentOnIssue(number, body) {
      await withBody(body, (file) => gh("issue", "comment", String(number), "--body-file", file));
    },
    async closeIssue(number, comment) {
      await withBody(comment, (file) => gh("issue", "comment", String(number), "--body-file", file));
      await gh("issue", "close", String(number));
    },
    async readStatus() {
      try {
        await git("fetch", "--quiet", "--depth=1", "origin", `${statusBranch}:refs/remotes/origin/${statusBranch}`);
      } catch {
        return undefined; // The branch does not exist before the first run.
      }
      return git("show", `refs/remotes/origin/${statusBranch}:status.json`);
    },
    async writeStatus(files) {
      // A worktree on an orphan commit: the status branch holds only these files, one commit per run.
      const dir = await mkdtemp(join(tmpdir(), "akoma-status-"));
      try {
        await git("worktree", "add", "--quiet", "--detach", dir);
        const inTree = async (...args: string[]) => (await run("git", args, { cwd: dir })).stdout;
        await inTree("checkout", "--quiet", "--orphan", `akoma-status-${Date.now()}`);
        await inTree("rm", "-r", "--quiet", "--cached", "--ignore-unmatch", ".");
        for (const f of files) await writeFile(join(dir, f.path), f.content);
        await inTree("add", "--", ...files.map((f) => f.path));
        await inTree(...bot, "commit", "--quiet", "-m", "Run status");
        await inTree("push", "--force", "origin", `HEAD:refs/heads/${statusBranch}`);
      } finally {
        await git("worktree", "remove", "--force", dir);
      }
    },
  };
}

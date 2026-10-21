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
  /** Starts a `workflow_dispatch` workflow on the default branch, with these inputs. */
  dispatchWorkflow(workflow: string, inputs?: Record<string, string>): Promise<void>;
  /** The open issue carrying `label` (the job's dedupe key), if any. */
  findOpenIssue(label: string): Promise<Numbered | undefined>;
  createIssue(issue: { title: string; body: string; label: string }): Promise<Numbered>;
  /** Comments on an issue; returns the comment's id (GitHub numbers comments in the order it creates them). */
  commentOnIssue(number: number, body: string): Promise<number>;
  /** Replaces the body of a comment the job wrote. */
  editComment(id: number, body: string): Promise<void>;
  closeIssue(number: number, comment: string): Promise<void>;
  /**
   * The comments the job itself wrote on issues and last updated at or after `since` (an ISO instant), oldest first
   * (by id). Comments by anyone else are never returned: anyone can comment, so only the job's own comments, checked
   * by author, can hold its state (the divergence recheck's markers).
   */
  ownComments(since: string): Promise<OwnComment[]>;
  /** The run status file as the previous run left it (`undefined` before the first run). */
  readStatus(): Promise<string | undefined>;
  /** Replaces the run status files (`status.json`, `badge.json`) with these. */
  writeStatus(files: { path: string; content: string }[]): Promise<void>;
}

export interface OwnComment {
  /** GitHub's comment id: later comments have larger ones. */
  id: number;
  /** The issue it is on. */
  issue: number;
  body: string;
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
  /**
   * An issue someone else opens (not logged: it is not the job's action). `comments` holds only the job's own, so the
   * issue starts with none.
   */
  openedByUser(issue: { title: string; body: string; label: string }): MemoryIssue;
  pulls: MemoryPull[];
  issues: MemoryIssue[];
  status: Map<string, string>;
}

/** A GitHub that keeps everything in memory: the dry run's port, and the tests'. Reuse it across runs to chain them. */
export function memoryGitHub(repo = "https://github.com/hendrillara/akoma"): MemoryGitHub {
  let counter = 0;
  /** Comment ids, in creation order, and where each comment sits. */
  let commentCounter = 1000;
  const commentAt = new Map<number, { issue: number; index: number }>();
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
    async dispatchWorkflow(workflow, inputs) {
      const given = Object.entries(inputs ?? {}).map(([k, v]) => `${k}=${v}`);
      log.push(`dispatch ${workflow}${given.length ? ` (${given.join(", ")})` : ""}`);
    },
    openedByUser({ title, body, label }) {
      const number = ++counter;
      issues.push({ number, url: `${repo}/issues/${number}`, title, body, label, state: "open", comments: [] });
      return issue(number);
    },
    async ownComments() {
      return [...commentAt].map(([id, at]) => ({ id, issue: at.issue, body: issue(at.issue).comments[at.index]! }));
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
      const id = ++commentCounter;
      // A dry run of the recheck comments on an issue that exists only on GitHub: logged, nothing to keep it on.
      const on = issues.find((i) => i.number === number);
      if (on) {
        on.comments.push(body);
        commentAt.set(id, { issue: number, index: on.comments.length - 1 });
      }
      log.push(`comment on issue #${number}`);
      return id;
    },
    async editComment(id, body) {
      const at = commentAt.get(id);
      if (at) issue(at.issue).comments[at.index] = body;
      log.push(`edit comment on issue #${at?.issue ?? "?"}`);
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
/**
 * The workflow token comments as the GitHub Actions bot: "github-actions[bot]" in REST, "github-actions" in GraphQL
 * (checked with gh on 2026-10-21), "app/github-actions" in some gh output.
 */
const isBot = (login: string | undefined) => login?.replace(/^app\//, "").replace(/\[bot\]$/, "") === "github-actions";

export interface GhCliOptions {
  /** The repository checkout the job runs in. */
  cwd: string;
  /** Branch holding the run status files (pushed by the job, never merged). */
  statusBranch: string;
  /** The default branch: the PR's base and where workflows are dispatched. The publish branch starts from HEAD. */
  base: string;
}

/**
 * The workflow's adapter. `gh` reads `GH_TOKEN` (the workflow token), and git pushes through gh's credential helper.
 * Commits are authored by the GitHub Actions bot, never by a person.
 */
export function ghCli({ cwd, statusBranch, base }: GhCliOptions): GitHub {
  const git = async (...args: string[]) => (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const gh = async (...args: string[]) => (await run("gh", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const bot = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];
  let gitAuth: Promise<unknown> | undefined;
  /** git pushes with the workflow token through gh's credential helper; the checkout keeps no token of its own. */
  const authGit = () => (gitAuth ??= gh("auth", "setup-git", "--hostname", "github.com"));
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
      await authGit();
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
    async dispatchWorkflow(workflow, inputs) {
      await gh("workflow", "run", workflow, "--ref", base, ...Object.entries(inputs ?? {}).flatMap(([k, v]) => ["-f", `${k}=${v}`]));
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
      const url = await withBody(body, (file) => gh("issue", "comment", String(number), "--body-file", file));
      const id = Number(/#issuecomment-(\d+)/.exec(url)?.[1]);
      if (!Number.isSafeInteger(id)) throw new Error("gh issue comment: no comment id in its output");
      return id;
    },
    async editComment(id, body) {
      await withBody(body, (file) => gh("api", "--method", "PATCH", `repos/{owner}/{repo}/issues/comments/${id}`, "-F", `body=@${file}`));
    },
    async closeIssue(number, comment) {
      await withBody(comment, (file) => gh("issue", "comment", String(number), "--body-file", file));
      await gh("issue", "close", String(number));
    },
    async ownComments(since) {
      // The repository's issue comments by update time (not the search index, which lags): read-after-write consistent.
      const lines = await gh("api", "--paginate", `repos/{owner}/{repo}/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=100`, "--jq", ".[] | {id, issue_url, login: .user.login, body}");
      return lines
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id: number; issue_url: string; login?: string; body: string })
        .filter((c) => isBot(c.login))
        .map((c) => ({ id: c.id, issue: Number(c.issue_url.split("/").at(-1)), body: c.body }))
        .sort((a, b) => a.id - b.id);
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
        await authGit();
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

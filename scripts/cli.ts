// What scripts/publish.ts and scripts/recheck.ts parse alike: their flags, the source (recorded captures or live HTTP),
// the run's instant and the Actions run link.
import { httpSource } from "../src/sources/http.ts";
import { recordedSource } from "../src/sources/recorded.ts";
import type { Source } from "../src/sources/source.ts";

export interface Cli {
  dryRun: boolean;
  has(flag: string): boolean;
  /** The value after `--name`. */
  option(name: string): string | undefined;
  /** The values after `--name`, up to the next flag. */
  list(name: string): string[];
}

export function cli(args = process.argv.slice(2)): Cli {
  return {
    dryRun: args.includes("--dry-run"),
    has: (flag) => args.includes(flag),
    option(name) {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    },
    list(name) {
      const i = args.indexOf(name);
      if (i < 0) return [];
      const values: string[] = [];
      for (const value of args.slice(i + 1)) {
        if (value.startsWith("--")) break;
        values.push(value);
      }
      return values;
    },
  };
}

/** `--recorded <folder>…` replays those capture folders (later ones win); without it, live HTTP. */
export async function sourceFrom(args: Cli): Promise<Source> {
  const recorded = args.list("--recorded");
  return recorded.length
    ? recordedSource(...recorded.map((folder) => new URL(`${folder.replace(/\/?$/, "/")}`, `file://${process.cwd()}/`)))
    : httpSource({ log: (line) => console.log(line) });
}

/** `--now <instant>`, or the clock. */
export function nowFrom(args: Cli): Date {
  const given = args.option("--now");
  const now = given ? new Date(given) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now: not an instant: ${given}`);
  return now;
}

/** The Actions run, from the variables the workflow sets; `undefined` outside Actions. */
export function runUrlFromEnv(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined;
}

// The working tree the daily job writes to: the new dataset, the capture it was built from, and its reports. In
// memory for dry runs and tests, the repository checkout in the workflow.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkspaceFile {
  /** Relative to the folder it is written into. */
  path: string;
  content: string | Uint8Array;
}

export interface Workspace {
  /** Writes one file (path relative to the repository root). */
  write(path: string, content: string | Uint8Array): Promise<void>;
  /** Replaces everything under `dir` (relative to the repository root) with `files`. */
  replace(dir: string, files: WorkspaceFile[]): Promise<void>;
}

export interface MemoryWorkspace extends Workspace {
  /** Every file written, by its path from the repository root. */
  files: Map<string, string | Uint8Array>;
  /** A written file as text. */
  text(path: string): string;
}

export function memoryWorkspace(): MemoryWorkspace {
  const files = new Map<string, string | Uint8Array>();
  return {
    files,
    text(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`${path} was not written`);
      return typeof content === "string" ? content : new TextDecoder().decode(content);
    },
    async write(path, content) {
      files.set(path, content);
    },
    async replace(dir, written) {
      for (const path of [...files.keys()]) if (path.startsWith(`${dir}/`)) files.delete(path);
      for (const file of written) files.set(`${dir}/${file.path}`, file.content);
    },
  };
}

/** The checkout at `root`. */
export function diskWorkspace(root: URL): Workspace {
  const base = fileURLToPath(root);
  const put = async (path: string, content: string | Uint8Array) => {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), content);
  };
  return {
    write: put,
    async replace(dir, written) {
      await rm(join(base, dir), { recursive: true, force: true });
      for (const file of written) await put(`${dir}/${file.path}`, file.content);
    },
  };
}

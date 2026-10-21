// The published dataset (`dataset/` at the repo root) is a pure function of the committed captures: every dated
// folder under `fixtures/`, later folders winning for the same URL. `pnpm build:dataset` writes it, and
// `pnpm check:dataset` (part of `pnpm verify`, so CI runs it) fails when the committed files are not exactly that
// regeneration, so generated data cannot be hand-edited. The daily job commits the pages it built from as a new
// dated folder, so the regeneration of its PR reads the very bytes it read (docs/publishing.md).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { norms } from "../norms/index.ts";
import { build, type NormManifest } from "../pipeline/build.ts";
import { datasetFiles, type DatasetFile } from "../pipeline/files.ts";
import type { Dataset } from "../schema/dataset.ts";
import { recordedSource } from "../sources/recorded.ts";

export interface PublishedBuild {
  dataset: Dataset;
  files: DatasetFile[];
  /** The build's date: the latest capture's `capturedOn` (a Brasília day). */
  today: string;
  /** The same day: one dataset version per published day, e.g. "2026-10-21". */
  datasetVersion: string;
  /** The capture folders read, oldest first. */
  captures: string[];
}

/** "2026-10-20" (a hand-made capture) or "2026-11-03-daily" (the daily job's), which sorts after a same-day one. */
const CAPTURE = /^\d{4}-\d{2}-\d{2}(?:-[a-z]+)?$/;

/** The dated capture folders under `fixtures`, oldest first. */
export async function captureFolders(fixtures: URL): Promise<string[]> {
  const entries = await readdir(fixtures, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && CAPTURE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Builds every registered norm from the committed captures. The date and the version come from the latest capture,
 * never from the clock or git, so the same commit always regenerates the same files.
 */
export async function publishedBuild(fixtures: URL, manifests: NormManifest[] = norms): Promise<PublishedBuild> {
  const captures = await captureFolders(fixtures);
  const latest = captures.at(-1);
  if (!latest) throw new Error(`no dated capture folder under ${fileURLToPath(fixtures)}`);
  const index = JSON.parse(await readFile(new URL(`${latest}/index.json`, fixtures), "utf8")) as { capturedOn: string };
  const today = index.capturedOn;
  const source = await recordedSource(...captures.map((c) => new URL(`${c}/`, fixtures)));
  const dataset = await build({ manifests, source, datasetVersion: today, today });
  return { dataset, files: datasetFiles(dataset), today, datasetVersion: today, captures };
}

/** `pnpm build:dataset`: writes `<repo>/dataset/` as the regeneration of `<repo>/fixtures/`. */
export async function buildDataset(repo: URL): Promise<PublishedBuild> {
  const published = await publishedBuild(new URL("fixtures/", repo));
  await writePublished(published.files, new URL("dataset/", repo));
  return published;
}

/**
 * `pnpm check:dataset` (in `pnpm verify`): how `<repo>/dataset/` differs from the regeneration of `<repo>/fixtures/`.
 * Empty lists: the committed dataset is exactly that regeneration.
 */
export async function checkDataset(repo: URL, manifests: NormManifest[] = norms): Promise<{ published: PublishedBuild; diff: PublishedDiff }> {
  const published = await publishedBuild(new URL("fixtures/", repo), manifests);
  return { published, diff: await diffPublished(published.files, new URL("dataset/", repo)) };
}

/** The previous dataset, as the last publish committed it. */
export async function readPublished(dir: URL): Promise<Dataset> {
  return JSON.parse(await readFile(new URL("dataset.json", dir), "utf8")) as Dataset;
}

export interface PublishedDiff {
  /** On disk with other content. */
  changed: string[];
  /** Generated, but not on disk. */
  missing: string[];
  /** On disk, but not generated. */
  extra: string[];
}

/** How the files in `dir` differ from `files` (paths relative to `dir`, sorted). */
export async function diffPublished(files: DatasetFile[], dir: URL): Promise<PublishedDiff> {
  const onDisk = new Set(await listFiles(fileURLToPath(dir)));
  const diff: PublishedDiff = { changed: [], missing: [], extra: [] };
  for (const file of files) {
    if (!onDisk.has(file.path)) diff.missing.push(file.path);
    else if ((await readFile(new URL(file.path, dir), "utf8")) !== file.content) diff.changed.push(file.path);
    onDisk.delete(file.path);
  }
  diff.extra = [...onDisk];
  for (const list of Object.values(diff)) list.sort();
  return diff;
}

/** Replaces the contents of `dir` with `files`. */
export async function writePublished(files: DatasetFile[], dir: URL): Promise<void> {
  const root = fileURLToPath(dir);
  await rm(root, { recursive: true, force: true });
  for (const file of files) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

async function listFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((e) => e.isFile()).map((e) => relative(root, join(e.parentPath, e.name)).split("\\").join("/"));
}

// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import type { Dataset } from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";

/** Declarative description of one norm; grows as norms are plugged in. */
export interface NormManifest {
  key: string;
  urn: string;
  title: string;
}

export interface BuildInput {
  manifests: NormManifest[];
  source: Source;
}

export async function build(_input: BuildInput): Promise<Dataset> {
  return { norms: [] };
}

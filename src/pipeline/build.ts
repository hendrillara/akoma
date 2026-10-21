// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import type { Dataset, NormEntry } from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";

/** Declarative description of one norm: its dataset identity, plus sources and quirks as norms are plugged in. */
export interface NormManifest extends NormEntry {}

export interface BuildInput {
  manifests: NormManifest[];
  source: Source;
}

export async function build(_input: BuildInput): Promise<Dataset> {
  return { norms: [] };
}

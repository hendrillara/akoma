// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import { createHash } from "node:crypto";
import type { Dataset, NormEntry, Provision } from "../schema/dataset.ts";
import type { Source } from "../sources/source.ts";
import { parsePlanaltoPage, type PageLayout } from "./planalto.ts";

/** Declarative description of one norm: its dataset identity, where its text comes from, and its page quirks. */
export interface NormManifest extends NormEntry, PageLayout {
  /** Planalto page holding the text in force (the primary source). */
  primaryUrl: string;
}

export interface BuildInput {
  manifests: NormManifest[];
  source: Source;
  /** Stamped into every record's provenance; chosen by the caller so the build stays deterministic. */
  datasetVersion: string;
}

export async function build({ manifests, source, datasetVersion }: BuildInput): Promise<Dataset> {
  const norms: NormEntry[] = [];
  const provisions: Provision[] = [];

  for (const manifest of manifests) {
    const snapshot = await source.get(manifest.primaryUrl);
    if (!snapshot) throw new Error(`${manifest.key}: primary source ${manifest.primaryUrl} is unavailable`);

    const html = new TextDecoder(snapshot.encoding).decode(snapshot.body);
    const seen = new Set<string>();
    for (const parsed of parsePlanaltoPage(html, manifest)) {
      // A duplicate means the parser misread the page (e.g. struck old wording kept); never let one shadow the other.
      if (seen.has(parsed.id)) throw new Error(`${manifest.key}: dispositivo id ${parsed.id} parsed twice`);
      seen.add(parsed.id);
      provisions.push({
        id: parsed.id,
        norm: manifest.key,
        path: parsed.path,
        text: parsed.text,
        provenance: {
          sourceUrl: snapshot.url,
          retrievedAt: snapshot.retrievedAt,
          contentHash: `sha256:${createHash("sha256").update(parsed.text, "utf8").digest("hex")}`,
          datasetVersion,
        },
      });
    }
    norms.push({ key: manifest.key, urn: manifest.urn, title: manifest.title });
  }

  return { norms, provisions };
}

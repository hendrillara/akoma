// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import { createHash } from "node:crypto";
import { NOTICE, type Dataset, type NormEntry, type Provision, type SourcePage } from "../schema/dataset.ts";
import type { RawSnapshot, Source } from "../sources/source.ts";
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
  const pages = new Map<string, SourcePage>();

  for (const manifest of manifests) {
    const snapshot = await source.get(manifest.primaryUrl);
    if (!snapshot) throw new Error(`${manifest.key}: primary source ${manifest.primaryUrl} is unavailable`);

    const html = new TextDecoder(snapshot.encoding).decode(snapshot.body);
    if (!pages.has(snapshot.url)) pages.set(snapshot.url, sourcePage(snapshot, html));
    const seen = new Set<string>();
    for (const parsed of parsePlanaltoPage(html, manifest, snapshot.url)) {
      // A duplicate means the parser misread the page (e.g. struck old wording kept); never let one shadow the other.
      if (seen.has(parsed.id)) throw new Error(`${manifest.key}: dispositivo id ${parsed.id} parsed twice`);
      seen.add(parsed.id);
      provisions.push({
        id: parsed.id,
        norm: manifest.key,
        kind: parsed.kind,
        label: parsed.label,
        path: parsed.path,
        text: parsed.text,
        status: parsed.status,
        amendments: parsed.amendments,
        references: parsed.references,
        provenance: {
          sourceUrl: snapshot.url,
          retrievedAt: snapshot.retrievedAt,
          contentHash: sha256(parsed.text),
          datasetVersion,
          notice: NOTICE,
        },
      });
    }
    norms.push({ key: manifest.key, urn: manifest.urn, title: manifest.title });
  }

  return { norms, provisions, pages: [...pages.values()] };
}

function sourcePage(snapshot: RawSnapshot, html: string): SourcePage {
  const { etag, "last-modified": lastModified } = snapshot.headers;
  // Script content is raw text up to the first "</script", so a lazy match removes exactly one element.
  const content = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  return {
    url: snapshot.url,
    retrievedAt: snapshot.retrievedAt,
    ...(etag !== undefined && { etag }),
    ...(lastModified !== undefined && { lastModified }),
    contentHash: sha256(content),
  };
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

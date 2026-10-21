// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import { createHash } from "node:crypto";
import {
  NOTICE,
  type Article,
  type Dataset,
  type Grouping,
  type NormEntry,
  type Provision,
  type SourcePage,
} from "../schema/dataset.ts";
import type { RawSnapshot, Source } from "../sources/source.ts";
import { parsePlanaltoPage, type PageLayout } from "./planalto.ts";

/**
 * Declarative description of one norm: its dataset identity, where its text comes from, the sources it is
 * cross-checked against, and its page quirks. Adding a norm means adding one of these plus its tests
 * (docs/adding-a-norm.md); the pipeline has no per-norm code.
 */
export interface NormManifest extends NormEntry, PageLayout {
  /** LexML type of the norm as its URN spells it, e.g. "constituicao", "lei", "decreto.lei". */
  type: string;
  /** The norm's date as its URN spells it (YYYY-MM-DD). */
  date: string;
  /** Planalto page holding the text in force (the primary source). */
  primaryUrl: string;
  /** Sources the primary text is cross-checked against, each with the outcome of checking whether it is usable. */
  secondarySources: SecondarySource[];
  /**
   * The page quirks this norm is known to have, as found when it was added. A record, not switches: the generic
   * parser handles every one of them, and the norm's golden set holds a dispositivo for each.
   */
  knownQuirks: string[];
}

/** A cross-check source for a norm's text (review layer 2). */
export interface SecondarySource {
  name: "normas.leg.br" | "camara-legin";
  /** The page or API response holding the norm's text. */
  url: string;
  /** How finely it can be compared: per dispositivo (articulated, with ids) or per article (text only). */
  granularity: "dispositivo" | "article";
  /** Whether it was found usable as a cross-check, when, and why (or why not). */
  verified: { on: string; usable: boolean; note: string };
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
  const groupings: Grouping[] = [];
  const articles: Article[] = [];
  const pages = new Map<string, SourcePage>();

  for (const manifest of manifests) {
    // The URN is the norm's public identity; a type or date that disagrees with it means the manifest has a typo.
    if (!manifest.urn.startsWith(`urn:lex:br:federal:${manifest.type}:${manifest.date};`)) {
      throw new Error(`${manifest.key}: URN ${manifest.urn} does not match type ${manifest.type} and date ${manifest.date}`);
    }
    const snapshot = await source.get(manifest.primaryUrl);
    if (!snapshot) throw new Error(`${manifest.key}: primary source ${manifest.primaryUrl} is unavailable`);

    const html = new TextDecoder(snapshot.encoding).decode(snapshot.body);
    if (!pages.has(snapshot.url)) pages.set(snapshot.url, sourcePage(snapshot, html));
    const seen = new Set<string>();
    const page = parsePlanaltoPage(html, manifest, snapshot.url);
    const groupingIds = new Set<string>();
    for (const parsed of page.groupings) {
      // Two headings with one id mean a heading was misread (or a struck old one kept): the outline would be ambiguous.
      if (groupingIds.has(parsed.id)) throw new Error(`${manifest.key}: grouping id ${parsed.id} parsed twice`);
      groupingIds.add(parsed.id);
      groupings.push({ norm: manifest.key, ...parsed });
    }
    for (const parsed of page.articles) articles.push({ norm: manifest.key, ...parsed });
    for (const parsed of page.provisions) {
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

  return { norms, provisions, groupings, articles, pages: [...pages.values()] };
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

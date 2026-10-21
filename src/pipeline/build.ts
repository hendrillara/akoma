// The build pipeline: raw snapshots + norm manifests in, canonical dataset out.
import { createHash } from "node:crypto";
import { crossCheck, NORMAS_ATTRIBUTION } from "../review/cross-source.ts";
import {
  NOTICE,
  type Article,
  type CrossSourceStatus,
  type Dataset,
  type Grouping,
  type NormEntry,
  type Provision,
  type SecondarySourceName,
  type SourcePage,
} from "../schema/dataset.ts";
import type { RawSnapshot, Source } from "../sources/source.ts";
import { readAmendingAct, type AmendingAct } from "./acts.ts";
import { parsePlanaltoPage, type PageLayout } from "./planalto.ts";
import { applyDeferredChanges, type Draft } from "./vigencia.ts";
import { isCalendarDate } from "./vigencia-dates.ts";

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
  /** How amending acts name this norm, e.g. "Constituição Federal" (needed with `deferredActs`). */
  citedAs?: string;
  /**
   * Official pages of the amending acts whose vigência clause defers changes to this norm (ADR 0003). The build reads
   * each one for its pending wordings; one missing from the source fails the build.
   */
  deferredActs?: string[];
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
  name: SecondarySourceName;
  /** The page or API response holding the norm's text. */
  url: string;
  /**
   * `dispositivo`: articulated, with ids of its own (kept as aliases); `article`: a page of text with no ids. Either
   * way, review layer 2 matches each dispositivo by the id its printed labels give it (ADR 0004).
   */
  granularity: "dispositivo" | "article";
  /** Whether it was found usable as a cross-check, when, and why (or why not). */
  verified: { on: string; usable: boolean; note: string };
}

export interface BuildInput {
  manifests: NormManifest[];
  source: Source;
  /** Stamped into every record's provenance; chosen by the caller so the build stays deterministic. */
  datasetVersion: string;
  /**
   * The build's date (YYYY-MM-DD, Brasília): deferred changes starting on or before it are promoted to in force.
   * Defaults to the day each norm's primary page was retrieved, so a build of recorded pages is deterministic; the
   * daily job (#12) passes the run's date explicitly.
   */
  today?: string;
}

export async function build({ manifests, source, datasetVersion, today }: BuildInput): Promise<Dataset> {
  if (today !== undefined && !isCalendarDate(today)) throw new Error(`build: today must be a YYYY-MM-DD date, got "${today}"`);
  const norms: NormEntry[] = [];
  const provisions: Provision[] = [];
  const groupings: Grouping[] = [];
  const articles: Article[] = [];
  const pages = new Map<string, SourcePage>();
  const crossSource: CrossSourceStatus[] = [];
  const acts = new Map<string, Promise<{ act: AmendingAct; retrievedAt: string; url: string }>>();
  const actAt = (url: string) => {
    if (!acts.has(url)) acts.set(url, readAct(source, url));
    return acts.get(url)!;
  };

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
    const drafts: Draft[] = [];
    for (const parsed of page.provisions) {
      // A duplicate means the parser misread the page (e.g. struck old wording kept); never let one shadow the other.
      if (seen.has(parsed.id)) throw new Error(`${manifest.key}: dispositivo id ${parsed.id} parsed twice`);
      seen.add(parsed.id);
      drafts.push({
        id: parsed.id,
        norm: manifest.key,
        kind: parsed.kind,
        label: parsed.label,
        path: parsed.path,
        text: parsed.text,
        status: parsed.status,
        amendments: parsed.amendments,
        references: parsed.references,
        provenance: { sourceUrl: snapshot.url, retrievedAt: snapshot.retrievedAt, datasetVersion, notice: NOTICE },
      });
    }

    if (manifest.deferredActs?.length) {
      if (!manifest.citedAs) throw new Error(`${manifest.key}: deferredActs needs citedAs`);
      const read = await Promise.all(manifest.deferredActs.map(actAt));
      applyDeferredChanges(drafts, read, manifest.citedAs, today ?? brasiliaDay(snapshot), ({ act, retrievedAt }) => ({
        sourceUrl: act.act.href!,
        retrievedAt,
        datasetVersion,
        notice: NOTICE,
      }));
    }

    // Review layer 2: every dispositivo gets its secondary-source outcome; normas.leg.br's own ids become aliases.
    const checked = await crossCheck(manifest, drafts, source);
    crossSource.push(checked.status);
    for (const draft of drafts) {
      const { id, provenance, pending, ...rest } = draft;
      const aliases = checked.aliases.get(id);
      provisions.push({
        id,
        ...(aliases && { aliases }),
        ...rest,
        ...(pending && { pending }),
        provenance: { ...provenance, contentHash: sha256(draft.text), secondary: checked.agreement.get(id)! },
      } as Provision);
    }
    norms.push({
      key: manifest.key,
      urn: manifest.urn,
      title: manifest.title,
      ...(checked.aliases.size && { attribution: NORMAS_ATTRIBUTION }),
    });
  }

  return { norms, provisions, groupings, articles, pages: [...pages.values()], status: { crossSource } };
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

async function readAct(source: Source, url: string): Promise<{ act: AmendingAct; retrievedAt: string; url: string }> {
  const snapshot = await source.get(url);
  if (!snapshot) throw new Error(`amending act ${url} is unavailable`);
  const act = readAmendingAct(new TextDecoder(snapshot.encoding).decode(snapshot.body), snapshot.url);
  return { act, retrievedAt: snapshot.retrievedAt, url };
}

/** The calendar day, in Brasília, on which a snapshot was retrieved. */
function brasiliaDay(snapshot: RawSnapshot): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(snapshot.retrievedAt)) return snapshot.retrievedAt;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(snapshot.retrievedAt));
}

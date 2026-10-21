// What each endpoint answers, over an index of the dataset built once per handler: a JSON body and its compact
// Markdown rendering. Every successful view carries the notice (unofficial text, vigência not verified against STF).
import { escape, lines } from "../pipeline/files.ts";
import {
  NOTICE,
  type Article,
  type Dataset,
  type Grouping,
  type NormEntry,
  type PathSegment,
  type Provision,
  type SourcePage,
} from "../schema/dataset.ts";

/** An endpoint's answer before content negotiation: `md` is rendered only when Markdown is asked for. */
export interface View {
  status: number;
  json: unknown;
  md: () => string;
}

/** Where a norm's text came from and which build it is in: the provenance its records share. */
interface Currency {
  sourceUrl: string;
  retrievedAt: string;
  datasetVersion: string;
}

interface ArticleRef {
  id: string;
  label: string;
}

interface ArticleRange {
  first: ArticleRef;
  last: ArticleRef;
  count: number;
}

interface OutlineNode {
  id: string;
  kind: Grouping["kind"];
  label: string;
  name: string;
  articles?: ArticleRange;
  children: OutlineNode[];
}

const STATUS: Record<string, string> = {
  revoked: "revogado / revoked",
  vetoed: "vetado / vetoed",
  renumbered: "renumerado / renumbered",
  not_yet_in_force: "ainda não vigente / not yet in force",
};

export type Views = ReturnType<typeof createViews>;

export function createViews(dataset: Dataset) {
  const norms = new Map(dataset.norms.map((n) => [n.key, n]));
  const provisions = new Map<string, Provision>();
  const byArticle = new Map<string, Provision[]>();
  // An alias claimed by two dispositivos suggests neither (null): a wrong suggestion is worse than none.
  const aliases = new Map<string, string | null>();
  for (const p of dataset.provisions) {
    provisions.set(`${p.norm}/${p.id}`, p);
    const article = `${p.norm}/${p.id.split("_")[0]}`;
    const members = byArticle.get(article);
    if (members) members.push(p);
    else byArticle.set(article, [p]);
    for (const alias of p.aliases ?? []) {
      const key = `${p.norm}/${alias}`;
      aliases.set(key, aliases.has(key) && aliases.get(key) !== p.id ? null : p.id);
    }
  }
  const articles = new Map((dataset.articles ?? []).map((a) => [`${a.norm}/${a.id}`, a]));
  const of = <T extends { norm: string }>(items: T[] | undefined, norm: string) => (items ?? []).filter((i) => i.norm === norm);
  // Per norm, computed once: a Worker has a few milliseconds of CPU per request.
  const stats = new Map(
    dataset.norms.map((n) => {
      const own = of(dataset.provisions, n.key);
      const first = own[0]?.provenance;
      const currency: Currency | undefined = first && {
        sourceUrl: first.sourceUrl,
        retrievedAt: first.retrievedAt,
        datasetVersion: first.datasetVersion,
      };
      const counts = {
        articles: of(dataset.articles, n.key).length,
        groupings: of(dataset.groupings, n.key).length,
        provisions: own.length,
        byStatus: countStatus(own),
      };
      const outline = buildOutline(of(dataset.groupings, n.key), of(dataset.articles, n.key));
      return [n.key, { currency, counts, outline }] as const;
    }),
  );
  const currency = (norm: string) => stats.get(norm)?.currency;
  const datasetVersion = dataset.provisions[0]?.provenance.datasetVersion;

  return {
    norms(): View {
      const list = dataset.norms.map((n) => ({ key: n.key, urn: n.urn, title: n.title, ...currency(n.key) }));
      return ok({ norms: list, notice: NOTICE }, () => {
        const items = list.map((n) => {
          const retrieved = n.retrievedAt ? ` · obtido em / retrieved ${n.retrievedAt}` : "";
          return `- \`${n.key}\` ${escape(n.title)} · \`${n.urn}\`${retrieved}`;
        });
        return document([items.length ? items.join("\n") : "Nenhuma norma / No norms."], datasetFooter(datasetVersion));
      });
    },

    norm(key: string): View {
      const norm = norms.get(key);
      if (!norm) return notFound();
      const { counts } = stats.get(key)!;
      const links = { structure: `/v1/norms/${key}/structure`, provisions: `/v1/provisions/${key}/{id}` };
      const now = currency(key);
      return ok({ norm: { ...norm, ...now, counts }, links, notice: NOTICE }, () =>
        document(
          [
            heading(norm),
            `URN \`${norm.urn}\``,
            `${counts.articles} artigos / articles · ${counts.groupings} agrupamentos / groupings · ${counts.provisions} dispositivos`,
            `Estrutura / structure: ${links.structure} · dispositivo: ${links.provisions}`,
          ],
          now ? footer(now) : NOTICE,
        ),
      );
    },

    structure(key: string): View {
      const norm = norms.get(key);
      if (!norm) return notFound();
      const { outline, range } = stats.get(key)!.outline;
      const now = currency(key);
      const json = {
        norm: { key: norm.key, urn: norm.urn, title: norm.title },
        ...(range && { articles: range }),
        outline,
        ...(now && { provenance: { ...now, notice: NOTICE } }),
        notice: NOTICE,
      };
      return ok(json, () => {
        const lines = outlineLines(outline, 0);
        const body = [heading(norm), ...(range ? [`${rangeText(range)} (${range.count})`] : [])];
        if (lines.length) body.push(lines.join("\n"));
        return document(body, now ? footer(now) : NOTICE);
      });
    },

    provision(key: string, id: string): View {
      // Only a known norm and a well-formed id may be named back in a response: anything else is never echoed.
      if (!norms.has(key) || !ID.test(id)) return notFound();
      const provision = provisions.get(`${key}/${id}`);
      if (provision) {
        return ok(provision, () => {
          const status = STATUS[provision.status] ?? (provision.status === "in_force" ? undefined : provision.status);
          const where = `*${provision.path.map((s) => s.label).join(" › ")}* · \`${key}\` \`${id}\`${status ? ` · ${status}` : ""}`;
          return document([...lines(provision), where], footer(provision.provenance));
        });
      }
      const members = byArticle.get(`${key}/${id}`);
      if (members && /^art\d/.test(id)) {
        // An article a deferred act inserts exists only as its pending dispositivos, with no Article record yet.
        const label = members[0]!.path.find((segment) => segment.kind === "artigo")?.label ?? id;
        return wholeArticle(articles.get(`${key}/${id}`) ?? { norm: key, id, label }, members);
      }
      const suggested = aliases.get(`${key}/${id}`);
      return notFound([key, id], suggested ? { id: suggested, url: `/v1/provisions/${key}/${suggested}` } : undefined);
    },

    status(): View {
      const perNorm = dataset.norms.map((n) => {
        const { currency: now, counts } = stats.get(n.key)!;
        return { key: n.key, ...now, articles: counts.articles, provisions: counts.provisions };
      });
      const pages: SourcePage[] = dataset.pages ?? [];
      const json = { ...(datasetVersion && { datasetVersion }), norms: perNorm, pages, notice: NOTICE };
      return ok(json, () => {
        const normLines = perNorm.map(
          (n) =>
            `- \`${n.key}\` · ${n.articles} artigos / articles · ${n.provisions} dispositivos` +
            (n.sourceUrl ? ` · fonte / source ${n.sourceUrl} · obtido em / retrieved ${n.retrievedAt}` : ""),
        );
        const pageLines = pages.map(
          (p) =>
            `- ${p.url} · obtido em / retrieved ${p.retrievedAt}` +
            (p.etag ? ` · ETag \`${p.etag}\`` : "") +
            (p.lastModified ? ` · Last-Modified ${p.lastModified}` : ""),
        );
        const body = ["# Status", ...(datasetVersion ? [`Dataset ${datasetVersion}`] : [])];
        if (normLines.length) body.push(normLines.join("\n"));
        if (pageLines.length) body.push(`Páginas de origem / source pages:\n${pageLines.join("\n")}`);
        return document(body, NOTICE);
      });
    },
  };
}

function wholeArticle(article: Article, members: Provision[]): View {
  const caput = members[0]!;
  // The caput's path ends with the article and then its own "caput" segment.
  const path: PathSegment[] = caput.path.slice(0, -1);
  const { sourceUrl, retrievedAt, datasetVersion, notice } = caput.provenance;
  const json = { article, path, provisions: members, provenance: { sourceUrl, retrievedAt, datasetVersion, notice } };
  return ok(json, () => {
    const groups = path.slice(0, -1).map((s) => s.label);
    const ids = `\`${article.norm}\` \`${article.id}\``;
    return document([groups.length ? `*${groups.join(" › ")}* · ${ids}` : ids, ...members.flatMap(lines)], footer(caput.provenance));
  });
}

/** The norm's groupings as a tree, each with the range of articles it holds (its own and its descendants'). */
function buildOutline(groupings: Grouping[], articles: Article[]): { outline: OutlineNode[]; range?: ArticleRange } {
  const nodes = new Map<string, OutlineNode>();
  const parents = new Map<string, string | undefined>();
  const outline: OutlineNode[] = [];
  for (const g of groupings) {
    const node: OutlineNode = { id: g.id, kind: g.kind, label: g.label, name: g.name, children: [] };
    nodes.set(g.id, node);
    parents.set(g.id, g.parent);
    const parent = g.parent === undefined ? undefined : nodes.get(g.parent);
    (parent ? parent.children : outline).push(node);
  }
  let range: ArticleRange | undefined;
  for (const a of articles) {
    const ref = { id: a.id, label: a.label };
    range = extend(range, ref);
    for (let id = a.grouping; id !== undefined; id = parents.get(id)) {
      const node = nodes.get(id);
      if (node) node.articles = extend(node.articles, ref);
    }
  }
  // Key order as documented: articles before children.
  const ordered = (node: OutlineNode): OutlineNode => {
    const { children, articles: held, ...rest } = node;
    return { ...rest, ...(held && { articles: held }), children: children.map(ordered) };
  };
  return { outline: outline.map(ordered), ...(range && { range }) };
}

function extend(range: ArticleRange | undefined, ref: ArticleRef): ArticleRange {
  return range ? { first: range.first, last: ref, count: range.count + 1 } : { first: ref, last: ref, count: 1 };
}

function outlineLines(nodes: OutlineNode[], depth: number): string[] {
  return nodes.flatMap((n) => {
    const name = n.name ? ` — ${escape(n.name)}` : "";
    const held = n.articles ? ` · ${rangeText(n.articles)}` : "";
    return [`${"  ".repeat(depth)}- ${n.label}${name} · \`${n.id}\`${held}`, ...outlineLines(n.children, depth + 1)];
  });
}

function rangeText({ first, last, count }: ArticleRange): string {
  return count === 1 ? first.label : `${first.label} a ${last.label}`;
}

function countStatus(provisions: Provision[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of provisions) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return counts;
}

function heading(norm: NormEntry): string {
  return `# ${escape(norm.title)} · \`${norm.key}\``;
}

/** Blocks separated by blank lines, then the provenance footer. */
export function document(blocks: string[], closing: string): string {
  return `${[...blocks, closing].join("\n\n")}\n`;
}

/** The provenance footer: where the text came from, when, which build, and the notice. */
function footer(currency: Currency): string {
  return `---\n${sourceLine(currency)}\n${NOTICE}`;
}

/** Where a text came from, when, and which build it is in. */
export function sourceLine({ sourceUrl, retrievedAt, datasetVersion }: Currency): string {
  return `Fonte / source: ${sourceUrl} · obtido em / retrieved ${retrievedAt} · dataset ${datasetVersion}`;
}

function datasetFooter(version: string | undefined): string {
  return `---\n${version ? `Dataset ${version}\n` : ""}${NOTICE}`;
}

function ok(json: unknown, md: () => string): View {
  return { status: 200, json, md };
}

/**
 * What an id may look like to be named back in a 404: LexML ids and normas.leg.br fragments ("art5_cpt_inc79",
 * "art5_cpt_inc79,emc-115-2022-02-10"). Agents read these responses as trusted legal text, so raw request input
 * (backticks, newlines, markup) must never reach a response body.
 */
export const ID = /^[a-z0-9][a-z0-9_.,-]{0,119}$/;

/**
 * 404. `named` (a known norm key and an id that passed `ID`) is named back; omit it for anything else. The canonical
 * id comes along when the id is a known alias.
 */
export function notFound(named: [norm: string, id: string] | [] = [], suggestion?: { id: string; url: string }): View {
  return {
    status: 404,
    json: { error: "not_found", ...(suggestion && { suggestion }) },
    md: () => {
      const what = named.length ? `Não encontrado / Not found: ${named.map((n) => `\`${n}\``).join(" ")}.` : "Não encontrado / Not found.";
      return `${what}${suggestion ? `\n\nVocê quis dizer / did you mean \`${suggestion.id}\`? ${suggestion.url}` : ""}\n`;
    },
  };
}

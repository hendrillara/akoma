// Where an amending act's official page is. A page's annotation links are never fetched as given: the URL is derived
// from the act's identity (type, number, year) by a fixed builder of Planalto paths, and a link only counts when it is
// one of those paths on https://www.planalto.gov.br. Any other link (another host, another path, plain http) marks the
// act unresolved, and an unresolved act blocks the merge; it is never fetched. After the fetch, the page's own title
// line must name the same act (`verifyActPage`).
import type { ActCitation, ActType } from "../schema/dataset.ts";
import { emc } from "../norms/cf.ts";

const PLANALTO = "https://www.planalto.gov.br/ccivil_03/";

export type ActPage = { url: string } | { problem: string };

/** "14.181" → "14181"; "1.890-67" → "1890-67". */
const digits = (number: string) => number.replace(/\./g, "");

/** Planalto's folder of acts of `year` since 2004: "_ato2004-2006", "_ato2007-2010", … "_ato2023-2026". */
function atoFolder(year: number): string {
  if (year < 2007) return "_ato2004-2006";
  const start = 2007 + 4 * Math.floor((year - 2007) / 4);
  return `_ato${start}-${start + 3}`;
}

/** Every path (under ccivil_03/, lower-cased) where Planalto keeps the page of this act. Empty: no builder for it. */
export function actPaths(type: ActType, number: string, year: number | undefined): string[] {
  const n = digits(number).toLowerCase();
  if (!/^\d+(?:-\d+)?$/.test(n)) return [];
  const recent = year !== undefined && year >= 2004 ? atoFolder(year) : undefined;
  switch (type) {
    case "emenda_constitucional":
      return [`constituicao/emendas/emc/emc${n}.htm`, `constituicao/emendas/emc_anterior1992/emc${n.padStart(2, "0")}-92.htm`];
    case "emenda_constitucional_de_revisao":
      return [`constituicao/emendas/ecr/ecr${n}.htm`];
    case "lei":
      if (year === undefined) return [];
      return recent ? [`${recent}/${year}/lei/l${n}.htm`] : [`leis/l${n}.htm`, `leis/${year}/l${n}.htm`, `leis/leis_${year}/l${n}.htm`];
    case "lei_complementar":
      return [`leis/lcp/lcp${n}.htm`, ...(recent ? [`${recent}/${year}/lei/lcp/lcp${n}.htm`] : [])];
    case "medida_provisoria":
      if (year === undefined) return [];
      return recent ? [`${recent}/${year}/mpv/mpv${n}.htm`] : [`mpv/${n}.htm`, `mpv/antigas/${n}.htm`, `mpv/${year}/${n}.htm`];
    case "decreto_lei":
      return [`decreto-lei/del${n}.htm`];
    case "decreto":
      if (year === undefined) return [];
      return recent ? [`${recent}/${year}/decreto/d${n}.htm`] : [`decreto/d${n}.htm`, `decreto/${year}/d${n}.htm`];
    case "decreto_legislativo":
      return [];
  }
}

/**
 * The page to fetch for an act an annotation cites. An EC is always read from its canonical URL (`emc`); any other act
 * from the link its annotation gives, once that link is shown to be one of the act's Planalto paths (the path's case
 * kept, as Planalto serves it). No link, or a link anywhere else: a problem, and nothing to fetch.
 */
export function actPage(act: ActCitation): ActPage {
  const paths = actPaths(act.type, act.number, act.year);
  if (!paths.length) return { problem: `no known Planalto address for an act of type ${act.type} without a usable number and year` };
  const link = act.href ? planaltoPath(act.href) : undefined;
  if (act.href && link === undefined) return { problem: "its annotation links to a page outside https://www.planalto.gov.br/ccivil_03/, which is never fetched" };
  if (link !== undefined && !paths.includes(link.toLowerCase())) return { problem: "its annotation links to a Planalto page that is not this act's, which is never fetched" };
  if (act.type === "emenda_constitucional") return { url: emc(Number(digits(act.number))) };
  if (link === undefined) return { problem: "its annotations give no link to its official page" };
  return { url: `${PLANALTO}${link}` };
}

/** The path under ccivil_03/ of an https link to www.planalto.gov.br, without query or fragment; else `undefined`. */
function planaltoPath(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.planalto.gov.br" || url.port !== "" || url.username || url.password) return undefined;
  if (!url.pathname.toLowerCase().startsWith("/ccivil_03/")) return undefined;
  return url.pathname.slice("/ccivil_03/".length);
}

/**
 * Whether a fetched page is the act's own: its title line names the same type and number, and the same year when the
 * annotation gives one. Returns a problem otherwise.
 */
export function verifyActPage(cited: ActCitation, page: ActCitation): string | undefined {
  const same = page.type === cited.type && digits(page.number) === digits(cited.number) && (cited.year === undefined || page.year === cited.year);
  return same ? undefined : `its page is the page of ${page.citation}, not of ${cited.citation}`;
}

// Reads normas.leg.br's JSON-LD ("maior-detalhe") for review layer 2, behind a guard on its shape: the API is
// undocumented, so any change to what this reader relies on fails the build instead of letting the check pass
// vacuously (spec story 42; ADR 0004). CC BY 4.0, © Senado Federal: its text is compared, never republished.
import type { ActType } from "../schema/dataset.ts";
import { actKey, romanToNumber, suffixId, type SecondaryDispositivo } from "./secondary.ts";

const LICENSE = "https://creativecommons.org/licenses/by/4.0/";

/** Node kinds (the suffix after "tipo.dispositivo:") as of the 2026-10-20 capture. */
const KINDS = new Set([
  "componente.autonomo.articulado",
  "ementa",
  "preambulo",
  "articulacao",
  "fecho",
  "assinaturas",
  "parte",
  "livro",
  "titulo",
  "capitulo",
  "secao",
  "subsecao",
  "artigo",
  "caput",
  "paragrafo",
  "inciso",
  "alinea",
  "item",
]);

/** Version kinds (`workExample[].legislationType`, a comma-separated set) as of the 2026-10-20 capture. */
const VERSIONS = new Set([
  "Original_Version",
  "Insertion_Version",
  "Text_Change_Version",
  "Repeal_Version",
  "Court_Decision_Version",
  "Suppression_Version",
  "Renumbering_Version",
  "Text_Indirect_Change_Version",
  "Applicability_Suppression_Version",
  "Suppression_By_Moviment_Version",
  "Insertion_By_Moviment_Version",
  "Text_Rectification_Version",
  "Publisher_Note_Version",
  "Text_Restoration_Version",
  "Reinsertion_Version",
]);

/** The node and its subtree no longer exist: suppressed, or moved elsewhere ("(Reposicionado)"). */
const GONE = new Set(["Suppression_Version", "Suppression_By_Moviment_Version"]);

/** LexML URN act types → Akoma's. Court decisions (supremo.tribunal.federal) amend nothing and are left out. */
const ACT_TYPES: Record<string, ActType> = {
  "emenda.constitucional": "emenda_constitucional",
  "emenda.constitucional.revisao": "emenda_constitucional_de_revisao",
  lei: "lei",
  "lei.complementar": "lei_complementar",
  "decreto.lei": "decreto_lei",
  "decreto.legislativo": "decreto_legislativo",
  decreto: "decreto",
  "medida.provisoria": "medida_provisoria",
};

interface Version {
  legislationType: string;
  name?: string | null;
  text?: string | null;
  legislationConsolidates?: { name?: string; "@id"?: string } | null;
}

/**
 * The norm's current dispositivos (caput, parágrafo, inciso, alínea, item), each with the id its printed labels give
 * it. Throws when the document is not the shape this reader was written against.
 * @param urn the norm's LexML URN, which the document must describe.
 */
export function readNormas(json: string, urn: string): SecondaryDispositivo[] {
  const fail = (what: string): never => {
    throw new Error(
      `normas.leg.br response for ${urn} changed shape: ${what}. Its API is undocumented; update src/review/normas.ts and ADR 0004 before trusting the cross-check again`,
    );
  };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return fail("the body is not JSON");
  }
  if (doc.legislationIdentifier !== urn) fail(`legislationIdentifier is ${JSON.stringify(doc.legislationIdentifier)}`);
  if (doc.license !== LICENSE) fail(`license is ${JSON.stringify(doc.license)}, not CC BY 4.0 (the attribution rules would change too)`);
  const root = doc.hasPart;
  if (!isObject(root) || kindOf(root, fail) !== "componente.autonomo.articulado") return fail("hasPart is not the articulated root node");
  if (!list(root.hasPart, "hasPart", fail).some((n) => kindOf(n, fail) === "articulacao")) fail("the root has no articulacao");

  const out: SecondaryDispositivo[] = [];
  let labelled = 0;
  let unlabelled = 0;
  const walk = (node: Record<string, unknown>, path: string[], inherited: Set<string>, revokedAbove: boolean) => {
    const kind = kindOf(node, fail);
    const id = node.legislationIdentifier;
    if (typeof id !== "string" || !id.includes("!")) fail(`a node's legislationIdentifier is ${JSON.stringify(id)}`);
    const fragment = (id as string).split("!")[1]!;
    const versions = list(node.workExample, `workExample of ${fragment}`, fail).map((v) => version(v, fragment, fail));
    const last = versions.at(-1);
    const types = new Set((last?.legislationType ?? "").split(", "));
    if ([...types].some((t) => GONE.has(t))) return;

    const acts = new Set(inherited);
    for (const v of versions) {
      const act = consolidatingAct(v.legislationConsolidates);
      if (act) acts.add(act);
    }
    let here = path;
    if (kind === "caput") here = [...path, "cpt"];
    else if (kind === "artigo" || kind === "paragrafo" || kind === "inciso" || kind === "alinea" || kind === "item") {
      if (!versions.length) fail(`the ${kind} ${fragment} has no versions`);
      const label = versions.findLast((v) => typeof v.name === "string" && v.name.trim())?.name ?? undefined;
      const own = segment(kind, label);
      if (own) labelled++;
      else unlabelled++;
      here = [...path, own ?? bareSegment(fragment)];
    }
    const text = last?.text ?? "";
    const plain = text.replace(/<[^>]*>/g, "").trim();
    // A revoked article or parágrafo revokes what hangs under it, even where those nodes still read as in force
    // (ADCT art. 111-A: the article reads "(Revogado)", its caput keeps the inserted wording).
    const revoked = revokedAbove || types.has("Repeal_Version") || /^\(?revogad[oa]s?\)?[.;]?$/i.test(plain);
    if (kind === "caput" || kind === "paragrafo" || kind === "inciso" || kind === "alinea" || kind === "item") {
      const status = revoked
        ? "revoked"
        : /^\(?vetad[oa]s?\)?[.;]?$/i.test(plain)
          ? "vetoed"
          : "in_force";
      const ownId = here.join("_");
      out.push({
        id: ownId,
        ...(fragment !== ownId && { alias: fragment }),
        text,
        status,
        acts,
        history: versions.map((v) => {
          const act = consolidatingAct(v.legislationConsolidates);
          return { text: v.text ?? "", ...(act && { act }) };
        }),
      });
    }
    for (const child of list(node.hasPart, `hasPart of ${fragment}`, fail)) walk(child, here, acts, revoked);
  };
  walk(root as Record<string, unknown>, [], new Set(), false);
  // A label gap is rare (CF art. 42 § 3º, ADCT art. 111-A); many mean `name` moved or changed its format.
  if (unlabelled > Math.max(5, labelled * 0.01)) fail(`${unlabelled} of ${labelled + unlabelled} dispositivos have no label this reader understands`);
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The API gives a single child or version as an object and several as an array; anything else is a new shape. */
function list(value: unknown, what: string, fail: (what: string) => never): Record<string, unknown>[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) if (!isObject(item)) fail(`${what} holds a ${item === null ? "null" : typeof item}`);
  return items as Record<string, unknown>[];
}

function kindOf(node: Record<string, unknown>, fail: (what: string) => never): string {
  const type = node.legislationType;
  const at = isObject(type) && typeof type["@id"] === "string" ? type["@id"] : undefined;
  const kind = at?.split("tipo.dispositivo:")[1];
  if (!kind || !KINDS.has(kind)) fail(`a node has legislationType ${JSON.stringify(type)}`);
  return kind!;
}

function version(value: Record<string, unknown>, fragment: string, fail: (what: string) => never): Version {
  const type = value.legislationType;
  if (typeof type !== "string") fail(`a version of ${fragment} has legislationType ${JSON.stringify(type)}`);
  for (const t of (type as string).split(", ")) if (!VERSIONS.has(t)) fail(`a version of ${fragment} has the unknown kind "${t}"`);
  for (const field of ["name", "text"] as const) {
    const v = value[field];
    if (v !== undefined && v !== null && typeof v !== "string") fail(`a version of ${fragment} has a ${typeof v} ${field}`);
  }
  const consolidates = value.legislationConsolidates;
  if (consolidates !== undefined && consolidates !== null && !isObject(consolidates)) {
    fail(`a version of ${fragment} has legislationConsolidates of type ${typeof consolidates}`);
  }
  return value as unknown as Version;
}

/** The amending act behind a version, from its URN ("…:emenda.constitucional:2026-10-16;141@…") or else its name. */
function consolidatingAct(consolidates: Version["legislationConsolidates"]): string | undefined {
  if (!consolidates) return undefined;
  const urn = /urn:lex:br:federal:([a-z.]+):[\d-]+;([\d.-]+)/.exec(consolidates["@id"] ?? "");
  if (urn) {
    const type = ACT_TYPES[urn[1]!];
    return type && actKey(type, urn[2]!);
  }
  const named = /^(?:.*?\b)?(Emenda Constitucional de Revisão|Emenda Constitucional)\s+nº\s*([\d.]+)/.exec(consolidates.name ?? "");
  if (!named) return undefined;
  return actKey(named[1] === "Emenda Constitucional" ? "emenda_constitucional" : "emenda_constitucional_de_revisao", named[2]!);
}

/** The id segment a printed label gives: "Art. 103-A" → art103-1, "Parágrafo único" → par1, "XV –" → inc15. */
function segment(kind: string, label: string | undefined): string | undefined {
  if (!label) return undefined;
  const text = label.trim();
  let m: RegExpExecArray | null;
  if (kind === "artigo" && (m = /^Art\.\s*(\d+)\s*[º°o]?((?:-[A-Z])*)/.exec(text))) return `art${m[1]}${suffixId(m[2]!)}`;
  if (kind === "paragrafo") {
    if (/^Parágrafo único/i.test(text)) return "par1";
    if ((m = /^§\s*(\d+)\s*[º°o]?((?:-[A-Z])*)/.exec(text))) return `par${m[1]}${suffixId(m[2]!)}`;
  }
  if (kind === "inciso" && (m = /^([IVXLCDM]+)((?:-[A-Z])*)/.exec(text))) return `inc${romanToNumber(m[1]!)}${suffixId(m[2]!)}`;
  if (kind === "alinea" && (m = /^([a-z])((?:-[A-Za-z])*)\)/.exec(text))) return `ali${m[1]!.charCodeAt(0) - 96}${suffixId(m[2]!)}`;
  if (kind === "item" && (m = /^(\d+)((?:-[A-Z])*)/.exec(text))) return `ite${Number(m[1])}${suffixId(m[2]!)}`;
  return undefined;
}

/** A node with no label anywhere in its history (CF art. 42 § 3º, reinserted by EC 101): its own fragment segment. */
function bareSegment(fragment: string): string {
  return fragment.split("_").at(-1)!.split(",")[0]!.replace(/^par(\d+)u$/, "par$1");
}

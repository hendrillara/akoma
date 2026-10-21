// The divergence recheck (#18): someone opens a "text divergence" issue, and the recheck reads the sources again for
// that dispositivo (fetch → build → compare with the committed dataset and the secondary source), then answers on the
// issue. A confirmed divergence (Planalto's page now prints something other than the published record) starts the
// daily publish job (src/publish/job.ts) with a forced rebuild, so the correction arrives as that job's reviewed PR;
// nothing else can come of an issue. The issue body is untrusted: only a registered norm key and dataset ids are taken
// from it (divergence.ts), and every comment is our own wording around them and around the sources' text.
// Anyone can open an issue, so each dispositivo is rechecked at most once per Brasília day, and all rechecks together
// at most `perDay` times, which bounds the requests strangers can make Akoma send to Planalto (ADR 0001).
import { build, type NormManifest } from "../pipeline/build.ts";
import type { Dataset, Provision, ProvisionStatus, SecondaryAgreement } from "../schema/dataset.ts";
import { redacting } from "../sources/redact.ts";
import type { Source } from "../sources/source.ts";
import { BASE } from "../worker/discovery.ts";
import { recording } from "./capture.ts";
import {
  DIVERGENCE_LABEL,
  fenced,
  inTarget,
  marker,
  markers,
  readRequest,
  sameMarker,
  type InvalidReason,
  type Marker,
  type RecheckOutcome,
} from "./divergence.ts";
import type { GitHub } from "./github.ts";
import { brasiliaDay } from "./job.ts";
import { BODY_LIMIT } from "./pr-body.ts";

/** The parts of GitHub's `issues` event payload the recheck reads. */
export interface IssueEvent {
  action?: string;
  issue: {
    number: number;
    body: string | null;
    labels?: { name?: string }[];
    user?: { type?: string };
  };
}

export interface RecheckInput {
  event: IssueEvent;
  manifests: NormManifest[];
  /** The dataset as the last publish committed it (dataset/dataset.json). */
  previous: Dataset;
  /** Live HTTP in the workflow, recorded captures in tests and dry runs. */
  source: Source;
  now: Date;
  github: GitHub;
  runUrl?: string;
  /** The daily publish workflow to start on a confirmed divergence. */
  publishWorkflow?: string;
  limits?: { perDay?: number };
}

export type RecheckResult = {
  /** `ignored`: not a divergence issue; `repeat`: this issue already has this very answer today. */
  outcome: RecheckOutcome | "ignored" | "repeat";
  norm?: string;
  target?: string;
  /** The comment posted, when one was. */
  comment?: string;
};

/** Rechecks per Brasília day, all issues together (each reads Planalto's page and the secondary source). */
export const RECHECKS_PER_DAY = 20;

export async function runRecheck(input: RecheckInput): Promise<RecheckResult> {
  const { event, github, now, manifests, previous } = input;
  const { issue } = event;
  if (!issue.labels?.some((l) => l.name === DIVERGENCE_LABEL) || issue.user?.type === "Bot") return { outcome: "ignored" };
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error("recheck: the event has no issue number");
  const today = brasiliaDay(now);

  // The intake's state: the markers in the job's own comments on divergence issues (today's, for dedupe and the cap).
  const issues = await github.labelledIssues(DIVERGENCE_LABEL, today);
  const own = issues.find((i) => i.number === issue.number)?.ownComments.flatMap(markers) ?? [];
  const todays = issues.flatMap((i) => i.ownComments.flatMap(markers).filter((m) => m.day === today).map((m) => ({ ...m, issue: i.number })));

  const answer = async (m: Marker, text: string): Promise<RecheckResult> => {
    const result = { ...(m.norm !== "-" && { norm: m.norm }), ...(m.target !== "-" && { target: m.target }) };
    // An edit that changes nothing the recheck reads gets no second, identical answer.
    if (own.some((o) => sameMarker(o, m))) return { outcome: "repeat", ...result };
    const comment = fit(`${marker(m)}\n${text}${input.runUrl ? `\n\nRun: ${input.runUrl}` : ""}\n`);
    await github.commentOnIssue(issue.number, comment);
    return { outcome: m.outcome!, ...result, comment };
  };

  const request = readRequest(issue.body, manifests.map((m) => m.key), previous);
  if (!request.ok) {
    return answer({ kind: "recheck", day: today, norm: request.norm ?? "-", target: "-", outcome: "invalid" }, invalidText(request.reason, manifests));
  }
  const { norm, target } = request;
  const base = { kind: "recheck" as const, day: today, norm, target: target.id };

  const done = todays.find((m) => m.kind === "recheck" && m.norm === norm && m.target === target.id && (m.outcome === "confirmed" || m.outcome === "not-confirmed"));
  if (done?.issue === issue.number) return { outcome: "repeat", norm, target: target.id };
  if (done) return answer({ ...base, outcome: "duplicate" }, duplicateText(norm, target.id, done.issue));
  const ran = new Set(todays.filter((m) => m.kind === "recheck" && ["confirmed", "not-confirmed", "unreachable"].includes(m.outcome ?? "")).map((m) => `${m.issue} ${m.norm} ${m.target}`));
  const perDay = input.limits?.perDay ?? RECHECKS_PER_DAY;
  if (ran.size >= perDay) return answer({ ...base, outcome: "limited" }, limitedText(perDay));

  // The recheck: the norm rebuilt from fresh pages, as the daily job builds it (redacted before anything reads them).
  const manifest = manifests.find((m) => m.key === norm)!;
  const source = recording(redacting(input.source));
  let fresh: Dataset;
  try {
    fresh = await build({ manifests: [manifest], source, datasetVersion: today, today });
  } catch (error) {
    if (source.unavailable().length) return answer({ ...base, outcome: "unreachable" }, unreachableText(norm, target.id));
    throw error;
  }

  const ids = [...new Set([...previous.provisions, ...fresh.provisions].filter((p) => p.norm === norm && inTarget(target.id, p.id)).map((p) => p.id))];
  const before = new Map(previous.provisions.filter((p) => p.norm === norm).map((p) => [p.id, p]));
  const after = new Map(fresh.provisions.map((p) => [p.id, p]));
  const compared: Compared[] = ids.map((id) => ({ id, before: before.get(id), after: after.get(id) }));
  const differing = compared.filter(({ before: b, after: a }) => !b || !a || b.text !== a.text || b.status !== a.status);
  const version = previous.provisions[0]?.provenance.datasetVersion ?? "?";
  const links = linksLine(manifest, norm, target.id);

  if (differing.length) {
    const result = await answer({ ...base, outcome: "confirmed" }, confirmedText(norm, target.id, version, differing, links));
    // The correction is the daily job's: a forced rebuild, its three-layer review and its one PR.
    if (result.outcome === "confirmed" && input.publishWorkflow) await github.dispatchWorkflow(input.publishWorkflow, { rebuild: "true" });
    return result;
  }
  return answer({ ...base, outcome: "not-confirmed" }, notConfirmedText(norm, target.id, version, compared, links));
}

/** A comment cut at a line to GitHub's body limit (only a long article's wordings could reach it). */
function fit(comment: string): string {
  if (comment.length <= BODY_LIMIT) return comment;
  const note = "\n\n_(cortado no limite do GitHub / cut at GitHub's limit)_\n";
  const cut = comment.slice(0, BODY_LIMIT - note.length);
  return `${cut.slice(0, cut.lastIndexOf("\n"))}${note}`;
}

// --- Our wording (PT, then EN) ---------------------------------------------------------------------------------

const code = (norm: string, id: string) => `\`${norm}\` \`${id}\``;

const STATUS: Record<ProvisionStatus, string> = {
  in_force: "em vigor / in force",
  revoked: "revogado / revoked",
  vetoed: "vetado / vetoed",
  renumbered: "renumerado / renumbered",
  not_yet_in_force: "ainda não em vigor / not yet in force",
};

const SOURCE_NAMES: Record<string, string> = { "normas.leg.br": "normas.leg.br", "camara-legin": "Câmara LEGIN" };

/** What the secondary source says, from layer 2's outcome: its note never quotes the secondary (CC BY 4.0). */
function secondaryLine(agreement: SecondaryAgreement | undefined): string {
  if (!agreement) return "- Fonte secundária / Secondary source: —";
  const name = agreement.source ? SOURCE_NAMES[agreement.source] : "Fonte secundária / Secondary source";
  const note = agreement.note ? ` ${agreement.note}` : "";
  if (agreement.outcome === "agrees") return `- ${name}: confere / agrees.${note}`;
  if (agreement.outcome === "secondary-stale") return `- ${name}: desatualizado / behind.${note}`;
  return `- ${name}: não confirma / unconfirmed.${note}`;
}

function wording(p: Provision): string {
  return p.text ? fenced(p.text) : "_(sem texto / no text)_";
}

function heading(norm: string, p: Provision): string {
  return `#### ${code(norm, p.id)} · ${p.path.map((s) => s.label).join(" › ")}`;
}

function linksLine(manifest: NormManifest, norm: string, id: string): string {
  return `Fontes / Sources: [Planalto](${manifest.primaryUrl}) · [Akoma API](${BASE}/v1/provisions/${norm}/${id})`;
}

/** Article targets can hold a hundred dispositivos: the comment details at most this many. */
const DETAILED = 8;

/** One dispositivo of the target: the published record and the rebuilt one (either can be missing). */
interface Compared {
  id: string;
  before: Provision | undefined;
  after: Provision | undefined;
}

function confirmedText(norm: string, id: string, version: string, differing: Compared[], links: string): string {
  const n = differing.length;
  const shown = differing.slice(0, DETAILED).map(({ before, after }) => {
    const p = (after ?? before)!;
    return [
      heading(norm, p),
      "",
      before ? `- Dataset publicado / Published dataset (${version}), ${STATUS[before.status]}:\n\n${wording(before)}` : "- Dataset publicado / Published dataset: _(ausente / absent)_",
      "",
      after
        ? `- Planalto, lido agora / read now (${after.provenance.retrievedAt}), ${STATUS[after.status]}:\n\n${wording(after)}`
        : "- Planalto, lido agora / read now: _(a página não traz mais este dispositivo / the page no longer has this dispositivo)_",
      "",
      secondaryLine(after?.provenance.secondary),
    ].join("\n");
  });
  const more = n > DETAILED ? [`… e mais ${n - DETAILED} / and ${n - DETAILED} more: ${differing.slice(DETAILED).map((d) => `\`${d.id}\``).join(", ")}`] : [];
  return [
    `**Divergência confirmada / Divergence confirmed** · ${code(norm, id)}`,
    "",
    `PT: A página do Planalto, lida agora, imprime ${n === 1 ? "este dispositivo" : `${n} dispositivos`} de outra forma que o dataset publicado (versão ${version}). O job diário de publicação foi disparado para reconstruir o dataset: o PR de correção passa pela revisão normal de três camadas, e o link dele vai aparecer aqui. Ninguém edita o dado à mão.`,
    "",
    `EN: Planalto's page, read just now, prints ${n === 1 ? "this dispositivo" : `${n} dispositivos`} differently from the published dataset (version ${version}). The daily publish job was started to rebuild the dataset: the correction PR goes through the normal three-layer review, and its link will appear here. Nobody edits the data by hand.`,
    "",
    ...shown.flatMap((s) => [s, ""]),
    ...more.flatMap((m) => [m, ""]),
    links,
  ].join("\n");
}

function notConfirmedText(norm: string, id: string, version: string, compared: Compared[], links: string): string {
  const records = compared.flatMap((c) => (c.after ? [c.after] : []));
  const detailed = records.length <= DETAILED ? records : records.filter((p) => p.provenance.secondary.outcome !== "agrees").slice(0, DETAILED);
  const shown = detailed.map((p) =>
    [heading(norm, p), "", `- Dataset publicado e Planalto / Published dataset and Planalto, ${STATUS[p.status]}:\n\n${wording(p)}`, "", secondaryLine(p.provenance.secondary)].join("\n"),
  );
  const summary =
    records.length > DETAILED
      ? [
          `${records.length} dispositivos: todos iguais no Planalto e no dataset; ${records.filter((p) => p.provenance.secondary.outcome === "agrees").length} conferem com a fonte secundária. / all the same on Planalto and in the dataset; ${records.filter((p) => p.provenance.secondary.outcome === "agrees").length} agree with the secondary source.${detailed.length ? " Os outros / The others:" : ""}`,
          "",
        ]
      : [];
  return [
    `**Divergência não confirmada / Divergence not confirmed** · ${code(norm, id)}`,
    "",
    `PT: A página do Planalto, lida agora, imprime o mesmo texto que o dataset publicado (versão ${version}), então nenhum PR é aberto. Abaixo, o que cada fonte diz. Se o texto oficial for outro, o mantenedor vai olhar esta issue; o campo "O que parece errado" é para ele.`,
    "",
    `EN: Planalto's page, read just now, prints the same text as the published dataset (version ${version}), so no PR is opened. Below is what each source says. If the official text is different, the maintainer will look at this issue; the "What looks wrong" field is for them.`,
    "",
    ...summary,
    ...shown.flatMap((s) => [s, ""]),
    links,
  ].join("\n");
}

const INVALID: Record<InvalidReason, string> = {
  "no-form": "PT: Esta issue não segue o modelo \"Divergência de texto\", então não há o que reconferir. Abra uma issue nova com o modelo. / EN: This issue does not follow the \"Text divergence\" template, so there is nothing to recheck. Open a new issue from the template.",
  norm: "PT: O campo \"Norma\" não traz uma norma que o Akoma publica. / EN: The \"Norm\" field does not name a norm Akoma publishes.",
  dispositivo:
    "PT: O campo \"Dispositivo\" não traz um dispositivo desta norma no dataset. Use o id do Akoma (como `art5_cpt_inc10`) ou o dispositivo como impresso (como art. 5º, inciso X). / EN: The \"Provision\" field does not name a dispositivo of this norm in the dataset. Use Akoma's id (such as `art5_cpt_inc10`) or the dispositivo as printed (such as art. 5º, inciso X).",
  ambiguous:
    "PT: O campo \"Dispositivo\" corresponde a mais de um dispositivo desta norma. Use o id do Akoma (como `art5_cpt_inc10`). / EN: The \"Provision\" field matches more than one dispositivo of this norm. Use Akoma's id (such as `art5_cpt_inc10`).",
};

function invalidText(reason: InvalidReason, manifests: NormManifest[]): string {
  return [
    "**Não foi possível reconferir / Could not recheck**",
    "",
    INVALID[reason],
    "",
    `Normas / Norms: ${manifests.map((m) => `\`${m.key}\``).join(", ")}. PT: Edite a issue para tentar de novo. / EN: Edit the issue to try again.`,
  ].join("\n");
}

function duplicateText(norm: string, id: string, earlier: number): string {
  return `**Já reconferido hoje / Already rechecked today** · ${code(norm, id)}\n\nPT: Este dispositivo já foi reconferido hoje, na #${earlier}; veja o resultado lá. Cada dispositivo é reconferido no máximo uma vez por dia (horário de Brasília). / EN: This dispositivo was already rechecked today, on #${earlier}; see the result there. Each dispositivo is rechecked at most once a day (Brasília time).`;
}

function limitedText(perDay: number): string {
  return `**Limite diário atingido / Daily limit reached**\n\nPT: Hoje já foram feitas ${perDay} reconferências, o limite diário, para não sobrecarregar as fontes oficiais. Edite a issue amanhã para tentar de novo; o mantenedor também vê esta issue. / EN: ${perDay} rechecks, the daily limit, have already run today, so as not to overload the official sources. Edit the issue tomorrow to try again; the maintainer sees this issue too.`;
}

function unreachableText(norm: string, id: string): string {
  return `**Fonte inacessível / Source unreachable** · ${code(norm, id)}\n\nPT: Não foi possível ler as páginas oficiais agora, então nada foi reconferido. Edite a issue mais tarde para tentar de novo. / EN: The official pages could not be read just now, so nothing was rechecked. Edit the issue later to try again.`;
}

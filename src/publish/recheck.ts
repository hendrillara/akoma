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
  brasiliaMidnight,
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

/** The triage label (docs/agents/triage-labels.md) an unconfirmed report gets: a maintainer evaluates it. */
export const TRIAGE_LABEL = "needs-triage";

/** Rechecks per Brasília day, all issues together (each reads Planalto's page and the secondary source). */
export const RECHECKS_PER_DAY = 20;

export async function runRecheck(input: RecheckInput): Promise<RecheckResult> {
  const { event, github, now, manifests, previous } = input;
  const { issue } = event;
  if (!issue.labels?.some((l) => l.name === DIVERGENCE_LABEL) || issue.user?.type === "Bot") return { outcome: "ignored" };
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error("recheck: the event has no issue number");
  const today = brasiliaDay(now);
  const since = brasiliaMidnight(today);
  const n = issue.number;

  /** Today's markers in the job's own comments (the intake's only state), each with its comment's id and issue. */
  const state = async () =>
    (await github.ownComments(since)).flatMap((c) => markers(c.body).filter((m) => m.day === today).map((m) => ({ ...m, id: c.id, issue: c.issue })));
  const todays = await state();
  const result = (m: Marker, comment?: string): RecheckResult => ({
    outcome: m.outcome!,
    ...(m.norm !== "-" && { norm: m.norm }),
    ...(m.target !== "-" && { target: m.target }),
    ...(comment && { comment }),
  });
  const body = (m: Marker, text: string) => fit(`${marker(m)}\n${text}${input.runUrl ? `\n\nRun: ${input.runUrl}` : ""}\n`);
  /** A new comment, unless this issue already has this very answer today (an edit that changes nothing it reads). */
  const post = async (m: Marker, text: string): Promise<RecheckResult> => {
    if (todays.some((o) => o.issue === n && sameMarker(o, m))) return { ...result(m), outcome: "repeat" };
    const comment = body(m, text);
    await github.commentOnIssue(n, comment);
    return result(m, comment);
  };

  const request = readRequest(issue.body, manifests.map((m) => m.key), previous);
  if (!request.ok) {
    return post({ kind: "recheck", day: today, norm: request.norm ?? "-", target: "-", outcome: "invalid" }, invalidText(request.reason, manifests));
  }
  // The canonical key: a registered norm and a dataset id (an alias, a label or another spelling resolves to the id).
  const { norm, target } = request;
  const base = { kind: "recheck" as const, day: today, norm, target: target.id };
  const perDay = input.limits?.perDay ?? RECHECKS_PER_DAY;
  type Entry = (typeof todays)[number];
  /** A recheck today that covers this target: the same target, or the article holding this dispositivo. */
  const covers = (e: Entry) =>
    e.kind === "recheck" && e.norm === norm && BLOCKING.has(e.outcome!) && (e.target === target.id || (target.kind === "provision" && e.target === target.id.split("_")[0]));
  /** Rechecks that fetched (or are fetching) today, all issues together. */
  const fetched = (entries: Entry[]) => new Set(entries.filter((e) => e.kind === "recheck" && COUNTED.has(e.outcome!)).map((e) => e.id)).size;

  // Fast path: answered without fetching anything.
  const done = todays.find(covers);
  if (done?.issue === n) return { outcome: "repeat", norm, target: target.id };
  if (done) return post({ ...base, outcome: "duplicate" }, duplicateText(norm, target.id, done.issue));
  if (fetched(todays) >= perDay) return post({ ...base, outcome: "limited" }, limitedText(perDay));

  // Check and record in one step: claim a slot with a comment, then read the state again. GitHub numbers comments in
  // the order it creates them, so among rechecks running at once only the earliest claim for a key, and only the
  // first `perDay` claims of the day, go on; the others turn their claim into the duplicate or limit answer.
  const claimed = { ...base, outcome: "claimed" as const };
  const id = await github.commentOnIssue(n, body(claimed, claimText(norm, target.id)));
  const finish = async (m: Marker, text: string): Promise<RecheckResult> => {
    const comment = body(m, text);
    await github.editComment(id, comment);
    return result(m, comment);
  };
  const earlier = (await state()).filter((e) => e.id < id);
  const first = earlier.find(covers);
  if (first) return finish({ ...base, outcome: "duplicate" }, duplicateText(norm, target.id, first.issue));
  if (fetched(earlier) >= perDay) return finish({ ...base, outcome: "limited" }, limitedText(perDay));

  try {
    // The recheck: the norm rebuilt from fresh pages, as the daily job builds it (redacted before anything reads them).
    const manifest = manifests.find((m) => m.key === norm)!;
    const source = recording(redacting(input.source));
    let fresh: Dataset;
    try {
      fresh = await build({ manifests: [manifest], source, datasetVersion: today, today });
    } catch (error) {
      if (source.unavailable().length) return await finish({ ...base, outcome: "unreachable" }, unreachableText(norm, target.id));
      throw error;
    }

    const ids = [...new Set([...previous.provisions, ...fresh.provisions].filter((p) => p.norm === norm && inTarget(target.id, p.id)).map((p) => p.id))];
    const before = new Map(previous.provisions.filter((p) => p.norm === norm).map((p) => [p.id, p]));
    const after = new Map(fresh.provisions.map((p) => [p.id, p]));
    const compared: Compared[] = ids.map((id) => ({ id, before: before.get(id), after: after.get(id) }));
    const differing = compared.filter(({ before: b, after: a }) => !b || !a || b.text !== a.text || b.status !== a.status);
    const version = previous.provisions[0]?.provenance.datasetVersion ?? "?";
    const links = linksLine(manifest, norm, target.id);

    if (!differing.length) {
      const answer = await finish({ ...base, outcome: "not-confirmed" }, notConfirmedText(norm, target.id, version, compared, links));
      // The recheck reads the page with the parser that built the dataset, so it cannot see that parser's own errors:
      // the report goes to the maintainer's triage queue. A missing label must not lose the answer already posted.
      await github.labelIssue(n, TRIAGE_LABEL).catch((error: unknown) => console.error(`recheck: could not label issue #${n} ${TRIAGE_LABEL}: ${(error as Error).message}`));
      return answer;
    }
    const answer = await finish({ ...base, outcome: "confirmed" }, confirmedText(norm, target.id, version, differing, links));
    // The correction is the daily job's: a forced rebuild, its three-layer review and its one PR.
    if (input.publishWorkflow) await github.dispatchWorkflow(input.publishWorkflow, { rebuild: "true" });
    return answer;
  } catch (error) {
    // A crash frees the slot's dispositivo (a `failed` recheck blocks nothing) but still counts against the day's cap.
    await finish({ ...base, outcome: "failed" }, failedText(norm, target.id));
    throw error;
  }
}

/** Outcomes that hold a dispositivo's slot for the day. */
const BLOCKING = new Set(["claimed", "confirmed", "not-confirmed"]);
/** Outcomes of a recheck that fetched the sources (or set out to), counted against the daily cap. */
const COUNTED = new Set(["claimed", "confirmed", "not-confirmed", "unreachable", "failed"]);

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

/**
 * Where the rebuilt wording comes from: Planalto's page, or (ADR 0003) a deferred change the build applied because its
 * start date has come, which the page does not print yet.
 */
function rebuiltLabel(before: Provision | undefined, after: Provision): string {
  const promoted = after.amendments.find((a) => a.effectiveFrom && !before?.amendments.some((b) => b.effectiveFrom === a.effectiveFrom && b.annotation === a.annotation));
  if (!promoted) return `- Planalto, lido agora / read now (${after.provenance.retrievedAt})`;
  const act = promoted.act?.citation ?? promoted.annotation;
  return `- Em vigor desde / In force since ${promoted.effectiveFrom}, pela / by ${act} (vigência diferida: a página do Planalto ainda não mostra esta redação; o Akoma a aplica na data de início / deferred vigência: Planalto's page does not print this wording yet; Akoma applies it on its start date)`;
}

/** Changes an act has made that take effect later (ADR 0003): the likeliest answer to "the text should already say X". */
function pendingLines(p: Provision): string[] {
  return (p.pending ?? []).map(
    (c) =>
      `- Mudança pendente / Pending change (${c.effect}), a partir de / from ${c.effectiveFrom}, ${c.act.citation}${c.note ? ` (${c.note})` : ""}${c.text ? `:\n\n${fenced(c.text)}` : "."}`,
  );
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
      after ? `${rebuiltLabel(before, after)}, ${STATUS[after.status]}:\n\n${wording(after)}` : "- Planalto, lido agora / read now: _(a página não traz mais este dispositivo / the page no longer has this dispositivo)_",
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
    [
      heading(norm, p),
      "",
      `- Dataset publicado e Planalto / Published dataset and Planalto, ${STATUS[p.status]}:\n\n${wording(p)}`,
      "",
      ...pendingLines(p).flatMap((l) => [l, ""]),
      secondaryLine(p.provenance.secondary),
    ].join("\n"),
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
    `PT: A página do Planalto, lida agora, imprime o mesmo texto que o dataset publicado (versão ${version}), então nenhum PR é aberto. Abaixo, o que cada fonte diz. A reconferência lê a página do Planalto com o mesmo leitor que montou o dataset, então um erro de leitura do próprio Akoma apareceria igual nos dois lados e não pode ser visto aqui. Por isso esta issue agora tem o rótulo \`needs-triage\`: o mantenedor vai revisar o relato; o campo "O que parece errado" é para ele.`,
    "",
    `EN: Planalto's page, read just now, prints the same text as the published dataset (version ${version}), so no PR is opened. Below is what each source says. The recheck reads Planalto's page with the same parser that built the dataset, so an error in Akoma's own reading would look the same on both sides and cannot be seen here. That is why this issue now has the \`needs-triage\` label: a maintainer will review the report; the "What looks wrong" field is for them.`,
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

function claimText(norm: string, id: string): string {
  return `**Reconferindo / Rechecking** · ${code(norm, id)}\n\nPT: Lendo de novo as fontes oficiais; este comentário vai trazer o resultado. / EN: Reading the official sources again; this comment will hold the result.`;
}

function failedText(norm: string, id: string): string {
  return `**A reconferência falhou / The recheck failed** · ${code(norm, id)}\n\nPT: Um erro interrompeu a reconferência; o mantenedor vê o registro da execução. Edite a issue mais tarde para tentar de novo. / EN: An error stopped the recheck; the maintainer sees the run's log. Edit the issue later to try again.`;
}

function unreachableText(norm: string, id: string): string {
  return `**Fonte inacessível / Source unreachable** · ${code(norm, id)}\n\nPT: Não foi possível ler as páginas oficiais agora, então nada foi reconferido. Edite a issue mais tarde para tentar de novo. / EN: The official pages could not be read just now, so nothing was rechecked. Edit the issue later to try again.`;
}

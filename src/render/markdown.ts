// A dispositivo as Markdown: one line as the page prints it, then its pending wordings. Shared by the published
// mirrors (src/pipeline/files.ts) and the API and MCP answers (src/worker/), so both show exactly the same text.
import type { PendingChange, Provision } from "../schema/dataset.ts";

/**
 * A dispositivo's line, then a quoted line per pending change, with the act's vigência clause for it, so a reader sees
 * which change waits for which date: "> **Pendente a partir de 2026-12-17** (Emenda Constitucional nº 141, de 2026;
 * cláusula de vigência: "após decorridos 2 (dois) meses …"): …".
 */
export function lines(provision: Provision): string[] {
  return [line(provision), ...(provision.pending ?? []).map(pendingLine)];
}

function pendingLine(entry: PendingChange): string {
  const shown = entry.effect === "revoked" ? "(Revogado)" : escape(entry.text ?? "");
  const note = entry.note ? ` *${escape(entry.note)}*` : "";
  return `> **Pendente a partir de ${entry.effectiveFrom}** (${entry.act.citation}; cláusula de vigência: "${escape(entry.vigencia)}"): ${shown}${note}`;
}

const MARKER: Partial<Record<Provision["status"], string>> = {
  vetoed: "(Vetado)",
  revoked: "(Revogado)",
  not_yet_in_force: "(Ainda não vigente)",
};

/** One dispositivo as printed: "Art. 5º …", "§ 1º …", "Parágrafo único. …", "X - …", "a) …", "1) …". */
export function line(provision: Provision): string {
  const label = printedLabel(provision);
  const shown = provision.text || MARKER[provision.status] || "";
  const notes = [...provision.amendments.map((a) => a.annotation), ...provision.references.map((r) => r.annotation)];
  const annotations = notes.length ? ` ${notes.map((n) => `*(${n})*`).join(" ")}` : "";
  // A renumbered dispositivo has no wording left: its label is followed by the note alone.
  return `${[label, escape(shown)].filter(Boolean).join(" ")}${annotations}`.trim();
}

function printedLabel(provision: Provision): string {
  const { kind, label } = provision;
  if (kind === "caput") return `**${provision.path.at(-2)!.label}**`;
  if (kind === "paragrafo") return label === "parágrafo único" ? "Parágrafo único." : label;
  if (kind === "inciso") return `${label.replace(/^inciso /, "")} -`;
  if (kind === "alinea") return `${label.replace(/^alínea /, "")})`;
  return `${label.replace(/^item /, "")})`;
}

/** Keeps legal text from turning into Markdown syntax ("*" or "_" emphasis, inline code, HTML). */
export function escape(text: string): string {
  return text.replace(/([\\*_`<])/g, "\\$1");
}

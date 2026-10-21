// LexML Parte 3 ids, derived one way everywhere: the primary's parser (src/pipeline/planalto.ts), the amending acts'
// commands (acts.ts) and the secondary sources' readers (src/review/normas.ts, legin.ts) all build a dispositivo's id
// from its printed labels with these functions, which is what lets review layer 2 match a secondary's dispositivo to
// the primary's by label (ADR 0004 §1).
import type { PathSegment } from "./dataset.ts";

/** LexML letter suffixes: "-A-B" → "-1-2" (either case: some sources print "-a"). */
export function suffixId(suffix: string): string {
  return suffix.replace(/-([A-Za-z])/g, (_, letter: string) => `-${letter.toUpperCase().charCodeAt(0) - 64}`);
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** "XV" → 15; `undefined` when it is not a numeral of these letters. */
export function romanToNumber(numeral: string): number | undefined {
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const value = ROMAN[numeral[i]!];
    if (value === undefined) return undefined;
    const next = ROMAN[numeral[i + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : undefined;
}

/** "Art. 103-A" → art103-1. */
export const articleId = (n: number | string, suffix: string) => `art${Number(n)}${suffixId(suffix)}`;
/** "§ 4º-B" → par4-2; "Parágrafo único" is par1. */
export const paragraphId = (n: number | string, suffix: string) => `par${Number(n)}${suffixId(suffix)}`;
/** "XV-A" → inc15-1; `undefined` for a numeral that is none. */
export const incisoId = (numeral: string, suffix: string) => {
  const n = romanToNumber(numeral);
  return n === undefined ? undefined : `inc${n}${suffixId(suffix)}`;
};
/** "b)" → ali2. */
export const alineaId = (letter: string, suffix: string) => `ali${letter.toLowerCase().charCodeAt(0) - 96}${suffixId(suffix)}`;
/** "3)" → ite3. */
export const itemId = (n: number | string, suffix: string) => `ite${Number(n)}${suffixId(suffix)}`;

/** The article a dispositivo belongs to: the id's first segment ("art5_cpt_inc10" → "art5"). */
export function articleOf(id: string): string {
  return id.split("_")[0]!;
}

/** A path as one line: "Título II › Capítulo I › Art. 5º › inciso X". */
export function pathLabel(path: PathSegment[]): string {
  return path.map((s) => s.label).join(" › ");
}

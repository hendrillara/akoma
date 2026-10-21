// What review layer 2 reads from a secondary source: its dispositivos, keyed by the id the primary would give them.
import type { ActType } from "../schema/dataset.ts";

export interface SecondaryDispositivo {
  /** LexML Parte 3 id derived from the printed labels along its path, the way the primary's parser derives its own. */
  id: string;
  /** The source's own id, when it has one and it differs from `id` (normas.leg.br never renumbers its fragments). */
  alias?: string;
  /** The wording in the source as served (inline markup and entities included); compared only after normalisation. */
  text: string;
  status: "in_force" | "revoked" | "vetoed";
  /** Keys (see `actKey`) of the amending acts the source records for this dispositivo or any dispositivo above it. */
  acts: Set<string>;
  /** Every wording the source has kept, oldest first, with the act behind each (normas.leg.br only). */
  history?: { text: string; act?: string }[];
}

/** One amending act, whatever the source calls it: "emenda_constitucional:136", "lei:14181", "medida_provisoria:1890-67". */
export function actKey(type: ActType, number: string): string {
  return `${type}:${number.replace(/\./g, "")}`;
}

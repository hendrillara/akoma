// Ato das Disposições Constitucionais Transitórias: a separate norm in LexML, printed after the CF on its compiled page.
import type { NormManifest } from "../pipeline/build.ts";
import { cf } from "./cf.ts";

export const adct: NormManifest = {
  key: "adct",
  urn: "urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988",
  title: "Ato das Disposições Constitucionais Transitórias",
  primaryUrl: cf.primaryUrl,
  startAnchor: "adct",
};

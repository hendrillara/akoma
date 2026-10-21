// Ato das Disposições Constitucionais Transitórias: a separate norm in LexML, printed after the CF on its compiled page.
import type { NormManifest } from "../pipeline/build.ts";
import { cf, emc } from "./cf.ts";

export const adct: NormManifest = {
  key: "adct",
  urn: "urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988",
  title: "Ato das Disposições Constitucionais Transitórias",
  primaryUrl: cf.primaryUrl,
  startAnchor: "adct",
  citedAs: "Ato das Disposições Constitucionais Transitórias",
  // EC 132/2023 art. 5 and art. 22 II "b" (2033). ADR 0002.
  deferredActs: [emc(132)],
};

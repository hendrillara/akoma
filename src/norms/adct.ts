// Ato das Disposições Constitucionais Transitórias: a separate norm in LexML, printed after the CF on its compiled page.
import type { NormManifest } from "../pipeline/build.ts";
import { cf } from "./cf.ts";

export const adct: NormManifest = {
  key: "adct",
  urn: "urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988",
  type: "ato.disposicoes.constitucionais.transitorias",
  date: "1988-10-05",
  title: "Ato das Disposições Constitucionais Transitórias",
  primaryUrl: cf.primaryUrl,
  startAnchor: "adct",
  secondarySources: [
    {
      name: "normas.leg.br",
      url: "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988&tipo_documento=maior-detalhe",
      granularity: "dispositivo",
      verified: {
        on: "2026-10-20",
        usable: true,
        note: "Articulated JSON-LD, its own document and URN (docs/research/2026-10-20-sources.md). CC BY 4.0: compare only, never republish.",
      },
    },
  ],
  knownQuirks: ["Printed on the CF's page after the anchor named \"adct\"", "Article labels carry ordinal and period (\"Art. 1º.\")"],
};

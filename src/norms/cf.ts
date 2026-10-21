// Constituição Federal de 1988: Planalto's compiled page, whose ADCT (a separate norm) follows the main text.
import type { NormManifest } from "../pipeline/build.ts";

export const emc = (n: number) => `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc${n}.htm`;

export const cf: NormManifest = {
  key: "cf",
  urn: "urn:lex:br:federal:constituicao:1988-10-05;1988",
  type: "constituicao",
  date: "1988-10-05",
  title: "Constituição da República Federativa do Brasil de 1988",
  primaryUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm",
  endAnchor: "adct",
  secondarySources: [
    {
      name: "normas.leg.br",
      url: "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:constituicao:1988-10-05;1988&tipo_documento=maior-detalhe",
      granularity: "dispositivo",
      verified: {
        on: "2026-10-20",
        usable: true,
        note: "Articulated JSON-LD, current to EC 141/2026, but it mislabels EC 141's deferred vigência (docs/research/2026-10-20-sources.md). CC BY 4.0: compare only, never republish.",
      },
    },
  ],
  knownQuirks: [
    "Inconsistent anchors; the ADCT starts at the anchor named \"adct\" on the same page",
    "66 incisos without the \" - \" separator (\"IV as ilhas fluviais…\")",
    "Art. 215 §§ 2º and 3º printed without the \"§\"",
    "Grouped revocations (\"§§ 1º a 3º. (Revogados …)\", \"Art. 117. e Parágrafo único.\")",
    "Struck text mid-sentence leaves doubled punctuation (art. 100 § 11)",
  ],
  citedAs: "Constituição Federal",
  // EC 132/2023 arts. 22–23 (2027 and 2033 phases of the tax reform); EC 141/2026 art. 10 I (art. 7º XV). ADR 0003.
  deferredActs: [emc(132), emc(141)],
};

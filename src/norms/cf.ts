// Constituição Federal de 1988: Planalto's compiled page, whose ADCT (a separate norm) follows the main text.
import type { NormManifest } from "../pipeline/build.ts";

const emc = (n: number) => `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc${n}.htm`;

export const cf: NormManifest = {
  key: "cf",
  urn: "urn:lex:br:federal:constituicao:1988-10-05;1988",
  title: "Constituição da República Federativa do Brasil de 1988",
  primaryUrl: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm",
  endAnchor: "adct",
  citedAs: "Constituição Federal",
  // EC 141/2026 art. 10 I (art. 7º XV, two months after publication). EC 132/2023 is added with its fixture.
  deferredActs: [emc(141)],
};

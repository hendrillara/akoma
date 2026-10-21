// Código de Defesa do Consumidor (Lei 8.078/1990): Planalto's compiled page. No CDC-specific code: every quirk below
// is handled by the generic parser and backed by the CDC golden set (test/cdc.test.ts).
import type { NormManifest } from "../pipeline/build.ts";

export const cdc: NormManifest = {
  key: "cdc",
  urn: "urn:lex:br:federal:lei:1990-09-11;8078",
  type: "lei",
  date: "1990-09-11",
  title: "Código de Defesa do Consumidor (Lei nº 8.078, de 11 de setembro de 1990)",
  primaryUrl: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
  secondarySources: [
    {
      name: "camara-legin",
      url: "https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html",
      granularity: "article",
      verified: {
        on: "2026-10-21",
        usable: true,
        note: "Compiled text current to MP 1.393/2026, like Planalto; not articulated, so compared per article. Known divergences (annotation style, vetoed-in-amending-law items, a few wording differences, one duplicated phrase) are listed in ADR 0002.",
      },
    },
  ],
  knownQuirks: [
    "No anchors at all: the text is found by its labels only",
    "Ordinal chaos: \"Art. 1°\" with a degree sign, \"Art. 4º\", \"§ 3o\" with a letter o, \"§ 1<s>º</s>\" (art. 8º §§ 1º–2º: the ordinal inside <s> is cut as struck text, harmless because labels are rebuilt from the number)",
    "\"SEÇÃO I\" headings in upper case; \"CAPÍTULO VI-A\"",
    "(Vetado) / (VETADO) marks instead of revocations, some on dispositivos an amending law inserted",
    "\"Pena\" lines (arts. 63–74), with or without a dash, that belong to the dispositivo above them",
    "Arts. 110–117 quote the Lei 7.347/1985 dispositivos they amend, straight or curly quotes, one quote over three lines",
    "Art. 39 XI kept only as a note that its content became inciso XIII",
    "Defective annotations: \"Redação dada pela nº 11.785, de 2008\" (no act type), dates such as \"1º.8.1996\", \"MPV nº 1.890-67\"",
    "Art. 57 §§ 1º–2º reworded by a Medida Provisória (MP 1.393/2026)",
  ],
};

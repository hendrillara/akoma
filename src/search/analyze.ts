// Text analysis for search, shared by the build (indexing dispositivos) and the Worker (analysing queries): both must
// turn text into the same terms. Changing anything here changes the terms, so bump ANALYZER with it; the Worker
// refuses an index built under another name.

export const ANALYZER = "pt-fold-plural-1";

/**
 * Lower case, accents and ordinal marks folded ("Exercício" → "exercicio", "cinqüenta" → "cinquenta", "5º" → "5"),
 * split on anything that is not a letter or digit, stopwords dropped, plurals reduced to the singular.
 */
export function analyze(text: string): string[] {
  const terms: string[] = [];
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    if (word && !STOPWORDS.has(word)) terms.push(singular(word));
  }
  return terms;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[ºª°]/g, "").toLowerCase();
}

/**
 * Portuguese plural → singular by its regular endings ("ações" → "acao", "órgãos" → "orgao", "sociais" → "social",
 * "invioláveis" → "inviolavel", "civis" → "civil", "leis" → "lei", "mulheres" → "mulher", "juízes" → "juiz", "bens" →
 * "bem", "direitos" → "direito"). A singular in "-re" loses its "e" so it meets its plural ("livre", "livres" → "livr").
 * Nothing else is stripped: gender and verb endings stay, since cutting them conflates words the law keeps apart
 * ("casa"/"caso", "mora"/"moro").
 */
function singular(word: string): string {
  if (word.length < 4 || /\d/.test(word)) return word;
  if (/[oa]es$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (/eis$/.test(word) && word.length === 4) return word.slice(0, -1);
  if (/[aeo]is$/.test(word) && word.length > 4) return `${word.slice(0, -2)}l`;
  if (/[^aeiou]is$/.test(word)) return `${word.slice(0, -2)}il`;
  if (/[rz]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("re")) return word.slice(0, -1);
  if (word.endsWith("ns")) return `${word.slice(0, -2)}m`;
  if (/[^iu]s$/.test(word)) return word.slice(0, -1);
  return word;
}

// Function words, after folding. Negations ("nao", "sem") stay: they are rare enough in a query to matter.
const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de do da dos das d em no na nos nas num numa por pelo pela pelos pelas para pra pro " +
    "com e ou que se ao aos lhe lhes me mim te ti eu tu ele ela eles elas voce voces nos vos meu minha meus minhas " +
    "seu sua seus suas teu tua nosso nossa este esta estes estas esse essa esses essas isto isso aquele aquela aquilo " +
    "qual quais quando como quem onde quanto quanta quantos quantas cujo cuja ja tambem mais muito ser sao foi era " +
    "esta estao ha tem tenho posso pode podem devo deve sobre entre ate apos"
  ).split(" "),
);

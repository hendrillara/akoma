// Derives the refresh scenario fixtures from the recorded compiled CF page (see README.md). Run from the repo root:
//   node test/fixtures/refresh/make.mjs
// The page is read and written as latin1, which round-trips windows-1252 bytes exactly; every inserted string is
// checked to hold only characters that are the same byte in both encodings.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const base = new URL("../../../fixtures/2026-10-20/planalto/constituicaocompilado.htm", import.meta.url);
const url = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm";
const original = readFileSync(base, "latin1");

/** Replaces `find`, which must occur exactly once, with `replace`. */
function edit(page, find, replace) {
  const count = page.split(find).length - 1;
  if (count !== 1) throw new Error(`expected exactly one ${JSON.stringify(find.slice(0, 60))}, found ${count}`);
  if (/[^\x00-\x7f\xa0-\xff]/.test(replace)) throw new Error(`not a windows-1252/latin1 common byte: ${replace}`);
  return page.replace(find, () => replace);
}

/** The token Planalto's F5 WAF injects into every response (`f5_p:'…'`), replaced by another of the same length. */
function newF5Token(page, transform) {
  const token = /f5_p:'([A-P]+)'/.exec(page)[1];
  return edit(page, `f5_p:'${token}'`, `f5_p:'${transform(token)}'`);
}

/** Planalto's ETag starts with the size of the file it serves in hex: the bytes before the injected F5 script. */
function etagSize(page) {
  return page.indexOf('<script id="f5_cspm">').toString(16);
}

/** Replaces the one match of `pattern` (whitespace-tolerant finds for multi-line HTML) with `replace`. */
function editRe(page, pattern, replace) {
  const count = [...page.matchAll(new RegExp(pattern.source, "g"))].length;
  if (count !== 1) throw new Error(`expected exactly one ${pattern}, found ${count}`);
  if (/[^\x00-\x7f\xa0-\xff]/.test(replace)) throw new Error(`not a windows-1252/latin1 common byte: ${replace}`);
  return page.replace(pattern, () => replace);
}

const compiledUrl = url;
const emcUrl = (n) => `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc${n}.htm`;

/** Writes a folder's files and its index.json; `files` are `{ file, url, page, headers }`, the CF page first. */
function write(folder, files, retrievedAt) {
  mkdirSync(new URL(`${folder}/`, here), { recursive: true });
  const snapshots = files.map(({ file, url, page, headers }) => {
    const bytes = Buffer.from(page, "latin1");
    if (/[^\x00-\x7f\xa0-\xff]/.test(page)) throw new Error(`${folder}/${file}: not a windows-1252/latin1 common byte`);
    writeFileSync(new URL(`${folder}/${file}`, here), bytes);
    return {
      file,
      url,
      encoding: "windows-1252",
      headers,
      retrievedAt,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
  });
  const index = { capturedOn: retrievedAt.slice(0, 10), snapshots };
  writeFileSync(new URL(`${folder}/index.json`, here), `${JSON.stringify(index, null, 2)}\n`);
}

/** The compiled CF page under its real URL. */
const cfPage = (page, headers) => ({ file: "page.htm", url: compiledUrl, page, headers });

// --- etag-only: the same page served again with new headers and a new WAF token ------------------------------
{
  const page = newF5Token(original, (token) => [...token].reverse().join(""));
  write(
    "etag-only",
    [cfPage(page, { etag: `"${etagSize(page)}-65e4f0a1b2c3d"`, "last-modified": "Wed, 21 Oct 2026 16:20:10 GMT" })],
    "2026-10-22T01:30:00Z",
  );
}

// --- emc142.htm: the simulated act's own page, laid out like Planalto's EC pages (emc141.htm) --------------------
// Its commands target exactly the dispositivos the ec142 page changes, from the articles its annotations link to.
const para = (html) =>
  `<p class="MsoNormal" style="text-indent: 38px; line-height: normal; margin-bottom: 15px; background: white; margin-top:15px" align="justify">\r\n<font face="Arial" size="2">${html}</font></p>\r\n`;
const quoted = (lines) => `<blockquote>\r\n\t<blockquote>\r\n${lines.map(para).join("")}\t</blockquote>\r\n</blockquote>\r\n`;
const dots = ".............................................................................................";
const emc142 = [
  "<html>\r\n",
  "<!-- Akoma test scenario: a simulated EC 142, written by test/fixtures/refresh/make.mjs. Not an official text. -->\r\n",
  "<head>\r\n<title>Emenda Constitucional nº 142</title>\r\n</head>\r\n<body>\r\n",
  '<p align="center"><font face="Arial" size="2" color="#000080"><strong>EMENDA CONSTITUCIONAL Nº 142, DE 22 DE OUTUBRO DE 2026</strong></font></p>\r\n',
  '<p align="justify"><font size="2" face="Arial" color="#800000">Altera os arts. 6º e 7º da Constituição Federal para incluir o cuidado entre os direitos sociais.</font></p>\r\n',
  para("As Mesas da Câmara dos Deputados e do Senado Federal, nos termos do § 3º do art. 60 da Constituição Federal, promulgam a seguinte Emenda ao texto constitucional:"),
  para('<a name="art1"></a>Art. 1º O art. 6º da <a href="../../constituicao.htm">Constituição Federal</a> passa a vigorar com as seguintes alterações, numerado o parágrafo único como § 1º:'),
  quoted([
    "&quot;Art. 6º São direitos sociais a educação, a saúde, a alimentação, o trabalho, a moradia, o transporte, o lazer, a segurança, a previdência social, a proteção à maternidade e à infância, a assistência aos desamparados e o cuidado, na forma desta Constituição.",
    `§ 1º ${dots}`,
    "§ 2º O cuidado é direito de todos e dever do Estado, da família e da sociedade, na forma da lei.&quot; (NR)",
  ]),
  para('<a name="art2"></a>Art. 2º O inciso XIV do <b>caput</b> do art. 7º da <a href="../../constituicao.htm">Constituição Federal</a> passa a vigorar com a seguinte redação:'),
  quoted([`&quot;Art. 7º ${dots}`, dots, "XIV - (revogado);", `${dots}&quot; (NR)`]),
  para('<a name="art3"></a>Art. 3º Revoga-se o inciso XXVII do <b>caput</b> do art. 7º da Constituição Federal.'),
  para('<a name="art4"></a>Art. 4º Esta Emenda Constitucional entra em vigor na data de sua publicação.'),
  para("Brasília, 22 de outubro de 2026."),
  para("Este texto não substitui o publicado no DOU 22.10.2026"),
  "</body>\r\n</html>\r\n",
].join("");

// --- ec142: a simulated Emenda Constitucional nº 142, de 2026 -----------------------------------------------
{
  const ec142 = (art) => `emendas/emc/emc142.htm#art${art}`;
  let page = edit(
    original,
    "<html>",
    "<html>\r\n<!-- Akoma test scenario: simulated EC 142, edited by test/fixtures/refresh/make.mjs. Not an official text. -->",
  );
  // 1. Art. 6º caput: new wording.
  page = edit(
    page,
    'a assistência aos \r\ndesamparados, na forma desta Constituição.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\r\n<a href="Emendas/Emc/emc90.htm">(Redação dada pela Emenda Constitucional nº 90, \r\nde 2015)</a>',
    `a assistência aos \r\ndesamparados e o cuidado, na forma desta Constituição.&nbsp;&nbsp;&nbsp;\r\n<a href="${ec142(1)}">(Redação dada pela Emenda Constitucional nº 142, \r\nde 2026)</a>`,
  );
  // 2. Art. 6º parágrafo único renumbered as § 1º, same wording.
  page = edit(page, "Parágrafo único. Todo brasileiro em situação de", "§ 1º Todo brasileiro em situação de");
  page = edit(
    page,
    '<a href="../_Ato2023-2026/2023/Lei/L14601.htm">(Vide Lei nº 14.601, de 2023)</a></span></font></p>\r\n',
    '<a href="../_Ato2023-2026/2023/Lei/L14601.htm">(Vide Lei nº 14.601, de 2023)</a></span>&nbsp;\r\n' +
      `\t<a href="${ec142(1)}">(Renumerado do parágrafo único, pela Emenda Constitucional nº 142, de 2026)</a></font></p>\r\n` +
      // 3. Art. 6º § 2º inserted.
      '<p ALIGN="JUSTIFY" style="text-indent: 38px">\r\n' +
      '    <font size="2" face="Arial">§ 2º O cuidado é direito de todos e dever do Estado, da família e da \r\n' +
      `\tsociedade, na forma da lei.&nbsp;&nbsp;&nbsp;\r\n\t<a href="${ec142(1)}">(Incluído pela Emenda Constitucional nº 142, de 2026)</a></font></p>\r\n`,
  );
  // 4. Art. 7º XIV revoked by a new wording that reads "(revogado);".
  page = edit(
    page,
    "XIV - jornada de seis horas para o trabalho realizado em turnos ininterruptos\r\nde revezamento, salvo negociação coletiva; </font></p>",
    `XIV - (revogado);&nbsp;&nbsp;&nbsp;\r\n<a href="${ec142(2)}">(Redação dada pela Emenda Constitucional nº 142, de 2026)</a></font></p>`,
  );
  // 5. Art. 7º XVIII: same wording, a new "Vide ADI" note.
  page = edit(
    page,
    "duração de cento e vinte dias; </font></p>",
    "duração de cento e vinte dias; (Vide ADI 9999)</font></p>",
  );
  // 6. Art. 7º XXVII revoked by a "(Revogado pela …)" annotation alone.
  page = edit(
    page,
    "XXVII - proteção em face da automação, na forma da lei; </font></p>",
    `XXVII - <a href="${ec142(3)}">(Revogado pela Emenda Constitucional nº 142, de 2026)</a></font></p>`,
  );
  page = newF5Token(page, (token) => token.replace(/[A-P]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 64) % 16) + 65)));
  const act = { file: "emc142.htm", url: emcUrl(142), page: emc142, headers: {} };
  write(
    "ec142",
    [cfPage(page, { etag: `"${etagSize(page)}-65e6b2c3d4e5f"`, "last-modified": "Thu, 22 Oct 2026 16:20:05 GMT" }), act],
    "2026-10-23T01:30:00Z",
  );

  // --- ec142-faults: the ec142 page with four faults the review gates must stop --------------------------------
  // F1. Art. 7º XVI: new wording annotated with EC 142, which does not target it.
  let faulty = edit(page, "no mínimo, em\r\ncinqüenta por cento à do normal;", "no mínimo, em\r\nsetenta por cento à do normal;");
  faulty = edit(
    faulty,
    "5.452, art. 59 § 1º)</a></font></p>",
    `5.452, art. 59 § 1º)</a>&nbsp;\r\n<a href="${ec142(2)}">(Redação dada pela Emenda Constitucional nº 142, de 2026)</a></font></p>`,
  );
  // F2. Art. 7º XXXIV vanishes: its paragraph is gone, with no revocation mark.
  faulty = edit(
    faulty,
    '<p ALIGN="JUSTIFY" style="text-indent: 38px"><font\r\nface="Arial">XXXIV - igualdade de direitos entre o trabalhador com vínculo empregatício\r\npermanente e o trabalhador avulso.</font></p>\r\n',
    "",
  );
  // F3. Art. 1º incisos I and II swapped: no record changes, but the siblings are out of order.
  faulty = edit(
    faulty,
    'face="Arial">I - a soberania;</font></p>\r\n\r\n<p ALIGN="JUSTIFY" style="text-indent: 38px"><font\r\nface="Arial">II - a cidadania;</font></p>',
    'face="Arial">II - a cidadania;</font></p>\r\n\r\n<p ALIGN="JUSTIFY" style="text-indent: 38px"><font\r\nface="Arial">I - a soberania;</font></p>',
  );
  // F4. Art. 7º XXVII left as it was: EC 142 art. 3 revokes it, but the page does not show the revocation.
  faulty = edit(
    faulty,
    `XXVII - <a href="${ec142(3)}">(Revogado pela Emenda Constitucional nº 142, de 2026)</a></font></p>`,
    "XXVII - proteção em face da automação, na forma da lei; </font></p>",
  );
  faulty = newF5Token(faulty, (token) => [...token].reverse().join(""));
  write(
    "ec142-faults",
    [cfPage(faulty, { etag: `"${etagSize(faulty)}-65e6b2c3d4e60"`, "last-modified": "Thu, 22 Oct 2026 16:20:06 GMT" }), act],
    "2026-10-23T01:30:00Z",
  );
}

// --- before-ec140-141: the compiled page as it read before EC 140 and EC 141 (both of 16.10.2026) ------------
// Every old wording is the one struck on the full-history page (fixtures/2026-10-20/planalto/constituicao.htm).
{
  let page = edit(
    original,
    "<html>",
    "<html>\r\n<!-- Akoma test scenario: the CF before EC 140 and EC 141, edited by test/fixtures/refresh/make.mjs. Not an official text. -->",
  );
  // EC 140, art. 40 § 4º: the EC 103 wording.
  page = editRe(
    page,
    /ressalvado o disposto nos §§ 4º-A, 4º-B, 4º-C, 5º e 5º-A deste artigo\.<\/font>[\s\S]*?<\/p>/,
    'ressalvado o disposto nos §§ 4º-A, 4º-B, 4º-C e 5º.</font>&nbsp;&nbsp;&nbsp;\r\n\t<a href="Emendas/Emc/emc103.htm#art1">(Redação dada pela Emenda \r\n\tConstitucional nº 103, de 2019)</a></p>',
  );
  // EC 140, art. 40 § 5º-A, art. 198 IV, §§ 4º-A and 4º-B, art. 201 § 8º-A: not yet inserted.
  page = editRe(page, /<p style="text-indent: 38px">\s*<font face="Arial" size="2">§ 5º-A\. O requisito[\s\S]*?<\/p>\r\n/, "");
  page = editRe(page, /<p style="text-indent: 38px">\s*<font face="Arial" size="2">IV - atuação obrigatória e permanente[\s\S]*?<\/p>\r\n/, "");
  page = editRe(page, /<p class="MsoNormal"[^>]*>§ 4º-A\. É vedada a contratação temporária[\s\S]*?<\/p>\r\n<p class="MsoNormal"[^>]*>§ 4º-B\. Os agentes de que trata[\s\S]*?<\/p>\r\n/, "");
  page = editRe(page, /<p style="text-indent: 38px">\s*<font face="Arial" size="2">§ 8º-A\. O requisito de idade[\s\S]*?<\/p>\r\n/, "");
  // EC 140, art. 198 § 10: the EC 120 wording.
  page = editRe(
    page,
    /§ 10\. Os agentes comunitários de saúde e os agentes \r\nde combate às endemias terão, em razão[\s\S]*?<\/p>/,
    "§ 10. Os agentes comunitários de saúde e os agentes de combate às \r\nendemias terão também, em razão dos riscos inerentes às funções \r\ndesempenhadas, aposentadoria especial e, somado aos seus vencimentos, \r\nadicional de insalubridade.&nbsp;&nbsp;&nbsp; </font>\r\n" +
      '<a href="Emendas/Emc/emc120.htm#art1">(Incluído pela Emenda Constitucional nº \r\n120, de 2022) </a></p>',
  );
  // EC 141, art. 7º XIII: the 1988 wording and its "Vide" note.
  page = editRe(
    page,
    /XIII - duração do trabalho normal não superior a 8 [\s\S]*?<\/p>/,
    "XIII - duração do trabalho normal não superior a oito horas diárias e \r\nquarenta e quatro semanais, facultada a compensação de horários e a redução \r\nda jornada, mediante acordo ou convenção coletiva de trabalho;&nbsp;&nbsp;\r\n" +
      '<a href="../Decreto-Lei/Del5452.htm#art478§2">(Vide Decreto-Lei nº 5.452, de 1943)</a></font></p>',
  );
  // EC 141, art. 7º XV: same wording, without the "Vide" EC 141 and "Vigência" notes.
  page = editRe(
    page,
    /XV - repouso semanal remunerado, preferencialmente aos domingos;&nbsp;[\s\S]*?<\/p>/,
    "XV - repouso semanal remunerado, preferencialmente aos domingos; </font></p>",
  );
  // EC 141, art. 7º § 1º: still the parágrafo único, with the EC 72 wording (the same text).
  page = editRe(
    page,
    /<font face="Arial" size="2">§ 1º <\/font><font face="Arial">São assegurados à [\s\S]*?<\/p>/,
    '<font face="Arial">Parágrafo único. São assegurados à categoria dos trabalhadores domésticos os \r\n' +
      "\tdireitos previstos nos incisos IV, VI, VII, VIII, X, XIII, XV, XVI, XVII, \r\n" +
      "\tXVIII, XIX, XXI, XXII, XXIV, XXVI, XXX, XXXI e XXXIII e, atendidas as \r\n" +
      "\tcondições estabelecidas em lei e observada a simplificação do cumprimento \r\n" +
      "\tdas obrigações tributárias, principais e acessórias, decorrentes da relação \r\n" +
      "\tde trabalho e suas peculiaridades, os previstos nos incisos I, II, III, IX, \r\n" +
      "\tXII, XXV e XXVIII, bem como a sua integração à previdência social.&nbsp;&nbsp;\r\n" +
      '\t<a href="Emendas/Emc/emc72.htm">(Redação dada pela Emenda Constitucional nº 72, de 2013)</a></font></p>',
  );
  // EC 141, art. 7º §§ 2º and 3º: not yet inserted.
  page = editRe(
    page,
    /<p class="MsoNormal"[^>]*>\r\n<font face="Arial" size="2">§ 2º Excepcionalmente[\s\S]*?<\/p>\r\n<p class="MsoNormal"[^>]*>\r\n<font face="Arial" size="2">§ 3º Lei poderá dispor[\s\S]*?<\/p>\r\n/,
    "",
  );
  page = newF5Token(page, (token) => token.replace(/[A-P]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 50) % 16) + 65)));
  write(
    "before-ec140-141",
    [cfPage(page, { etag: `"${etagSize(page)}-65e1a0b1c2d3e"`, "last-modified": "Tue, 13 Oct 2026 16:20:10 GMT" })],
    "2026-10-15T01:30:00Z",
  );
}


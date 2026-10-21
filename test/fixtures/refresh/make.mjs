// Derives the refresh scenario fixtures from the recorded compiled CF page (see README.md). Run from the repo root:
//   node test/fixtures/refresh/make.mjs
// The page is read and written as latin1, which round-trips windows-1252 bytes exactly; every inserted string is
// checked to hold only characters that are the same byte in both encodings.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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

function write(folder, page, headers, retrievedAt) {
  const bytes = Buffer.from(page, "latin1");
  writeFileSync(new URL(`${folder}/page.htm`, here), bytes);
  const index = {
    capturedOn: retrievedAt.slice(0, 10),
    snapshots: [
      {
        file: "page.htm",
        url,
        encoding: "windows-1252",
        headers,
        retrievedAt,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
    ],
  };
  writeFileSync(new URL(`${folder}/index.json`, here), `${JSON.stringify(index, null, 2)}\n`);
}

// --- etag-only: the same page served again with new headers and a new WAF token ------------------------------
{
  const page = newF5Token(original, (token) => [...token].reverse().join(""));
  write(
    "etag-only",
    page,
    { etag: `"${etagSize(page)}-65e4f0a1b2c3d"`, "last-modified": "Wed, 21 Oct 2026 16:20:10 GMT" },
    "2026-10-22T01:30:00Z",
  );
}

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
  write(
    "ec142",
    page,
    { etag: `"${etagSize(page)}-65e6b2c3d4e5f"`, "last-modified": "Thu, 22 Oct 2026 16:20:05 GMT" },
    "2026-10-23T01:30:00Z",
  );
}

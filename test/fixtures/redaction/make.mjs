// Derives the redaction scenario from the recorded LEGIN page (see README.md). Run from the repo root:
//   node test/fixtures/redaction/make.mjs
// The names planted here are invented placeholders; the recorded page's own author fields were redacted at capture.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const url = "https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html";
let page = readFileSync(new URL("../../../fixtures/2026-10-21/camara-legin/lei-8078-1990-normaatualizada-pl.html", import.meta.url), "latin1");

function edit(find, replace) {
  const count = page.split(find).length - 1;
  if (count !== 1) throw new Error(`expected exactly one ${JSON.stringify(find)}, found ${count}`);
  page = page.replace(find, () => replace);
}

// Attribute order reversed and the name in mixed case.
edit('<meta name="author" content="[redacted]"/>', '<meta content="Fulana de Tal" name="Author"/>');
// Upper-case tag, unquoted values, another attribute in between.
edit('<meta name="changedby" content="[redacted]"/>', "<META NAME=changedby data-origin=word CONTENT=Beltrano>");
// Office document properties, as Word writes them into HTML.
edit(
  "</head>",
  "<!--[if gte mso 9]><xml><o:DocumentProperties><o:Author>Fulana de Tal</o:Author><o:LastAuthor>Beltrano Sicrano</o:LastAuthor><o:Manager>Sicrano Beltrano</o:Manager></o:DocumentProperties></xml><![endif]-->\n</head>",
);
// Forms a list of person fields, or a regex over the markup, would miss (the redactor parses the page with parse5,
// the parser the build reads it with, and keeps only the charset metas):
edit(
  "</head>",
  [
    // a ">" inside a quoted value ends a naive `<meta[^>]*>` match before `content`;
    '<meta name="author" data-note="a>b" content="Mevio"/>',
    // an attribute name written with a character reference (HTML does not decode names);
    '<meta n&#97;me="author" content="Ticio"/>',
    // a property meta (Open Graph, RDFa) and a microdata one;
    '<meta property="article:author" content="Sempronio"/>',
    '<meta itemprop="editor" content="Sempronio"/>',
    // the same attribute twice: the parser keeps the first, the bytes keep both;
    '<meta name="description" content="CDC" content="Graco"/>',
    // a name in a plain HTML comment;
    "<!-- revisado por Tizio -->",
    // a bare Office XML block (not inside a conditional comment) with an element no list names.
    "<xml><o:DocumentProperties><o:Editor>Fulano</o:Editor><o:Category>Fulano</o:Category></o:DocumentProperties></xml>",
    "</head>",
  ].join("\n"),
);

const bytes = Buffer.from(page, "latin1");
writeFileSync(new URL("legin.html", here), bytes);
const index = {
  capturedOn: "2026-10-23",
  snapshots: [
    {
      file: "legin.html",
      url,
      encoding: "utf-8",
      headers: {},
      retrievedAt: "2026-10-23T01:30:00Z",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
  ],
};
writeFileSync(new URL("index.json", here), `${JSON.stringify(index, null, 2)}\n`);

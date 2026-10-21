// Derives the redaction scenario from the recorded LEGIN page (see README.md). Run from the repo root:
//   node test/fixtures/redaction/make.mjs
// The names planted here are invented placeholders; the recorded page's own metadata was redacted at capture.
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

// Every form is planted just before `</head>`, so every byte from `</head>` on is the recorded page's.
edit(
  "</head>",
  [
    // Attribute order reversed and the name in mixed case.
    '<meta content="Fulana de Tal" name="Author"/>',
    // Upper-case tag, unquoted values, another attribute in between.
    "<META NAME=changedby data-origin=word CONTENT=Beltrano>",
    // Office document properties, as Word writes them into HTML.
    "<!--[if gte mso 9]><xml><o:DocumentProperties><o:Author>Fulana de Tal</o:Author><o:LastAuthor>Beltrano Sicrano</o:LastAuthor><o:Manager>Sicrano Beltrano</o:Manager></o:DocumentProperties></xml><![endif]-->",
    // Forms a list of person fields, or a regex over the markup, would miss (the redactor parses the page with parse5,
    // the parser the build reads it with, and keeps only the charset declaration):
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
    // Raw text and RCDATA, where a tokenizer reads no tags: markup and names inside each such element.
    '<script>var autor = "Zutano";</script>',
    "<style>/* Zutano */ p { color: black }</style>",
    "<title>Zutano</title>",
    "<noscript><meta name=author content=Zutano></noscript>",
    "<noframes><!-- Zutano --></noframes>",
    '<textarea><meta name="author" content="Zutano"></textarea>',
    "<xmp><o:Author>Zutano</o:Author></xmp>",
    "<iframe>Zutano</iframe>",
    "<noembed>Zutano</noembed>",
    // A CDATA section, a downlevel-revealed conditional and a processing instruction: comments to an HTML parser.
    "<![CDATA[ Mengano ]]>",
    "<![if Mengano]>",
    "<?xml-stylesheet Mengano?>",
    // OOXML core properties and an Office property element, bare in the page.
    "<cp:coreProperties><dc:creator>Perengano</dc:creator><cp:lastModifiedBy>Perengano</cp:lastModifiedBy><dcterms:modified>2026-10-23</dcterms:modified></cp:coreProperties>",
    "<o:Author>Perengano</o:Author>",
    // Values a charset declaration must not carry, and a link that names someone.
    '<meta charset="Tertius"/>',
    '<meta http-equiv="Content-Type" content="Tertius/Quartus"/>',
    '<link rel="author" href="humans.txt" title="Quartus"/>',
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

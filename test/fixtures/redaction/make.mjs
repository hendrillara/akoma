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

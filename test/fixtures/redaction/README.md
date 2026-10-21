# Redaction scenario fixture

`legin.html` is the recorded Câmara LEGIN page of the CDC (`fixtures/2026-10-21/camara-legin/`, whose metadata was redacted at capture), served under its real URL, with personal data planted just before its `</head>` in every form below. `test/publish.test.ts` runs the daily job over it and checks that none of the planted names survives in anything the job writes (the capture, the dataset, the PR body, the issues and the run status), that the capture keeps only the charset declaration and blanks every other meta, every comment, every raw-text content and every Office block, and that every byte from `</head>` on is as served.

The planted forms, written by `make.mjs` (run `node test/fixtures/redaction/make.mjs` from the repo root):

1. `<meta content="Fulana de Tal" name="Author"/>`: attributes in reverse order, the name in mixed case.
2. `<META NAME=changedby data-origin=word CONTENT=Beltrano>`: upper case, unquoted values, another attribute in between.
3. An Office XML block inside a conditional comment before `</head>`, as Word writes one: `<o:Author>`, `<o:LastAuthor>` and `<o:Manager>` with invented names.
4. `<meta name="author" data-note="a>b" content="Mevio"/>`: a `>` inside a quoted value, which ends a `<meta[^>]*>` regex match before `content`.
5. `<meta n&#97;me="author" content="Ticio"/>`: an attribute name written with a character reference (HTML never decodes attribute names, so this is not a `name` attribute at all).
6. `<meta property="article:author" content="Sempronio"/>` and 7. `<meta itemprop="editor" content="Sempronio"/>`: Open Graph/RDFa and microdata metas, which a list of `name` values misses.
8. `<meta name="description" content="CDC" content="Graco"/>`: the same attribute twice; the parser keeps the first, the bytes keep both.
9. `<!-- revisado por Tizio -->`: a name in a plain HTML comment.
10. `<xml><o:DocumentProperties><o:Editor>Fulano</o:Editor><o:Category>Fulano</o:Category></o:DocumentProperties></xml>`: a bare Office XML block, outside any comment, with elements no list names.
11. Raw text and RCDATA, where a tokenizer reads no tags: "Zutano" in a `<script>`, a `<style>`, a `<title>`, an `<iframe>` and a `<noembed>`, and as markup (a meta, a comment, `<o:Author>`) inside `<noscript>`, `<noframes>`, `<textarea>` and `<xmp>`.
12. `<![CDATA[ Mengano ]]>`, `<![if Mengano]>` and `<?xml-stylesheet Mengano?>`: comments to an HTML parser.
13. OOXML core properties and an Office property element, bare in the page: `<cp:coreProperties>` with `<dc:creator>`, `<cp:lastModifiedBy>` and `<dcterms:modified>`, and `<o:Author>Perengano</o:Author>`.
14. Charset-shaped metas with other values (`<meta charset="Tertius"/>`, `content="Tertius/Quartus"`) and `<link rel="author" … title="Quartus"/>`.

The redactor (`src/sources/redact.ts`) is an allowlist over the page as parse5 (the build's parser) reads it, so it does not need to know any of these forms: it keeps only a charset declaration with a known charset label (and plain stylesheet links), turns every other meta into `<meta content="[redacted]">` and every other link into `<link>`, and empties every comment, every raw-text element, every template, every Office XML island and every Office property element (`o:*` but `o:p`, `dc:*`, `dcterms:*`, `cp:*`). None of these is text the build reads.

Three more folders hold the fail-closed cases, each serving the planted page under the LEGIN URL with one change: `malformed/` ends in a tag cut off by the end of the page (`<meta name="author" content="Mevio Ticio`), which the parser keeps in no node; `nul/` has a NUL byte, so it is not windows-1252 or UTF-8 text; `json-prefix/` starts with `{"autor": 1}`, as if it were JSON. The first two must fail the job before anything is kept; the third must be redacted as HTML, since only a known JSON endpoint's JSON passes through unread.

"Fulana de Tal", "Beltrano", "Sicrano" and "Fulano" are the Portuguese placeholder names (like "John Doe"); "Tício", "Mévio", "Semprônio" and "Graco" (as in Caio Graco) are the ones Brazilian law books use; "Tizio" is the Italian one; "Zutano", "Mengano" and "Perengano" are Spanish ones; "Tertius" and "Quartus" are Latin ordinals. They name no one. The legal text is unchanged.

---

# Fixture do cenário de redação (PT)

`legin.html` é a página gravada do CDC no LEGIN da Câmara (`fixtures/2026-10-21/camara-legin/`, cujos metadados já foram redigidos na captura), servida sob a URL real, com dado pessoal plantado antes do `</head>` de todas estas formas: atributos em ordem invertida e caixa mista; `META` em maiúsculas, sem aspas e com outro atributo no meio; um bloco XML do Office (`<o:Author>`, `<o:LastAuthor>`, `<o:Manager>`) num comentário condicional antes do `</head>`; um `>` dentro de um valor entre aspas; um nome de atributo escrito com referência de caractere (`n&#97;me`); metas `property` e `itemprop`; o mesmo atributo duas vezes; um nome num comentário HTML comum; um bloco `<xml>` do Office solto, fora de comentário, com elementos que nenhuma lista cita; nomes e marcação dentro de elementos de texto bruto (`script`, `style`, `title`, `noscript`, `noframes`, `textarea`, `xmp`, `iframe`, `noembed`); CDATA, `<![if …]>` e `<?…?>`; propriedades OOXML (`<cp:coreProperties>`, `<dc:creator>`, `<cp:lastModifiedBy>`) e `<o:Author>` soltos; metas com cara de charset e outros valores; e um `<link rel="author">`. O `test/publish.test.ts` roda o job diário sobre ela e confere que nenhum dos nomes plantados sobra em nada do que o job escreve (captura, dataset, corpo do PR, issues e status), que a captura guarda só a declaração de charset e esvazia todo outro meta, comentário, texto bruto e bloco do Office, e que todo byte a partir do `</head>` fica como foi servido.

O redator (`src/sources/redact.ts`) é uma lista do que fica, aplicada à página como o parse5 (o parser do build) a lê, então não precisa conhecer nenhuma dessas formas: guarda só uma declaração de charset com rótulo conhecido (e links de folha de estilo), troca todo outro meta por `<meta content="[redacted]">` e todo outro link por `<link>`, e esvazia todo comentário, elemento de texto bruto, template, ilha XML do Office e elemento de propriedade do Office (`o:*` exceto `o:p`, `dc:*`, `dcterms:*`, `cp:*`). Nada disso é texto que o build lê.

Mais três pastas trazem os casos de falha fechada, cada uma servindo a página plantada sob a URL do LEGIN com uma mudança: `malformed/` termina numa tag cortada pelo fim da página, que o parser não guarda em nenhum nó; `nul/` tem um byte NUL, então não é texto windows-1252 nem UTF-8; `json-prefix/` começa com `{"autor": 1}`, como se fosse JSON. As duas primeiras precisam fazer o job falhar antes de guardar qualquer coisa; a terceira precisa ser redigida como HTML, porque só o JSON de um endpoint JSON conhecido passa sem leitura.

"Fulana de Tal", "Beltrano", "Sicrano" e "Fulano" são nomes genéricos; "Tício", "Mévio", "Semprônio" e "Graco" (de Caio Graco) são os dos livros de Direito; "Tizio" é o italiano; "Zutano", "Mengano" e "Perengano" são espanhóis; "Tertius" e "Quartus" são ordinais latinos. Não identificam ninguém. O texto legal não muda. A página é gerada pelo `make.mjs`.

# Redaction scenario fixture

`legin.html` is the recorded Câmara LEGIN page of the CDC (`fixtures/2026-10-21/camara-legin/`, whose metadata was redacted at capture), served under its real URL, with personal data planted in its document metadata in ten forms. `test/publish.test.ts` runs the daily job over it and checks that none of the planted names survives in anything the job writes (the capture, the dataset, the PR body, the issues and the run status), that the capture keeps exactly the charset declaration, and that every byte from `</head>` on is as served.

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

The redactor (`src/sources/redact.ts`) is an allowlist over the page as parse5 (the build's parser) reads it, so it does not need to know any of these forms: it keeps only the charset declaration, gives every other meta `[redacted]` as its content (keeping its name, property, itemprop or http-equiv, dropping its other attributes), empties every comment and every Office XML block.

"Fulana de Tal", "Beltrano", "Sicrano" and "Fulano" are the Portuguese placeholder names (like "John Doe"); "Tício", "Mévio", "Semprônio" and "Graco" (as in Caio Graco) are the ones Brazilian law books use; "Tizio" is the Italian one. They name no one. The legal text is unchanged.

---

# Fixture do cenário de redação (PT)

`legin.html` é a página gravada do CDC no LEGIN da Câmara (`fixtures/2026-10-21/camara-legin/`, cujos metadados já foram redigidos na captura), servida sob a URL real, com dado pessoal plantado nos metadados de dez formas: atributos em ordem invertida e caixa mista; `META` em maiúsculas, sem aspas e com outro atributo no meio; um bloco XML do Office (`<o:Author>`, `<o:LastAuthor>`, `<o:Manager>`) num comentário condicional antes do `</head>`; um `>` dentro de um valor entre aspas; um nome de atributo escrito com referência de caractere (`n&#97;me`); metas `property` e `itemprop`; o mesmo atributo duas vezes; um nome num comentário HTML comum; e um bloco `<xml>` do Office solto, fora de comentário, com elementos que nenhuma lista cita. O `test/publish.test.ts` roda o job diário sobre ela e confere que nenhum dos nomes plantados sobra em nada do que o job escreve (captura, dataset, corpo do PR, issues e status), que a captura guarda só a declaração de charset e que todo byte a partir do `</head>` fica como foi servido.

O redator (`src/sources/redact.ts`) é uma lista do que fica, aplicada à página como o parse5 (o parser do build) a lê, então não precisa conhecer nenhuma dessas formas: guarda só a declaração de charset, dá `[redacted]` como conteúdo a todo outro meta (mantendo name, property, itemprop ou http-equiv e tirando os demais atributos) e esvazia todo comentário e todo bloco XML do Office.

"Fulana de Tal", "Beltrano", "Sicrano" e "Fulano" são nomes genéricos; "Tício", "Mévio", "Semprônio" e "Graco" (de Caio Graco) são os dos livros de Direito; "Tizio" é o italiano. Não identificam ninguém. O texto legal não muda. A página é gerada pelo `make.mjs`.

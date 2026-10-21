# Redaction scenario fixture

`legin.html` is the recorded Câmara LEGIN page of the CDC (`fixtures/2026-10-21/camara-legin/`, whose own author fields were redacted at capture), served under its real URL, with three planted forms of personal data in its document metadata. `test/publish.test.ts` runs the daily job over it and checks that none of the planted names survives in anything the job writes: the capture, the dataset, the PR body, the issues and the run status.

The planted forms, written by `make.mjs` (run `node test/fixtures/redaction/make.mjs` from the repo root):

1. `<meta content="Fulana de Tal" name="Author"/>`: attributes in reverse order, the name in mixed case.
2. `<META NAME=changedby data-origin=word CONTENT=Beltrano>`: upper case, unquoted values, another attribute in between.
3. An Office XML block before `</head>`, as Word writes one: `<o:Author>`, `<o:LastAuthor>` and `<o:Manager>` with invented names.

"Fulana de Tal", "Beltrano" and "Sicrano" are the Portuguese placeholder names (like "John Doe"); they name no one. The legal text is unchanged.

---

# Fixture do cenário de redação (PT)

`legin.html` é a página gravada do CDC no LEGIN da Câmara (`fixtures/2026-10-21/camara-legin/`, cujos campos de autor já foram trocados por `[redacted]` na captura), servida sob a URL real, com três formas de dado pessoal plantadas nos metadados: atributos em ordem invertida e caixa mista; `META` em maiúsculas, sem aspas e com outro atributo no meio; e um bloco XML do Office (`<o:Author>`, `<o:LastAuthor>`, `<o:Manager>`) antes do `</head>`. O `test/publish.test.ts` roda o job diário sobre ela e confere que nenhum dos nomes plantados sobra em nada do que o job escreve: captura, dataset, corpo do PR, issues e status. "Fulana de Tal", "Beltrano" e "Sicrano" são nomes genéricos e não identificam ninguém. O texto legal não muda. A página é gerada pelo `make.mjs`.

# Fixtures

Recorded responses from the official sources, replayed by the build pipeline's tests (seam 1). Each dated folder holds one capture; its `index.json` lists every file with its source URL, encoding, the response headers that matter for change detection, its SHA-256 and its size. A file may also carry `retrievedAt`, the exact retrieval instant taken from the response's `Date` header; files without it are dated by the capture day (`capturedOn`), which is what their provenance then shows. The recorded source refuses to load a file whose checksum no longer matches, so an editor or a git setting that re-encodes the bytes fails loudly. `.gitattributes` marks these files as binary for the same reason.

Files are stored as served, with one edit made to every page (HTML, not the JSON files): its metadata is redacted as the daily job redacts every page it fetches (`src/sources/redact.ts`): every `<meta>` but the charset declaration becomes `<meta content="[redacted]">`, every `<link>` but a plain stylesheet or icon link becomes `<link>`, every HTML comment becomes `<!---->` (Word's conditional comments hold its document properties; CDATA and `<?…?>` count as comments in HTML), and the content of every raw-text element (`script`, `style`, `title`, `textarea`, `noscript`…), every `<template>`, every Office XML island (`<xml>`, `<o:DocumentProperties>`) and every Office property element (`o:*` but `o:p`, `dc:*`, `dcterms:*`, `cp:*`) is removed. On Planalto pages that is the FrontPage `GENERATOR` and `ProgId` metas, the title, the inline CSS and the scripts (the F5 WAF's token included); on the LEGIN page, also the author fields described below. Every other byte, the legal text included, is as served: the build never reads what the redaction removes. A page's `index.json` entry then has an `edits` note and the served file's SHA-256 and size (`servedSha256`, `servedBytes`). Because the redaction is idempotent and is the job's own, a page the job fetches today hashes like its committed capture (the pre-filter of docs/publishing.md). Planalto pages are windows-1252 with no charset declared.

## 2026-10-20

Captured on the evening of 2026-10-20, Brasília time (early 2026-10-21 UTC), from a residential connection, with anonymous GETs and no personal identifier. It covers the v1 norms (CF, ADCT and CDC) plus the pages review needs:

- **Planalto.** The CF compiled page (`constituicaocompilado.htm`, clean current text including the ADCT) and the full-history CF page (`constituicao.htm`, old wording struck next to new). It also has the CDC compiled page, the amendment index (`quadro_emc.htm`) and the EC 140 and EC 141 pages. Their content is public domain (Lei 9.610/1998, art. 8º, IV). The full-history page is the v1 fixture with real struck wording (777 `<strike>` blocks against 3 on the compiled page), so strike handling is tested on it.
- **normas.leg.br (Senado Federal).** JSON-LD for the CF and the ADCT at maximum detail.

The normas.leg.br files are © Senado Federal, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: normas.leg.br / LexML Brasil. They are kept here unmodified, only as test inputs. The published Akoma dataset does not republish their text or history.

Source URLs:

- `planalto/constituicaocompilado.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm
- `planalto/constituicao.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm
- `planalto/l8078compilado.htm` ← https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm
- `planalto/quadro_emc.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/quadro_emc.htm
- `planalto/emc140.htm`, `planalto/emc141.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc140.htm (and `emc141.htm`)
- `normas-leg-br/constituicao.json` ← https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:constituicao:1988-10-05;1988&tipo_documento=maior-detalhe
- `normas-leg-br/adct.json` ← the same endpoint with `urn=urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988`

## 2026-10-21

Captured on 2026-10-21 at 04:48 UTC from a residential connection, with one anonymous GET (`Mozilla/5.0 (compatible; akoma/0.0.0)`, no personal identifier). It holds the CDC's secondary source (ADR 0002):

- `camara-legin/lei-8078-1990-normaatualizada-pl.html` ← https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html. This is Câmara dos Deputados LEGIN's compiled text of Lei 8.078/1990, in UTF-8 as served, with no ETag or Last-Modified.

**The metadata edit.** The page's `<meta name="author">` and `<meta name="changedby">` values held a Câmara staff member's name and staff ID; with the rest of its metadata (generator, dates, company…) they are now `<meta content="[redacted]"/>`, so no personal identifier is committed; nothing else changed. `index.json` records the stored file's SHA-256 and size, plus the served bytes' (`servedSha256`, `servedBytes`), so the capture can be re-verified against a fresh GET run through `redactPersonalData`.

**Licence.** The legal text is not protected by copyright (Lei 9.610/1998, art. 8º, IV). The page states no licence for Câmara's compilation and annotations. normas.leg.br lists a "Compilação Monovigente na CD" of this law under CC BY 4.0, but that it is this same file has not been shown. The capture is kept only as a test input for the cross-check (#8). The published dataset does not republish its text.

**The EC 132 page.** The page of EC 132/2023 (the tax reform), the amending act whose vigência clause defers changes to the CF and the ADCT to 2027 and 2033 (ADR 0003). It was fetched during research on 2026-10-21 (Brasília time), about three hours after the 2026-10-20 capture and separately from the LEGIN page, with one anonymous GET, UA `Mozilla/5.0 (compatible; akoma/0.0.0)` and no personal identifier, and is stored as served but for the metadata edit above. The response headers and the exact retrieval instant were not recorded, so `headers` is empty and its provenance carries the capture day.

It was checked offline before being committed: it is the FrontPage page Planalto serves (`GENERATOR` Microsoft FrontPage 6.0, the F5 `f5_cspm` script after `</html>`, footer `Este texto não substitui o publicado no DOU 21.12.2023`), and the wordings quoted in its art. 1 for CF art. 146 III "d", 156-A § 1º IX, 159 § 3º, 195 § 17 and 225 § 1º VIII are identical to the ones the 2026-10-20 compiled CF shows as given by EC 132. As served: SHA-256 `bee37a51c439d37d261c859ffd7992a4164257e6017f12cdf5c4ab2ca44eed4c`, 510,399 bytes (`servedSha256`; the stored, redacted file's are in `index.json`). Public domain (Lei 9.610/1998, art. 8º, IV).

- `planalto/emc132.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm

**The Lei 14.181/2021 page.** The page of Lei nº 14.181, de 1º de julho de 2021 (credit and over-indebtedness), a law that amended the CDC, captured so that review can read a real law's commands (target matching and the LLM reviewer read every act a change cites, not only ECs). Fetched on 2026-10-21 at 07:16 UTC with one anonymous GET through `src/sources/http.ts` (UA `Mozilla/5.0 (compatible; akoma/0.0.0)`, no personal identifier); the response's ETag, Last-Modified and `Date` are recorded. Stored with the metadata edit above (as served: SHA-256 `c46d30bcfeb0262e6f9af05754ec5138ce22a2f0dc8dc32c9273db2a1a6554e1`, 52,362 bytes). Its art. 1º quotes 69 CDC dispositivos (arts. 4º, 5º, 6º and 51, the new Chapter VI-A with arts. 54-A to 54-G, and arts. 104-A to 104-C); art. 2º amends the Estatuto do Idoso; art. 5º puts it in force on publication. Public domain (Lei 9.610/1998, art. 8º, IV).

- `planalto/L14181.htm` ← https://www.planalto.gov.br/ccivil_03/_Ato2019-2022/2021/Lei/L14181.htm

Scenario fixtures (a simulated new amendment, a stale secondary source…) are derived from these files by documented edits and live next to the tests that use them.

## Daily captures (`YYYY-MM-DD-daily/`)

The daily publish job commits the pages it built the published dataset from as `YYYY-MM-DD-daily/`, in this same format, with a generated README (provenance, licences, the metadata redaction). These folders are written by the job, never by hand. Together with the hand-made captures above, they are the input of `pnpm build:dataset`: every dated folder, later ones winning for the same URL (docs/publishing.md). Tests keep reading the folders they name, so a new capture never moves a test.

---

# Fixtures (PT)

Respostas gravadas das fontes oficiais, reproduzidas nos testes do pipeline de build (seam 1). Cada pasta datada guarda uma captura. O `index.json` dela lista cada arquivo com a URL de origem, a codificação, os headers relevantes para detectar mudança, o SHA-256 e o tamanho. Um arquivo pode trazer também `retrievedAt`, o instante exato da captura tirado do header `Date` da resposta; os que não têm esse campo são datados pelo dia da captura (`capturedOn`), e é isso que a proveniência deles mostra. Se o checksum de um arquivo não bater mais, a fonte gravada se recusa a carregá-lo; assim, um editor ou uma configuração do git que recodifique os bytes faz o teste falhar na hora. Pelo mesmo motivo, o `.gitattributes` marca esses arquivos como binários.

Os arquivos ficam como foram servidos, com uma edição em toda página (HTML, não os JSON): os metadados são removidos como o job diário faz com toda página que baixa (`src/sources/redact.ts`): todo `<meta>` exceto a declaração de charset vira `<meta content="[redacted]">`, todo `<link>` que não seja de folha de estilo ou ícone vira `<link>`, todo comentário HTML vira `<!---->` (os comentários condicionais do Word guardam as propriedades do documento; CDATA e `<?…?>` são comentários em HTML) e some o conteúdo de todo elemento de texto bruto (`script`, `style`, `title`, `textarea`, `noscript`…), de todo `<template>`, de toda ilha XML do Office (`<xml>`, `<o:DocumentProperties>`) e de todo elemento de propriedade do Office (`o:*` exceto `o:p`, `dc:*`, `dcterms:*`, `cp:*`). Nas páginas do Planalto, isso atinge os metas `GENERATOR` e `ProgId` do FrontPage, o título, o CSS embutido e os scripts (inclusive o token do WAF F5); na do LEGIN, também os campos de autor descritos abaixo. Todos os outros bytes, inclusive o texto legal, ficam como foram servidos: o build nunca lê o que a redação remove. A entrada da página no `index.json` traz então uma nota `edits` e o SHA-256 e o tamanho do arquivo servido (`servedSha256`, `servedBytes`). Como a redação é idempotente e é a do próprio job, uma página baixada hoje tem o mesmo hash da captura versionada (o pré-filtro do docs/publishing.md). As páginas do Planalto vêm em windows-1252, sem charset declarado.

## 2026-10-20

Capturada na noite de 20/10/2026, horário de Brasília (madrugada de 21/10 em UTC), de uma conexão residencial, com GETs anônimos e sem nenhum identificador pessoal. Cobre as normas da v1 (CF, ADCT e CDC) e as páginas de que a revisão precisa:

- **Planalto.** A página compilada da CF (`constituicaocompilado.htm`, texto vigente limpo, incluindo o ADCT) e a página com histórico completo (`constituicao.htm`, redação antiga riscada ao lado da nova). Também traz a página compilada do CDC, o índice de emendas (`quadro_emc.htm`) e as páginas das EC 140 e 141. O conteúdo é de domínio público (Lei 9.610/1998, art. 8º, IV). A página com histórico é a fixture da v1 que tem redação riscada de verdade (777 blocos `<strike>`, contra 3 na compilada); o tratamento do texto riscado é testado nela.
- **normas.leg.br (Senado Federal).** JSON-LD da CF e do ADCT no nível máximo de detalhe.

Os arquivos do normas.leg.br são © Senado Federal, sob licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Fonte: normas.leg.br / LexML Brasil. Ficam aqui sem alteração e servem só como entrada de teste. O dataset publicado pelo Akoma não republica o texto nem o histórico deles.

As URLs de origem estão listadas na seção em inglês acima.

## 2026-10-21

Capturada em 21/10/2026, às 04:48 UTC, de uma conexão residencial, com um GET anônimo (`Mozilla/5.0 (compatible; akoma/0.0.0)`, sem identificador pessoal). Contém a fonte secundária do CDC (ADR 0002): `camara-legin/lei-8078-1990-normaatualizada-pl.html`, o texto compilado da Lei 8.078/1990 no LEGIN da Câmara dos Deputados, em UTF-8 como foi servido, sem ETag nem Last-Modified.

**A edição dos metadados:** os valores de `<meta name="author">` e `<meta name="changedby">` traziam o nome e a matrícula de um servidor da Câmara; com o resto dos metadados (gerador, datas, empresa…), viraram `<meta content="[redacted]"/>`, para não versionar identificador pessoal; nada mais mudou. O `index.json` registra o SHA-256 e o tamanho do arquivo gravado e também os dos bytes servidos (`servedSha256`, `servedBytes`).

**Licença:** o texto legal não tem proteção autoral (Lei 9.610/1998, art. 8º, IV). A página não declara licença para a compilação e as anotações da Câmara. O normas.leg.br lista uma "Compilação Monovigente na CD" desta lei sob CC BY 4.0, mas não foi comprovado que seja o mesmo arquivo. A captura serve só de entrada de teste para a conferência entre fontes (#8), e o dataset publicado não republica o texto.

**A página da EC 132.** A página da EC 132/2023 (reforma tributária), a emenda cuja cláusula de vigência adia para 2027 e 2033 mudanças na CF e no ADCT (ADR 0003). Foi baixada durante a pesquisa em 21/10/2026 (horário de Brasília), cerca de três horas depois da captura de 20/10 e separadamente da página do LEGIN, com um único GET anônimo, UA `Mozilla/5.0 (compatible; akoma/0.0.0)` e sem identificador pessoal, e está guardada como foi servida, salvo a edição dos metadados acima. Os headers da resposta e o instante exato não foram registrados; por isso `headers` está vazio e a proveniência mostra o dia da captura.

Antes do commit, foi conferida offline: é a página FrontPage que o Planalto serve (`GENERATOR` Microsoft FrontPage 6.0, o script `f5_cspm` do F5 depois de `</html>`, rodapé `Este texto não substitui o publicado no DOU 21.12.2023`), e as redações citadas no art. 1º dela para os arts. 146, III, "d", 156-A, § 1º, IX, 159, § 3º, 195, § 17, e 225, § 1º, VIII, da CF são idênticas às que a CF compilada de 20/10 mostra como dadas pela EC 132. Como foi servida: SHA-256 `bee37a51c439d37d261c859ffd7992a4164257e6017f12cdf5c4ab2ca44eed4c`, 510.399 bytes (`servedSha256`; os do arquivo gravado, já redigido, estão no `index.json`). Domínio público (Lei 9.610/1998, art. 8º, IV).

**A página da Lei 14.181/2021.** A página da Lei nº 14.181, de 1º de julho de 2021 (crédito e superendividamento), uma lei que alterou o CDC, capturada para que a revisão leia os comandos de uma lei real (a conferência de alvos e o revisor LLM leem todo ato que a mudança cita, não só ECs). Baixada em 21/10/2026 às 07:16 UTC com um único GET anônimo pelo `src/sources/http.ts` (UA `Mozilla/5.0 (compatible; akoma/0.0.0)`, sem identificador pessoal); ETag, Last-Modified e `Date` da resposta estão registrados. Guardada com a edição dos metadados acima (como foi servida: SHA-256 `c46d30bcfeb0262e6f9af05754ec5138ce22a2f0dc8dc32c9273db2a1a6554e1`, 52.362 bytes). O art. 1º dela cita 69 dispositivos do CDC; o art. 2º altera o Estatuto do Idoso; o art. 5º a põe em vigor na publicação. Domínio público (Lei 9.610/1998, art. 8º, IV).

Fixtures de cenário (uma emenda nova simulada, uma fonte secundária defasada…) são derivadas destes arquivos por edições documentadas e ficam ao lado dos testes que as usam.

## Capturas diárias (`AAAA-MM-DD-daily/`)

O job diário de publicação commita as páginas de que montou o dataset publicado em `AAAA-MM-DD-daily/`, neste mesmo formato, com um README gerado (proveniência, licenças, a edição dos metadados do LEGIN). Essas pastas são escritas pelo job, nunca à mão. Junto com as capturas acima, são a entrada do `pnpm build:dataset`: todas as pastas datadas, e a mais recente prevalece para a mesma URL (docs/publishing.md). Os testes leem as pastas que nomeiam, então uma captura nova não muda nenhum teste.

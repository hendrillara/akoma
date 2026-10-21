# Fixtures

Recorded responses from the official sources, replayed by the build pipeline's tests (seam 1). Each dated folder holds one capture; its `index.json` lists every file with its source URL, encoding, the response headers that matter for change detection, its SHA-256 and its size. A file may also carry `retrievedAt`, the exact retrieval instant taken from the response's `Date` header; files without it are dated by the capture day (`capturedOn`), which is what their provenance then shows. The recorded source refuses to load a file whose checksum no longer matches, so an editor or a git setting that re-encodes the bytes fails loudly. `.gitattributes` marks these files as binary for the same reason.

Files are stored exactly as served: Planalto pages are windows-1252 with no charset declared.

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

**One documented edit.** The page's `<meta name="author">` and `<meta name="changedby">` values held a Câmara staff member's name and staff ID. Both are replaced with `[redacted]`, so no personal identifier is committed; nothing else changed. `index.json` records the stored file's SHA-256 and size, plus the served bytes' (`servedSha256`, `servedBytes`), so the capture can be re-verified against a fresh GET once the two meta values are redacted the same way.

**Licence.** The legal text is not protected by copyright (Lei 9.610/1998, art. 8º, IV). The page states no licence for Câmara's compilation and annotations. normas.leg.br lists a "Compilação Monovigente na CD" of this law under CC BY 4.0, but that it is this same file has not been shown. The capture is kept only as a test input for the cross-check (#8). The published dataset does not republish its text.

Scenario fixtures (a simulated new amendment, a stale secondary source…) are derived from these files by documented edits and live next to the tests that use them.

---

# Fixtures (PT)

Respostas gravadas das fontes oficiais, reproduzidas nos testes do pipeline de build (seam 1). Cada pasta datada guarda uma captura. O `index.json` dela lista cada arquivo com a URL de origem, a codificação, os headers relevantes para detectar mudança, o SHA-256 e o tamanho. Um arquivo pode trazer também `retrievedAt`, o instante exato da captura tirado do header `Date` da resposta; os que não têm esse campo são datados pelo dia da captura (`capturedOn`), e é isso que a proveniência deles mostra. Se o checksum de um arquivo não bater mais, a fonte gravada se recusa a carregá-lo; assim, um editor ou uma configuração do git que recodifique os bytes faz o teste falhar na hora. Pelo mesmo motivo, o `.gitattributes` marca esses arquivos como binários.

Os arquivos ficam exatamente como foram servidos: as páginas do Planalto vêm em windows-1252, sem charset declarado.

## 2026-10-20

Capturada na noite de 20/10/2026, horário de Brasília (madrugada de 21/10 em UTC), de uma conexão residencial, com GETs anônimos e sem nenhum identificador pessoal. Cobre as normas da v1 (CF, ADCT e CDC) e as páginas de que a revisão precisa:

- **Planalto.** A página compilada da CF (`constituicaocompilado.htm`, texto vigente limpo, incluindo o ADCT) e a página com histórico completo (`constituicao.htm`, redação antiga riscada ao lado da nova). Também traz a página compilada do CDC, o índice de emendas (`quadro_emc.htm`) e as páginas das EC 140 e 141. O conteúdo é de domínio público (Lei 9.610/1998, art. 8º, IV). A página com histórico é a fixture da v1 que tem redação riscada de verdade (777 blocos `<strike>`, contra 3 na compilada); o tratamento do texto riscado é testado nela.
- **normas.leg.br (Senado Federal).** JSON-LD da CF e do ADCT no nível máximo de detalhe.

Os arquivos do normas.leg.br são © Senado Federal, sob licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Fonte: normas.leg.br / LexML Brasil. Ficam aqui sem alteração e servem só como entrada de teste. O dataset publicado pelo Akoma não republica o texto nem o histórico deles.

As URLs de origem estão listadas na seção em inglês acima.

## 2026-10-21

Capturada em 21/10/2026, às 04:48 UTC, de uma conexão residencial, com um GET anônimo (`Mozilla/5.0 (compatible; akoma/0.0.0)`, sem identificador pessoal). Contém a fonte secundária do CDC (ADR 0002): `camara-legin/lei-8078-1990-normaatualizada-pl.html`, o texto compilado da Lei 8.078/1990 no LEGIN da Câmara dos Deputados, em UTF-8 como foi servido, sem ETag nem Last-Modified.

**Uma edição documentada:** os valores de `<meta name="author">` e `<meta name="changedby">` traziam o nome e a matrícula de um servidor da Câmara e foram trocados por `[redacted]`, para não versionar identificador pessoal; nada mais mudou. O `index.json` registra o SHA-256 e o tamanho do arquivo gravado e também os dos bytes servidos (`servedSha256`, `servedBytes`).

**Licença:** o texto legal não tem proteção autoral (Lei 9.610/1998, art. 8º, IV). A página não declara licença para a compilação e as anotações da Câmara. O normas.leg.br lista uma "Compilação Monovigente na CD" desta lei sob CC BY 4.0, mas não foi comprovado que seja o mesmo arquivo. A captura serve só de entrada de teste para a conferência entre fontes (#8), e o dataset publicado não republica o texto.

Fixtures de cenário (uma emenda nova simulada, uma fonte secundária defasada…) são derivadas destes arquivos por edições documentadas e ficam ao lado dos testes que as usam.

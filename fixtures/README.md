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

The page of EC 132/2023 (the tax reform), the amending act whose vigência clause defers changes to the CF and the ADCT to 2027 and 2033 (ADR 0002). It was fetched during research on 2026-10-21 (Brasília time), about three hours after the 2026-10-20 capture, with one anonymous GET, UA `Mozilla/5.0 (compatible; akoma/0.0.0)` and no personal identifier, and is stored byte for byte as served. The response headers and the exact retrieval instant were not recorded, so `headers` is empty and its provenance carries the capture day.

It was checked offline before being committed: it is the FrontPage page Planalto serves (`GENERATOR` Microsoft FrontPage 6.0, the F5 `f5_cspm` script after `</html>`, footer `Este texto não substitui o publicado no DOU 21.12.2023`), and the wordings quoted in its art. 1 for CF art. 146 III "d", 156-A § 1º IX, 159 § 3º, 195 § 17 and 225 § 1º VIII are identical to the ones the 2026-10-20 compiled CF shows as given by EC 132. SHA-256 `bee37a51c439d37d261c859ffd7992a4164257e6017f12cdf5c4ab2ca44eed4c`, 510,399 bytes. Public domain (Lei 9.610/1998, art. 8º, IV).

- `planalto/emc132.htm` ← https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm

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

A página da EC 132/2023 (reforma tributária), a emenda cuja cláusula de vigência adia para 2027 e 2033 mudanças na CF e no ADCT (ADR 0002). Foi baixada durante a pesquisa em 21/10/2026 (horário de Brasília), cerca de três horas depois da captura de 20/10, com um único GET anônimo, UA `Mozilla/5.0 (compatible; akoma/0.0.0)` e sem identificador pessoal, e está guardada byte a byte como foi servida. Os headers da resposta e o instante exato não foram registrados; por isso `headers` está vazio e a proveniência mostra o dia da captura.

Antes do commit, foi conferida offline: é a página FrontPage que o Planalto serve (`GENERATOR` Microsoft FrontPage 6.0, o script `f5_cspm` do F5 depois de `</html>`, rodapé `Este texto não substitui o publicado no DOU 21.12.2023`), e as redações citadas no art. 1º dela para os arts. 146, III, "d", 156-A, § 1º, IX, 159, § 3º, 195, § 17, e 225, § 1º, VIII, da CF são idênticas às que a CF compilada de 20/10 mostra como dadas pela EC 132. SHA-256 `bee37a51c439d37d261c859ffd7992a4164257e6017f12cdf5c4ab2ca44eed4c`, 510.399 bytes. Domínio público (Lei 9.610/1998, art. 8º, IV).

Fixtures de cenário (uma emenda nova simulada, uma fonte secundária defasada…) são derivadas destes arquivos por edições documentadas e ficam ao lado dos testes que as usam.

# Refresh scenario fixtures

Two pages that a later daily run could receive for the compiled CF page, derived from the recorded capture `fixtures/2026-10-20/planalto/constituicaocompilado.htm` (Planalto, public domain). `test/changes.test.ts` builds the CF and ADCT from the recorded capture as the previous dataset, then from one of these pages as the new one, and checks the change report. Each folder has the page (`page.htm`, windows-1252 bytes, served under the real Planalto URL so the CF manifest picks it up) and an `index.json` with its headers, retrieval time, SHA-256 and size.

`make.mjs` writes both folders from the recorded page; to change a scenario, edit the script and run `node test/fixtures/refresh/make.mjs` from the repo root. Every edit must match exactly once, or the script stops. The page is read and written as latin1, which keeps the windows-1252 bytes as they are.

**These pages are not official texts.** EC 142 did not exist when they were made; the `ec142` page also says so in an HTML comment at its top.

## `etag-only/`: same content, new headers

The recorded page, with:

- the token Planalto's F5 WAF injects after `</html>` on every response (`f5_p:'…'`) reversed, so the bytes differ as they would on any new fetch;
- a new `ETag` (`"16f927-65e4f0a1b2c3d"`: same size prefix, new suffix) and `Last-Modified` (`Wed, 21 Oct 2026 16:20:10 GMT`);
- retrieval time `2026-10-22T01:30:00Z`.

Expected: no dispositivo changes; the page shows its headers changed and its content (without scripts) the same.

## `ec142/`: a simulated Emenda Constitucional nº 142, de 2026

The recorded page, with these edits (annotations copy forms that already occur on the page; their links point to `emendas/emc/emc142.htm#artN`):

1. **Art. 6º caput, new wording:** "…a assistência aos desamparados, na forma desta Constituição." becomes "…a assistência aos desamparados e o cuidado, na forma desta Constituição.", and its annotation "(Redação dada pela Emenda Constitucional nº 90, de 2015)" becomes "(Redação dada pela Emenda Constitucional nº 142, de 2026)" (`#art1`).
2. **Art. 6º parágrafo único renumbered as § 1º:** the label "Parágrafo único." becomes "§ 1º", the wording is unchanged, and "(Renumerado do parágrafo único, pela Emenda Constitucional nº 142, de 2026)" (`#art1`) is appended after its existing annotations.
3. **Art. 6º § 2º inserted:** "§ 2º O cuidado é direito de todos e dever do Estado, da família e da sociedade, na forma da lei. (Incluído pela Emenda Constitucional nº 142, de 2026)" (`#art1`).
4. **Art. 7º XIV revoked by new wording:** "XIV - (revogado); (Redação dada pela Emenda Constitucional nº 142, de 2026)" (`#art2`), the form of art. 167 § 4º's incisos (EC 109).
5. **Art. 7º XVIII, a new "Vide" note only:** "(Vide ADI 9999)" appended, unlinked; the ADI number is invented. The wording is unchanged.
6. **Art. 7º XXVII revoked by an annotation alone:** "XXVII - (Revogado pela Emenda Constitucional nº 142, de 2026)" (`#art3`), the form of art. 36 IV (EC 45).
7. The F5 token shifted one letter (A→B … P→A), a new `ETag` (`"16fb54-65e6b2c3d4e5f"`, its size prefix the new byte count before the injected script) and `Last-Modified` (`Thu, 22 Oct 2026 16:20:05 GMT`), and retrieval time `2026-10-23T01:30:00Z`.

The ADCT is untouched. There is no `emc142.htm` page: target matching against the act's commands (ticket #10) would add one.

---

# Fixtures de cenário de atualização (PT)

Duas páginas que uma execução diária futura poderia receber no lugar da CF compilada, derivadas da captura gravada `fixtures/2026-10-20/planalto/constituicaocompilado.htm` (Planalto, domínio público). O `test/changes.test.ts` monta a CF e o ADCT a partir da captura gravada como dataset anterior e, depois, a partir de uma destas páginas como o novo, e confere o relatório de mudanças. Cada pasta tem a página (`page.htm`, bytes windows-1252, servida sob a URL real do Planalto para que o manifesto da CF a encontre) e um `index.json` com headers, horário de captura, SHA-256 e tamanho.

O `make.mjs` gera as duas pastas a partir da página gravada; para alterar um cenário, edite o script e rode `node test/fixtures/refresh/make.mjs` na raiz do repositório. Cada edição precisa casar exatamente uma vez, senão o script para. A página é lida e gravada como latin1, o que preserva os bytes windows-1252.

**Estas páginas não são textos oficiais.** A EC 142 não existia quando foram feitas; a página `ec142` também avisa isso num comentário HTML no topo.

- **`etag-only/`:** a página gravada com o token que o WAF F5 do Planalto injeta em toda resposta invertido, `ETag` e `Last-Modified` novos e horário de captura novo. Esperado: nenhum dispositivo muda; a página aparece com headers alterados e conteúdo (sem scripts) igual.
- **`ec142/`:** uma Emenda Constitucional nº 142, de 2026, simulada: nova redação do caput do art. 6º; parágrafo único do art. 6º renumerado como § 1º (mesmo texto); § 2º incluído no art. 6º; art. 7º XIV revogado por nova redação "(revogado);"; nova nota "(Vide ADI 9999)" no art. 7º XVIII, com número de ADI inventado; art. 7º XXVII revogado só por anotação; e token F5, headers e horário de captura novos. Os textos exatos estão na seção em inglês acima.

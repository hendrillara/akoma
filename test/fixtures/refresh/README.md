# Refresh scenario fixtures

Pages that a daily run could receive for the compiled CF page, derived from the recorded capture `fixtures/2026-10-20/planalto/constituicaocompilado.htm` (Planalto, public domain), whose page metadata is already redacted as the daily job redacts every page (`fixtures/README.md`), so the scenario pages are too. `test/changes.test.ts` and `test/review.test.ts` build the CF and ADCT from two captures (the recorded one and one of these, either way round), then check the change report and the review verdict. Each folder has the page (`page.htm`, windows-1252 bytes, served under the real Planalto URL so the CF manifest picks it up), the amending act's page when the scenario has one (served under its Planalto URL), and an `index.json` with headers, retrieval time, SHA-256 and size per file.

`make.mjs` writes every folder from the recorded page; to change a scenario, edit the script and run `node test/fixtures/refresh/make.mjs` from the repo root. Every edit (an exact string, or a whitespace-tolerant pattern for multi-line HTML) must match exactly once, or the script stops. The page is read and written as latin1, which keeps the windows-1252 bytes as they are.

**These pages are not official texts.** EC 142 did not exist when they were made; every edited page says so in an HTML comment at its top.

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

The ADCT is untouched.

`emc142.htm` is the simulated act's own page, laid out like Planalto's EC pages (`emc141.htm`), served under `https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc142.htm`. Its commands target exactly the dispositivos the page above changes, from the articles their annotations link to: art. 1º alters art. 6º ("…passa a vigorar com as seguintes alterações, numerado o parágrafo único como § 1º:", with the new caput, a `§ 1º ……` placeholder and § 2º quoted); art. 2º quotes "XIV - (revogado);" for art. 7º; art. 3º reads "Revoga-se o inciso XXVII do caput do art. 7º da Constituição Federal."; art. 4º is the vigência clause. Expected review verdict: `merge`, with a note for the "Vide ADI" change (edit 5), which no act explains and which leaves the wording as it was.

## `ec142-faults/`: EC 142 with four faults the review must stop

The `ec142` page (and the same `emc142.htm`), with:

- **F1.** Art. 7º XVI reworded ("cinqüenta por cento" → "setenta por cento") with "(Redação dada pela Emenda Constitucional nº 142, de 2026)" (`#art2`), which EC 142 does not target.
- **F2.** Art. 7º XXXIV removed from the page, with no revocation mark.
- **F3.** Art. 1º incisos I and II swapped: no record changes, but the siblings are out of order.
- **F4.** Art. 7º XXVII left as in the recorded page, though EC 142 art. 3 revokes it.
- A new F5 token, `ETag` and `Last-Modified`.

Expected verdict: `needs-human`, with one reason per fault.

## `before-ec140-141/`: the CF before EC 140 and EC 141

The recorded page as it read before EC 140 and EC 141 (both of 16.10.2026), so the two real acts can be reviewed against it. Every old wording is the one struck on the full-history page (`fixtures/2026-10-20/planalto/constituicao.htm`), with its annotation:

1. EC 140: art. 40 § 4º back to its EC 103 wording ("…ressalvado o disposto nos §§ 4º-A, 4º-B, 4º-C e 5º."); art. 198 § 10 back to its EC 120 wording ("…terão também, em razão dos riscos inerentes às funções desempenhadas, aposentadoria especial e, somado aos seus vencimentos, adicional de insalubridade."); art. 40 § 5º-A, art. 198 IV, §§ 4º-A and 4º-B and art. 201 § 8º-A removed (not yet inserted).
2. EC 141: art. 7º XIII back to its 1988 wording ("…não superior a oito horas diárias e quarenta e quatro semanais…") with its "(Vide Decreto-Lei nº 5.452, de 1943)"; XV without its "(Vide Emenda Constitucional nº 141, de 2026)" and "(Vigência)" notes; § 1º back to "Parágrafo único." with "(Redação dada pela Emenda Constitucional nº 72, de 2013)" (same text); §§ 2º and 3º removed.
3. A new F5 token, `ETag` and `Last-Modified` (`Tue, 13 Oct 2026 16:20:10 GMT`), retrieval time `2026-10-15T01:30:00Z`.

Expected: building it, then the recorded capture, shows exactly the 12 dispositivos the recorded page annotates with EC 140 or EC 141, and the review verdict is `merge`.

## `cdc-law/`: the CDC reworded by a simulated ordinary law

The one scenario on another page: the recorded compiled CDC page (`fixtures/2026-10-20/planalto/l8078compilado.htm`), served under its Planalto URL, with:

1. **Art. 49 caput, new wording:** "no prazo de 7 dias" becomes "no prazo de 14 dias", followed by `<a href="_ato2023-2026/2026/lei/L15999.htm#art1">(Redação dada pela Lei nº 15.999, de 2026)</a>`, the CDC's own annotation form (art. 4º, Lei 9.008). Lei nº 15.999, de 2026, does not exist.
2. A comment at the top saying so, a new `Last-Modified` (`Thu, 22 Oct 2026 09:50:35 GMT`; the CDC page has no ETag) and retrieval time `2026-10-23T01:30:00Z`.

The page keeps its windows-1252 bytes 0x80–0x9F (curly quotes) as captured. Expected (test/publish.test.ts): the daily job escalates (`needs-human`), since v1's target matching and LLM reviewer read only constitutional amendments, and the PR body says why.

---

# Fixtures de cenário de atualização (PT)

Páginas que uma execução diária poderia receber no lugar da CF compilada, derivadas da captura gravada `fixtures/2026-10-20/planalto/constituicaocompilado.htm` (Planalto, domínio público), cujos metadados já estão redigidos como o job diário faz com toda página (`fixtures/README.md`); as páginas de cenário também. O `test/changes.test.ts` e o `test/review.test.ts` montam a CF e o ADCT a partir de duas capturas (a gravada e uma destas, numa ordem ou na outra) e conferem o relatório de mudanças e o veredito da revisão. Cada pasta tem a página (`page.htm`, bytes windows-1252, servida sob a URL real do Planalto para que o manifesto da CF a encontre), a página do ato emendador quando o cenário tem uma (servida sob a URL dela no Planalto) e um `index.json` com headers, horário de captura, SHA-256 e tamanho de cada arquivo.

O `make.mjs` gera todas as pastas a partir da página gravada; para alterar um cenário, edite o script e rode `node test/fixtures/refresh/make.mjs` na raiz do repositório. Cada edição (uma string exata, ou um padrão tolerante a espaços para HTML de várias linhas) precisa casar exatamente uma vez, senão o script para. A página é lida e gravada como latin1, o que preserva os bytes windows-1252.

**Estas páginas não são textos oficiais.** A EC 142 não existia quando foram feitas; toda página editada avisa isso num comentário HTML no topo.

- **`etag-only/`:** a página gravada com o token que o WAF F5 do Planalto injeta em toda resposta invertido, `ETag` e `Last-Modified` novos e horário de captura novo. Esperado: nenhum dispositivo muda; a página aparece com headers alterados e conteúdo (sem scripts) igual.
- **`ec142/`:** uma Emenda Constitucional nº 142, de 2026, simulada: nova redação do caput do art. 6º; parágrafo único do art. 6º renumerado como § 1º (mesmo texto); § 2º incluído no art. 6º; art. 7º XIV revogado por nova redação "(revogado);"; nova nota "(Vide ADI 9999)" no art. 7º XVIII, com número de ADI inventado; art. 7º XXVII revogado só por anotação; e token F5, headers e horário de captura novos. A pasta traz também `emc142.htm`, a página simulada do próprio ato, no formato das páginas de EC do Planalto: seus comandos visam exatamente os dispositivos alterados (art. 1º: caput do art. 6º, parágrafo único renumerado como § 1º, § 2º; art. 2º: art. 7º XIV "(revogado)"; art. 3º: "Revoga-se o inciso XXVII do caput do art. 7º"). Veredito esperado: `merge`, com uma nota para a nova "Vide ADI", que nenhum ato explica e que não muda a redação.
- **`ec142-faults/`:** a página `ec142` (e a mesma `emc142.htm`) com quatro falhas: art. 7º XVI com nova redação atribuída à EC 142, que não o visa; art. 7º XXXIV some da página sem marca de revogação; incisos I e II do art. 1º trocados de ordem; art. 7º XXVII sem a revogação que a EC 142 manda. Veredito esperado: `needs-human`, com um motivo por falha.
- **`before-ec140-141/`:** a página gravada como era antes das EC 140 e 141 (ambas de 16/10/2026), com cada redação antiga tirada do texto riscado da página com histórico completo (`fixtures/2026-10-20/planalto/constituicao.htm`). Montar esta página e depois a captura gravada mostra exatamente os 12 dispositivos que a página gravada anota com a EC 140 ou a EC 141, e o veredito da revisão é `merge`.
- **`cdc-law/`:** o único cenário em outra página: o CDC compilado gravado, com nova redação do caput do art. 49 ("7 dias" → "14 dias") atribuída a uma Lei nº 15.999, de 2026, que não existe, no formato de anotação do próprio CDC; um comentário no topo avisando isso, `Last-Modified` e horário de captura novos. Esperado: o job diário escala (`needs-human`), porque na v1 a conferência de alvos e o revisor LLM só leem emendas constitucionais, e o corpo do PR explica o motivo.

Os textos exatos estão na seção em inglês acima.

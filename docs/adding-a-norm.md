# Adding a norm

A norm is a declarative manifest plus its tests. The pipeline has no per-norm code. The CDC was added this way (#7): see `src/norms/cdc.ts` and `test/cdc.test.ts`.

1. **Capture the page.** Save Planalto's compiled page (`…compilado.htm`) into a new dated folder under `fixtures/`. Store the exact bytes, plus an `index.json` entry (URL, encoding, headers, `retrievedAt` from the `Date` header, SHA-256, size) and README provenance in EN and PT.
   - Make an anonymous GET with `Mozilla/5.0 (compatible; akoma/<version>)`.
   - Never put a personal identifier in the request or in the committed file. If the page's metadata names someone, redact it as a documented edit.
2. **Write the manifest** in `src/norms/<key>.ts` and add it to `src/norms/index.ts`:
   - `key`, `title`, the LexML `urn`, plus its `type` and `date`. The build fails if they disagree with the URN.
   - `primaryUrl`: the Planalto page. Add `startAnchor`/`endAnchor` only when the norm shares its page with another norm (CF/ADCT).
   - `secondarySources`: each cross-check source (normas.leg.br when it articulates the norm, otherwise Câmara LEGIN), with `verified` (date, usable or not, why). Record the verification in an ADR when it decides something (ADR 0002 for the CDC). With none usable, the norm runs under the `unconfirmed` rule. Build the norm once and read its cross-source findings (ADR 0004): fix the parser for every difference that is ours, and add each remaining source difference to `src/review/known-divergences.ts` with its reason, until the build has no `problem`.
   - `knownQuirks`: what is odd about this page, as found. It is a record, not a switch: each quirk gets a golden-set dispositivo.
   - `citedAs` and `deferredActs`, only when an amending act still defers changes to the norm: how acts name it ("Constituição Federal") and the official pages of those acts, which then must be in every source that builds the norm (ADR 0003).
3. **Write `test/<key>.test.ts`** (seam 1, through `build()` only):
   - **Golden set:** about 50 dispositivos. Read each expected value (text, label, path, status, annotations and their links) from the raw HTML, never from the parser. Cover each quirk, the first and last article, lettered articles, vetoed or revoked items, and the most-cited articles.
   - **Invariants:** unique ids; monotonic numbering; exact counts of caputs, parágrafos, incisos and alíneas, counted by hand on the page; vetoed/revoked counts; no annotation residue; every amending act recognised.
   - **Snapshot:** `toMatchFileSnapshot("./snapshots/<key>.md")`. Generate it with `pnpm vitest run -u`. Then check that every line of the page between the enacting clause and `Brasília, …` landed in it: as a heading, as a dispositivo, or joined to one (Pena lines, quoted text).
4. **When the build fails** ("Unrecognised line inside artN", "parsed twice", "never closed"), evolve the generic parser in `src/pipeline/`:
   - The fix must be a rule that holds for any Planalto page.
   - Exercise it through a golden-set entry or a scenario fixture in `test/fixtures/`.
   - Keep every other norm's golden set green and its snapshot unchanged. Comparing the full JSON of the CF compiled, CF full-history and hygiene builds before and after is a cheap extra check.
5. **Per-norm hook: the last resort.** If a quirk truly can't be a generic rule, a norm may have at most one documented hook. Needing a second one means the generic parser should evolve instead. The CF, ADCT and CDC have none.
6. **Update the Map** in `AGENTS.md` for new paths, then run `pnpm verify`.

---

# Como adicionar uma norma (PT)

Uma norma é um manifesto declarativo mais os testes dela. O pipeline não tem código específico por norma. O CDC entrou assim (#7): veja `src/norms/cdc.ts` e `test/cdc.test.ts`.

1. **Capture a página.** Salve a página compilada do Planalto numa nova pasta datada em `fixtures/`. Grave os bytes exatos, uma entrada no `index.json` (URL, codificação, headers, `retrievedAt` do header `Date`, SHA-256, tamanho) e a proveniência no README, em EN e PT.
   - Use GET anônimo com `Mozilla/5.0 (compatible; akoma/<versão>)`.
   - Nunca coloque identificador pessoal no pedido nem no arquivo versionado. Se os metadados da página nomearem alguém, remova o nome como edição documentada.
2. **Escreva o manifesto** em `src/norms/<chave>.ts` e inclua-o em `src/norms/index.ts`:
   - `key`, `title`, a `urn` LexML, mais `type` e `date`. O build falha se não baterem com a URN.
   - `primaryUrl`: a página do Planalto. `startAnchor`/`endAnchor` só quando a norma divide a página com outra.
   - `secondarySources`: cada fonte de conferência, com `verified` (data, utilizável ou não, por quê). Registre a verificação numa ADR quando ela decidir algo. Sem fonte utilizável, vale a regra `unconfirmed`. Monte a norma uma vez e leia os achados da conferência entre fontes (ADR 0004): corrija o parser em toda diferença que for nossa e registre cada diferença restante entre as fontes em `src/review/known-divergences.ts`, com o motivo, até o build não ter nenhum `problem`.
   - `knownQuirks`: as peculiaridades da página. É registro, não chave: cada uma ganha um dispositivo no golden set.
   - `citedAs` e `deferredActs`, só quando uma emenda ainda adia mudanças na norma: como os atos a nomeiam e as páginas oficiais desses atos, que passam a ser exigidas em toda fonte que monta a norma (ADR 0003).
3. **Escreva `test/<chave>.test.ts`** (seam 1, só via `build()`):
   - **Golden set:** cerca de 50 dispositivos, com valores esperados lidos do HTML bruto, nunca do parser.
   - **Invariantes:** ids únicos, numeração monotônica, contagens exatas feitas à mão na página, vetados/revogados, nenhum resíduo de anotação, todo ato reconhecido.
   - **Snapshot:** gere com `pnpm vitest run -u`. Depois confira que cada linha da página, da cláusula de promulgação até `Brasília, …`, foi parar nele.
4. **Quando o build falhar**, evolua o parser genérico em `src/pipeline/`:
   - A correção deve ser uma regra válida para qualquer página do Planalto.
   - Ela precisa ser exercitada por um item do golden set ou por uma fixture de cenário.
   - O golden set das outras normas tem de continuar verde, e os snapshots delas sem mudança.
5. **Hook por norma é o último recurso:** no máximo um, documentado. Precisar de um segundo significa que o parser genérico deve evoluir. CF, ADCT e CDC não têm nenhum.
6. **Atualize o Map** do `AGENTS.md` e rode `pnpm verify`.

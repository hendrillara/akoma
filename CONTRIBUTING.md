# Como contribuir / Contributing

**Português** · [English](#english)

## A regra principal

**Nenhum dado jurídico é editado à mão.** O texto das leis no Akoma vem só das fontes oficiais, pelo build. Os arquivos gerados (`dataset/`, quando existir, e os snapshots em `test/snapshots/`) nunca são editados diretamente, nem para corrigir um erro óbvio. Se o texto está errado, a correção vem do parser, de um manifesto ou de uma nova captura da fonte, e o dado é gerado de novo.

## O que aceitamos em PR

- **Parser** (`src/pipeline/`): regras novas ou corrigidas que valem para qualquer página do Planalto. Veja o passo 4 de [`docs/adding-a-norm.md`](docs/adding-a-norm.md).
- **Manifestos** (`src/norms/`): normas novas e correções nas existentes, seguindo [`docs/adding-a-norm.md`](docs/adding-a-norm.md).
- **Testes** (`test/`): entradas de golden set, cenários, perguntas para a avaliação da busca.

Para o resto (Worker, camadas de revisão, o dicionário de sinônimos em `data/synonyms.json`, as divergências conhecidas em `src/review/known-divergences.ts`, a documentação), abra uma issue antes. Essas mudanças são decididas pelo mantenedor, caso a caso.

## Texto errado? A issue de divergência

Se um dispositivo parece diferente do texto oficial, abra uma issue com o modelo **"Divergência de texto / Text divergence"**: a norma, o dispositivo (o id, como `art5_cpt_inc10`, ou como impresso, como art. 5º, inciso X) e o que parece errado.

Abrir a issue dispara uma nova conferência automática daquele dispositivo: o Akoma lê de novo a página do Planalto, compara com o dataset publicado e com a fonte secundária, e publica o resultado na própria issue. Uma divergência confirmada vira um PR de correção pelo job diário, com a revisão normal de três camadas; uma não confirmada recebe um comentário dizendo o que as fontes mostram e o rótulo `needs-triage`, porque a reconferência usa o mesmo leitor que montou o dataset e não enxerga um erro dele: o mantenedor revisa o relato. Cada dispositivo é reconferido no máximo uma vez por dia. Os detalhes estão em [`docs/publishing.md`](docs/publishing.md).

## Como trabalhar

- `pnpm install`, depois `pnpm verify` (typecheck, os testes e a conferência do Map do `AGENTS.md`). Precisa passar antes de abrir o PR. Não usa rede.
- Os testes só exercitam duas fronteiras. Fronteira 1: os pontos de entrada do pipeline, rodados de ponta a ponta sobre capturas gravadas (`build()`, o job diário `runDailyJob`, a reconferência `runRecheck`, e `buildDataset`/`checkDataset`, que são o `pnpm build:dataset` e o `pnpm check:dataset`). Fronteira 2: HTTP (`createHandler(dataset)(request)` e o Worker de `createWorker`). Sem testes de detalhes internos do parser. Uma exceção documentada: o adaptador da API do Claude (`claudeReviewer`) é testado contra respostas da API escritas à mão (um `fetch` falso), porque o contrato dele é com a API, não com o Akoma. Três suítes ainda chamam diretamente o que o job chama, sobre dois builds: o relatório de mudanças (`changes.test.ts`), a camada 3 com um revisor falso (`llm-review.test.ts`) e os achados da camada 2 (`cross-source.test.ts`); passá-las pelo `runDailyJob` é o próximo passo.
- Os valores esperados vêm da fonte oficial lida por você (o HTML gravado), nunca da saída do código.
- Um snapshot de texto completo que falha quer dizer que o texto mudou. Regere com `pnpm vitest run -u` só quando uma correção do parser ou uma captura nova explica cada linha da diferença.
- Capturas novas vão numa pasta datada em `fixtures/`, com uma entrada com checksum em `index.json` e a proveniência no README (EN + PT).
- Requisições a sites do governo: user agent `Mozilla/5.0 (compatible; akoma/<versão>)`, GETs condicionais, ritmo baixo. Nunca ponha um identificador pessoal (nome, e-mail) numa requisição, num arquivo commitado ou num teste.
- Documentação técnica em inglês e português; código e schema em inglês; o conteúdo jurídico literal, em português.

O PR deve citar a issue (`#n`). Ao contribuir, você aceita que o código fica sob a [MIT](LICENSE) e os dados sob a [CC0](LICENSE-DATA.md).

---

<a id="english"></a>

## English

### The main rule

**No legal data is edited by hand.** The text of the laws in Akoma comes only from the official sources, through the build. Generated files (`dataset/`, once it exists, and the snapshots in `test/snapshots/`) are never edited directly, not even to fix an obvious error. If the text is wrong, the fix comes from the parser, a manifest or a new capture of the source, and the data is regenerated.

### What PRs we accept

- **Parser** (`src/pipeline/`): new or fixed rules that hold for any Planalto page. See step 4 of [`docs/adding-a-norm.md`](docs/adding-a-norm.md).
- **Manifests** (`src/norms/`): new norms and fixes to existing ones, following [`docs/adding-a-norm.md`](docs/adding-a-norm.md).
- **Tests** (`test/`): golden-set entries, scenarios, questions for the search evaluation.

For anything else (the Worker, the review layers, the synonym dictionary in `data/synonyms.json`, the known divergences in `src/review/known-divergences.ts`, the docs), open an issue first. The maintainer decides those changes case by case.

### Wrong text? The divergence issue

If a dispositivo looks different from the official text, open an issue from the **"Divergência de texto / Text divergence"** template: the norm, the dispositivo (its id, such as `art5_cpt_inc10`, or as printed, such as art. 5º, inciso X) and what looks wrong.

Opening the issue starts an automatic recheck of that dispositivo: Akoma reads Planalto's page again, compares it with the published dataset and with the secondary source, and posts the result on the issue. A confirmed divergence becomes a correction PR from the daily job, through the normal three-layer review; an unconfirmed one gets a comment explaining what the sources say and the `needs-triage` label, since the recheck uses the parser that built the dataset and cannot see that parser's own errors: the maintainer reviews the report. Each dispositivo is rechecked at most once a day. The details are in [`docs/publishing.md`](docs/publishing.md).

### How to work

- `pnpm install`, then `pnpm verify` (typecheck, the tests and the `AGENTS.md` Map check). It must pass before you open the PR. It needs no network.
- Tests exercise two seams only. Seam 1: the pipeline's entry points, run end to end over recorded captures (`build()`, the daily job `runDailyJob`, the divergence recheck `runRecheck`, and `buildDataset`/`checkDataset`, which are `pnpm build:dataset` and `pnpm check:dataset`). Seam 2: HTTP (`createHandler(dataset)(request)` and the Worker from `createWorker`). No tests of parser internals. One documented exception: the Claude API adapter (`claudeReviewer`) is tested against handwritten API responses (a fake `fetch`), since its contract is with the API, not with Akoma. Three suites still call what the job calls directly, over two builds: the change report (`changes.test.ts`), layer 3 with a fake reviewer (`llm-review.test.ts`) and layer 2's findings (`cross-source.test.ts`); routing them through `runDailyJob` is the next step.
- Expected values come from the official source as you read it (the recorded HTML), never from the code's output.
- A failing full-text snapshot means the text changed. Regenerate with `pnpm vitest run -u` only when a parser fix or a new capture explains every line of the diff.
- New captures go in a dated folder under `fixtures/`, with a checksummed entry in its `index.json` and provenance in its README (EN + PT).
- Requests to government sites: user agent `Mozilla/5.0 (compatible; akoma/<version>)`, conditional GETs, low rates. Never put a personal identifier (name, email) in a request, a committed file or a test.
- Technical docs in English and Portuguese; code and schema in English; legal content verbatim in Portuguese.

The PR should reference its issue (`#n`). By contributing, you agree that code is licensed under [MIT](LICENSE) and data under [CC0](LICENSE-DATA.md).

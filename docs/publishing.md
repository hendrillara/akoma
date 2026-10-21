# Publishing: the daily job, the published dataset and the run status

Akoma keeps itself current with one scheduled GitHub Actions workflow, `.github/workflows/publish.yml`. It runs daily at 09:17 UTC (06:17 in Brasília), after midnight there so a deferred change is promoted on its own start date (ADR 0003). The workflow runs `node scripts/publish.ts`, a thin wrapper around `runDailyJob` (`src/publish/job.ts`), and every outside effect goes through a port.

## What a run does

1. **Pre-filter.** It sends one conditional GET per primary page (`If-None-Match` / `If-Modified-Since`, with the validators the published dataset recorded in `dataset.json` `pages`). A page counts as moved only when its content without `<script>` elements differs, since Planalto's F5 WAF injects a fresh token into every response.
2. **Rebuild.** It rebuilds when a page moved, or when a pending change without a hold `note` has reached its `effectiveFrom`. Nothing on Planalto moves on that date (ADR 0003). The build gets the run's date in Brasília explicitly, reads fresh full pages, and has `datasetVersion` = that date.
3. **Detect and review.** It compares the new build with the committed dataset. If no dispositivo changed, the run ends (`no-change`). Otherwise it runs layer 1 (`reviewGates`, plus `reviewDeferredActs`: a constitutional amendment new to the dataset whose vigência clause defers a change that no manifest lists in `deferredActs` blocks, naming the act to add; the page shows such a change only as a "(Vigência)" note), layer 2 (the outcomes the build recorded, `crossSourceFindings`) and layer 3 (`reviewLlm`). Without `ANTHROPIC_API_KEY`, layer 3 returns a blocking finding ("LLM review not run: no API key"); it never passes silently.
4. **Write.** It writes the new `dataset/` and the pages it read, as `fixtures/<day>-daily/` (the recorded-source format: `index.json` with checksums, headers and retrieval instants, plus a generated README). A page it could not fetch is listed under `unavailable`.
5. **Test.** It runs `pnpm verify` itself. CI does not run on a PR opened with the workflow token, so the job's own run is the gate. A failure is a blocking finding.
6. **Publish.** It force-pushes the branch `publish/daily`, then opens the PR or updates the one still open. It never opens a second one. On `merge` it merges the PR (squash) and dispatches `deploy.yml`, because a merge made with the workflow token starts no `push` workflow; `workflow_dispatch` is the exception. On `needs-human` it adds the `needs-human` label, so the maintainer is notified, and leaves the PR open.
7. **Issues and status.** It writes the run status (below) and manages two issues, each deduplicated by its label:
   - `publish-failure`: opened on the first failed run, commented on by later failures, closed by the next run that does not fail. A failure outside the job (checkout, install) is reported by the workflow's last step under the same label.
   - `source-outage`: opened when a source has been unreachable for more than 48 hours (measured from its first failed request since its last success), and closed once no source is.

   A source that is down for a shorter time makes the run end as `unreachable` (when it is a primary page), or leaves the secondary check `unconfirmed` (ADR 0004). Neither is a job failure.

The PR body states the verdict and what the job did with it, the test result and the reviewer model, then the change report with every finding. Changes that cite only acts other than constitutional amendments (a Lei amending the CDC, say) always escalate: in v1, target matching and the LLM reviewer read only constitutional amendments. When that happens, the body explains it. A body is cut to GitHub's 65,536-character limit at a line, and the full report is the run's `change-report` artifact.

### Dry run

`node scripts/publish.ts --dry-run` does everything except push, open, merge or comment. Its GitHub and working tree are in memory. It writes to `out/dry-run/`: `pr-body.md`, `change-report.md`, `actions.txt` (what it would do on GitHub), `status.json`, `badge.json`, `result.json`, and `workspace/` (the capture and `dataset/` it would commit). Options:

- `--recorded <folder>…` replays captures instead of fetching, e.g. `--recorded fixtures/2026-10-20 fixtures/2026-10-21 test/fixtures/refresh/ec142 --now 2026-10-23T09:00:00Z`;
- `--now <instant>` sets the run's instant;
- `--status <file>` gives a previous run status.

The workflow's manual trigger has a `dry_run` input that runs it against the live sources. `test/publish.test.ts` runs the job through the same entry point with these in-memory ports.

## The published dataset is a regeneration

`dataset/` (the output of `datasetFiles()`: per-article JSON and Markdown, `dataset.json`, `search-index.json`, `status.json`, `_headers`) is generated, never edited. `pnpm build:dataset` rebuilds it from the committed captures: every dated folder under `fixtures/` (`YYYY-MM-DD` or `YYYY-MM-DD-daily`), later folders winning for the same URL. The build date and the version come from the latest capture's `capturedOn`, never from the clock or git. `pnpm check:dataset`, part of `pnpm verify` and so of CI, fails when the committed `dataset/` differs from that regeneration, and names every changed, missing or extra file. So:

- a hand edit to generated data fails CI;
- a parser, manifest or capture change must be followed by `pnpm build:dataset`, with the regenerated `dataset/` committed in the same PR. That includes merging a branch that touches them: regenerate after the merge;
- the daily job's PR passes the check, because its capture holds the exact bytes it built from. Personal data in page metadata (`<meta>` author/changedby/creator… in any attribute order or quoting, Office `<o:Author>`, `<o:LastAuthor>`, `<o:Manager>`; on LEGIN, a staff member's name) is redacted before anything reads a page (`src/sources/redact.ts`, applied by the job to every source), so the build, the capture, the reports and the artifacts never hold it.

## Run status and badge

The run status changes on every run, so it is not in `dataset/`, whose files only change through a reviewed PR. The job force-pushes it, one commit, to the `status` branch:

- `status.json` holds `lastCheck` (instant, Brasília day, outcome, message, run link) and `lastChange` (the latest change: version, count, verdict, merged or not, PR). It also holds `openPullRequest` when a publish PR is still waiting, `tests` (the latest `pnpm verify` the job ran) and `sources`. Each source records its last attempt, last success, `failingSince`, last error and `lagHours`, the hours since the job last fetched it successfully. Primary pages are requested on every run; secondary sources and act pages only on runs that rebuild, so their lag also grows on quiet days.
- `badge.json` is a [shields.io endpoint badge](https://shields.io/badges/endpoint-badge). It reads "current · checked <day>", "change awaiting review", "tests failing", "source unreachable", "source outage" or "job failed".

README badge (for #19):

```markdown
[![Akoma status](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fhendrillara%2Fakoma%2Fstatus%2Fbadge.json)](https://github.com/hendrillara/akoma/blob/status/status.json)
```

## What the repository needs (maintainer)

The workflow changes no settings. It needs:

- **Settings → Actions → General → Workflow permissions: "Allow GitHub Actions to create and approve pull requests"** enabled (today it is off, `can_approve_pull_request_reviews: false`). Without it the workflow token cannot open the PR, and the run fails into the `publish-failure` issue.
- **`main` must accept a merge without required status checks** (no branch protection today). CI does not run on the bot's PR, so a required check would never report, and the job's own `pnpm verify` is the gate.
- **Secret `ANTHROPIC_API_KEY`** (not set yet; the maintainer's choice) and, optionally, **variable `AKOMA_REVIEW_MODEL`** (default `claude-opus-5`). Without the key, every change that needs layer 3 goes to `needs-human`.
- **Workflow token permissions**, declared in the workflow: `contents: write` (the `publish/daily` and `status` branches, the merge), `pull-requests: write`, `issues: write` (issues and the labels `needs-human`, `publish-failure` and `source-outage`, which the job creates when missing) and `actions: write` (dispatching `deploy.yml`). Every action is pinned to a commit SHA, and pnpm comes from `corepack`.
- **Where the secrets reach.** `GH_TOKEN` (the workflow token) and `ANTHROPIC_API_KEY` are set on the publish step only, never on the install, and `scripts/publish.ts` runs `pnpm verify` without them. The checkout keeps no token (`persist-credentials: false`): git pushes through gh's credential helper (`gh auth setup-git`), which needs `GH_TOKEN` and so works only inside the publish step.
- **What the guard does not prove.** `check:dataset` shows that `dataset/` is the regeneration of the committed captures, not that a capture is genuine. A PR that adds a crafted `-daily` folder with matching checksums would pass CI, so a capture folder in a PR that is not the job's own needs a human look.

---

# Publicação: o job diário, o dataset publicado e o status (PT)

O Akoma se mantém atualizado com um workflow agendado do GitHub Actions, `.github/workflows/publish.yml`. Ele roda todo dia às 09:17 UTC (06:17 em Brasília), depois da meia-noite de lá, para que uma mudança diferida seja promovida na própria data de início (ADR 0003). O workflow chama `node scripts/publish.ts`, que envolve o `runDailyJob` (`src/publish/job.ts`); todo efeito externo passa por uma porta.

## O que uma execução faz

1. **Pré-filtro:** uma requisição condicional por página principal, com os validadores gravados no `dataset.json` (`pages`). Uma página só conta como alterada se o conteúdo sem `<script>` mudou, porque o WAF do Planalto injeta um token novo em toda resposta.
2. **Novo build** quando uma página mudou ou quando uma mudança pendente sem `note` de retenção chegou ao seu `effectiveFrom`; nessa data nada muda no Planalto (ADR 0003). O build recebe explicitamente a data da execução em Brasília, lê as páginas completas de novo e usa essa data como `datasetVersion`.
3. **Detecção e revisão:** compara com o dataset commitado. Se nenhum dispositivo mudou, a execução termina (`no-change`). Senão, roda as camadas 1, 2 (os resultados gravados pelo build) e 3. A camada 1 inclui o `reviewDeferredActs`: uma emenda nova cuja cláusula de vigência adia uma mudança que nenhum manifesto lista em `deferredActs` bloqueia o merge e diz qual ato acrescentar, porque a página mostra essa mudança só como uma nota "(Vigência)". Sem `ANTHROPIC_API_KEY`, a camada 3 gera um achado bloqueante ("LLM review not run: no API key"); nunca passa calada.
4. **Gravação:** grava o novo `dataset/` e as páginas lidas, em `fixtures/<dia>-daily/`, com `index.json` (checksums, headers, instantes) e um README gerado. Uma página inacessível fica listada em `unavailable`.
5. **Testes:** roda o `pnpm verify` ele mesmo, porque o CI não roda num PR aberto com o token do workflow. Uma falha é um achado bloqueante.
6. **Publicação:** faz force-push do branch `publish/daily` e abre o PR, ou atualiza o que ainda está aberto; nunca abre um segundo. Com `merge`, faz o merge (squash) e dispara o `deploy.yml`, porque um merge feito com o token do workflow não dispara workflows de `push` (o `workflow_dispatch` é a exceção). Com `needs-human`, põe o rótulo `needs-human`, o que notifica o mantenedor, e deixa o PR aberto.
7. **Issues e status:** grava o status da execução (abaixo) e cuida de duas issues, cada uma deduplicada pelo seu rótulo:
   - `publish-failure`: aberta na primeira falha, comentada nas seguintes e fechada pela próxima execução sem falha. Uma falha fora do job (checkout, instalação) é registrada pelo último passo do workflow, com o mesmo rótulo.
   - `source-outage`: aberta quando uma fonte está inacessível há mais de 48 horas, contadas da primeira falha desde o último sucesso, e fechada quando nenhuma está.

   Uma queda mais curta termina a execução como `unreachable` (se for uma página principal) ou deixa a conferência secundária como `unconfirmed` (ADR 0004). Nenhum dos dois casos é falha do job.

O corpo do PR traz o veredito e o que o job fez com ele, o resultado dos testes e o modelo revisor, e depois o relatório de mudanças com todos os achados. Mudanças que citam só atos que não são emendas constitucionais (uma lei que altera o CDC, por exemplo) sempre escalam, porque na v1 a conferência de alvos e o revisor LLM só leem emendas constitucionais; quando isso acontece, o corpo explica. Um corpo acima do limite do GitHub (65.536 caracteres) é cortado numa quebra de linha, e o relatório completo fica no artefato `change-report` da execução.

### Execução de teste (dry run)

`node scripts/publish.ts --dry-run` faz tudo, menos push, PR, merge ou comentário: o GitHub e a árvore de trabalho ficam em memória. O resultado vai para `out/dry-run/`: corpo do PR, relatório, ações que faria, status, badge e, em `workspace/`, a captura e o `dataset/` que commitaria. As opções são as mesmas da seção em inglês: `--recorded <pastas…>`, `--now <instante>` e `--status <arquivo>`. O disparo manual do workflow tem a entrada `dry_run`, que roda contra as fontes reais.

## O dataset publicado é uma regeneração

O `dataset/` é gerado, nunca editado. O `pnpm build:dataset` o refaz a partir das capturas commitadas: todas as pastas datadas de `fixtures/`, e a mais recente prevalece para a mesma URL. A data e a versão vêm do `capturedOn` da captura mais recente, nunca do relógio nem do git. O `pnpm check:dataset`, que faz parte do `pnpm verify` e portanto do CI, falha quando o `dataset/` commitado difere dessa regeneração, e nomeia cada arquivo alterado, ausente ou sobrando. Assim:

- uma edição manual de dado gerado falha no CI;
- uma mudança de parser, manifesto ou captura exige rodar o `pnpm build:dataset` e commitar o resultado no mesmo PR, inclusive depois de um merge que mexa neles;
- o PR do job passa, porque a captura dele guarda exatamente os bytes que o build leu. Dados pessoais nos metadados da página (`<meta>` author, changedby, creator… em qualquer ordem de atributos, e `<o:Author>`, `<o:LastAuthor>`, `<o:Manager>` do Office) viram `[redacted]` antes de qualquer leitura (`src/sources/redact.ts`), então nem o build, nem a captura, nem os relatórios os guardam.

## Status da execução e badge

O status muda a cada execução, então não fica no `dataset/`. O job o grava, com force-push de um único commit, no branch `status`:

- `status.json` traz a última checagem e a última mudança, o PR ainda aberto, os últimos testes e as fontes (último sucesso, `failingSince`, último erro, `lagHours`).
- `badge.json` está no formato de badge endpoint do shields.io. O trecho do README está na seção em inglês acima, para o #19.

## O que o repositório precisa (mantenedor)

O workflow não altera configurações. Ele precisa de:

- **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"** ativado. Hoje está desligado; sem isso, o token do workflow não abre o PR e a execução cai na issue `publish-failure`.
- **`main` aceitando merge sem checks obrigatórios.** O CI não roda no PR do bot, e o `pnpm verify` do próprio job é o portão.
- **O secret `ANTHROPIC_API_KEY`**, ainda não definido (decisão do mantenedor), e, opcionalmente, a variável `AKOMA_REVIEW_MODEL`.
- **As permissões do token declaradas no workflow:** `contents`, `pull-requests`, `issues` e `actions`, todas com `write`. As actions estão fixadas por SHA de commit, e o pnpm vem do `corepack`.
- **Onde os segredos chegam:** o `GH_TOKEN` e a `ANTHROPIC_API_KEY` só existem no passo de publicação, nunca na instalação, e o `pnpm verify` do job roda sem eles. O checkout não guarda token (`persist-credentials: false`); o git faz push pelo helper de credenciais do gh.
- **O que a checagem não prova:** o `check:dataset` mostra que o `dataset/` é a regeneração das capturas commitadas, não que uma captura é autêntica. Uma pasta `-daily` forjada com checksums coerentes passaria no CI; por isso, uma pasta de captura num PR que não seja do job precisa de revisão humana.

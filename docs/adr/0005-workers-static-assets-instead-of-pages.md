# ADR 0005: Serve the dataset files with Workers static assets, not Cloudflare Pages

**Status:** accepted for v1 (2026-10-21); a deviation from spec #1, which the maintainer confirms · **Tickets:** #17 (deploy preparation), #12 (the committed `dataset/`)

## Context

Spec #1 says the static dataset files (per-article JSON and Markdown, the whole norm's Markdown, `search-index.json`, `status.json`, `dataset.json`) are hosted on Cloudflare Pages, next to a Worker that serves the REST API and the remote MCP endpoint at `akoma.hendril.dev`.

The API and MCP must run in a Worker anyway. The question is whether the files go to a separate Pages project or to the same Worker.

## Evidence

From Cloudflare's documentation, read on 2026-10-20 (Workers static assets, Workers limits and pricing, and the "migrate from Pages" guide):

- Requests to a Worker's static assets are free and unlimited, and are served without running the Worker.
- Limits are 20,000 files per version on Free and 25 MiB per file. The dataset is about 1,115 files, the largest (`dataset.json`) about 5.5 MB.
- `_headers` (and `_redirects`) work in Workers static assets as in Pages. Akoma needs `_headers` for open CORS and `nosniff` on the files.
- The migration guide presents Workers as a superset of Pages for this use, with parity for these files.
- `run_worker_first` routes chosen paths (`/v1/*`, `/mcp`) to the Worker even when a file could match, so the API can never be shadowed by a dataset file.

## Decision

One Worker, `hendril-dev-akoma`, on the custom domain `akoma.hendril.dev` (`wrangler.jsonc`):

- `assets.directory` is the committed `dataset/` folder. Its files are served at their own paths, without running the Worker, with the headers in `dataset/_headers`.
- `/v1/*` and `/mcp` always run the Worker (`run_worker_first`), as do `/llms.txt` and `/usage.md`, since no file takes those paths.
- The Worker bundles `dataset/dataset.json` and never reads an asset, so it needs no `ASSETS` binding.

No Pages project is created.

## Consequences

- One deploy (`wrangler deploy`, `.github/workflows/deploy.yml`) ships the API, MCP and files together. They cannot drift apart: each version serves exactly one committed dataset.
- One origin: no cross-origin calls between the files and the API, and one hostname for agents.
- One token scope: Workers Scripts and Workers Routes, with no Pages permission (`docs/deploy.md`).
- Static file requests do not count toward the Worker's request quota, as they would not on Pages either.
- What the spec's Pages would have added, preview deployments per branch, is not used: `preview_urls` is off, since the daily job merges reviewed PRs to `main`.
- If Cloudflare ever separates the products' limits or pricing in a way that matters, moving the files to Pages means only a second deploy target for `dataset/`: the files and `_headers` are already in Pages' format.

---

# ADR 0005 (PT): Servir os arquivos do dataset com os static assets do Workers, não com o Cloudflare Pages

**Status:** aceita para a v1 (21/10/2026); um desvio do spec #1, que o mantenedor confirma · **Tickets:** #17 (preparação do deploy), #12 (o `dataset/` versionado)

## Contexto

O spec #1 diz que os arquivos estáticos do dataset (JSON e Markdown por artigo, o Markdown da norma inteira, `search-index.json`, `status.json`, `dataset.json`) ficam no Cloudflare Pages, ao lado de um Worker que serve a API REST e o MCP remoto em `akoma.hendril.dev`.

A API e o MCP precisam rodar num Worker de qualquer jeito. A questão é se os arquivos vão para um projeto Pages separado ou para o mesmo Worker.

## Evidência

Da documentação da Cloudflare, lida em 20/10/2026 (static assets do Workers, limites e preços do Workers, e o guia de migração do Pages):

- As requisições aos static assets de um Worker são gratuitas e ilimitadas, e são servidas sem rodar o Worker.
- Os limites são 20.000 arquivos por versão no plano Free e 25 MiB por arquivo. O dataset tem cerca de 1.115 arquivos; o maior (`dataset.json`) tem cerca de 5,5 MB.
- O `_headers` (e o `_redirects`) funciona nos static assets do Workers como no Pages. O Akoma precisa do `_headers` para CORS aberto e `nosniff` nos arquivos.
- O guia de migração apresenta o Workers como um superconjunto do Pages para este uso, com paridade para esses arquivos.
- O `run_worker_first` manda caminhos escolhidos (`/v1/*`, `/mcp`) para o Worker mesmo quando um arquivo poderia casar, então nenhum arquivo do dataset esconde a API.

## Decisão

Um Worker, `hendril-dev-akoma`, no domínio próprio `akoma.hendril.dev` (`wrangler.jsonc`):

- `assets.directory` é a pasta `dataset/` versionada. Os arquivos saem nos próprios caminhos, sem rodar o Worker, com os cabeçalhos de `dataset/_headers`.
- `/v1/*` e `/mcp` sempre rodam o Worker (`run_worker_first`), assim como `/llms.txt` e `/usage.md`, porque nenhum arquivo ocupa esses caminhos.
- O Worker embute o `dataset/dataset.json` e nunca lê um asset, então não precisa do binding `ASSETS`.

Nenhum projeto Pages é criado.

## Consequências

- Um deploy (`wrangler deploy`, `.github/workflows/deploy.yml`) leva API, MCP e arquivos juntos. Eles não se desencontram: cada versão serve exatamente um dataset versionado.
- Uma origem: nada de chamadas entre origens entre os arquivos e a API, e um só hostname para os agentes.
- Um escopo de token: Workers Scripts e Workers Routes, sem permissão de Pages (`docs/deploy.md`).
- As requisições de arquivo estático não contam na cota de requisições do Worker, como também não contariam no Pages.
- O que o Pages do spec acrescentaria, deploys de preview por branch, não é usado: `preview_urls` está desligado, porque o job diário faz merge de PRs revisados na `main`.
- Se um dia a Cloudflare separar limites ou preços dos produtos de um jeito que importe, levar os arquivos para o Pages é só um segundo destino de deploy para o `dataset/`: os arquivos e o `_headers` já estão no formato do Pages.

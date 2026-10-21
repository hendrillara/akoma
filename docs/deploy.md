# Deploying akoma.hendril.dev

Akoma runs as one Cloudflare Worker, `hendril-dev-akoma`, on the custom domain `akoma.hendril.dev` (`wrangler.jsonc`). It claims no other hendril.dev route. The other hendril.dev Workers own path routes on the apex (`hendril.dev/*`, `hendril.dev/acesa*`…), and a custom domain on a subdomain matches none of them. The zone's route map is `hendril-portfolio/README.md` § "Deployment boundaries".

One deploy uploads two things, both from the committed `dataset/` folder (written by `pnpm build:dataset`, #12):

| Path | Served by | What |
|---|---|---|
| `/v1/…` (`norms`, `provisions`, `search`, `status`) and `/mcp` | the Worker (`src/worker/main.ts`), always (`run_worker_first`) | the REST API and the remote MCP endpoint, bundled with `dataset/dataset.json` |
| every file in `dataset/`, at its own path (`/cf/art5.json`, `/cf/art5.md`, `/cf.md`, `/status.json`, `/search-index.json`, `/dataset.json`) | Workers static assets, without running the Worker | the downloadable dataset, with the headers in `dataset/_headers` (open CORS) |

The spec said Cloudflare Pages. Workers static assets do the same job inside the same Worker: one deploy, one domain, and file requests are free and unlimited.

## How requests are handled

- **Edge cache.** The CDN does not cache a Worker's answers on its own, because a Worker runs in front of the cache. Workers Cache (`"cache": { "enabled": true }`, wrangler ≥ 4.69) stores them by their `Cache-Control` alone: no Cache API code is needed. Successful answers are `public, max-age=300, s-maxage=3600`, misses `public, max-age=60`. A 429, every HEAD answer and every `/mcp` answer are `no-store`. GET and HEAD share one cache entry, and an empty HEAD body must never reach a GET. MCP calls are POSTs, which are never cached anyway. The cache key includes the Worker version, so each deploy, and so each dataset, starts with an empty cache.
- **Cached hits skip the rate limiter.** A hit is answered without running the Worker, so it costs no CPU and is never counted. It is still a billed request: Free gives 100,000 a day, and requests for static files are not counted. The limiter therefore bounds the uncached path, which is where CPU is spent. A new query string is a new cache key, so it is a miss and is limited.
- **Rate limiting.** 120 requests a minute per IP (`RATE_LIMIT` in `src/worker/worker.ts`; `ratelimits` in `wrangler.jsonc` repeats it). The Workers rate-limit binding counts per Cloudflare location. If it is not bound, the Worker falls back to an in-memory window per isolate, which is looser but never absent. `/mcp` has its own budget of the same size per IP (key `mcp:<ip>`). A 2025-protocol MCP session spends about four requests on its handshake, and REST and MCP use from the same IP must not starve each other.
- **CPU.** The dataset is evaluated and indexed at global scope, once per isolate. That costs 43–47 ms in `wrangler check startup` (bundle 6.5 MB, 889 KB gzip, MCP SDK included). It is done once per isolate, within the 1 s startup limit, instead of on every request (10 ms of CPU on Free). Cloudflare's limits page does not say whether startup work counts toward the CPU of the first request an isolate serves, so step 7 checks that first request. In Node, warm REST requests measured 0.5–1.5 ms of CPU and warm MCP tool calls 2–3 ms. The first MCP call in a fresh process measured about 30 ms, which is the SDK's own warm-up. Cloudflare tolerates infrequent overruns, but this is the request most likely to go over the limit. None of these numbers is a production measurement: step 7 below checks them.
- **Locally**, `pnpm dev` (`wrangler dev`, after `dataset/` exists) simulates the rate-limit binding but not Workers Cache: no `cf-cache-status` header appears. `/mcp` answers there in both protocol eras (checked with raw JSON-RPC).

## Deploy credentials

Automatic deploys need one repository secret, `CLOUDFLARE_API_TOKEN`. Create it under *Account API tokens → Create Token → "Edit Cloudflare Workers"* template, then narrow it:

- **Account resources:** this account only. **Zone resources:** `hendril.dev` only.
- **Expected minimum:** Account › Workers Scripts › Edit, and Zone › Workers Routes › Edit. Remove the template's KV, R2 and Pages permissions.
- **Not verified:** this set has not been tried against the API yet. If the custom-domain step answers 403, add Zone › DNS › Edit.

The account id is committed in `wrangler.jsonc`. It is not a secret. If you would rather keep it out of a public repo, delete it there and set `CLOUDFLARE_ACCOUNT_ID` as a repository variable in the workflow.

## First deploy (the maintainer runs and approves each step)

0. **Pre-checks.**
   - `dataset/` is committed: #12 has merged and `dataset/dataset.json` exists.
   - `pnpm install && pnpm verify` passes.
   - DNS for `hendril.dev` has no `akoma` record (dashboard → hendril.dev → DNS → Records). An existing CNAME blocks a custom domain.
   - `pnpm exec wrangler deploy --dry-run` bundles without errors and lists `env.RATE_LIMITER`.
1. **Log in.** Run `pnpm exec wrangler login` (browser OAuth), then `pnpm exec wrangler whoami`. The account must match `account_id`.
2. **Deploy.** Run `pnpm exec wrangler deploy`. The output names the route `akoma.hendril.dev (custom domain)`, the rate-limit binding and "Worker Startup Time". The custom domain creates its DNS record and certificate, which can take a few minutes.
3. **If the deploy is refused**, read the error and fix only that block:
   - **`ratelimits`** (not available on this plan): delete the `ratelimits` block and deploy again. The Worker falls back to the in-memory limiter by itself.
   - **`cache`**: delete the `cache` block and deploy again. API answers then run the Worker every time. The headers are unchanged, browsers still cache, and CPU stays within budget.
   - **Custom domain**: an `akoma` DNS record already exists, or the token lacks permission (see above).
4. **Smoke check.** Run
   `node scripts/smoke.mjs https://akoma.hendril.dev "$(node -p 'JSON.parse(require("fs").readFileSync("dataset/dataset.json","utf8")).provisions[0].provenance.datasetVersion')"`.
   It checks `/v1/status` (and its dataset version), a provision in Markdown, search and a static file, each with open CORS, and MCP `tools/list`. It retries for a minute.
5. **Edge cache.** Run `curl -sI https://akoma.hendril.dev/v1/norms` twice. The second answer should show `cf-cache-status: HIT` and an `age`.
   - **Never HIT:** Workers Cache is not active on this account. The API still works.
   - **`age` never above 300:** the edge ignores `s-maxage` and uses `max-age`. That is harmless.
6. **Neighbours unaffected.**
   - `curl -sI https://hendril.dev/` answers as before, with the language redirect.
   - `curl -sI https://hendril.dev/acesa` answers as before.
   - The zone's Workers Routes list has no new route.
   - Add `akoma.hendril.dev` → `hendril-dev-akoma` → `~/Developer/akoma` to the route map in `hendril-portfolio/README.md`.
7. **Limits in production.**
   - Rate limit: `for i in $(seq 1 130); do curl -s -o /dev/null -w "%{http_code}\n" "https://akoma.hendril.dev/v1/norms?n=$i"; done | sort | uniq -c`. Expect some `429`. The varying query string avoids the cache.
   - CPU: Workers → hendril-dev-akoma → Observability should show no "Exceeded CPU" errors (error 1102), and CPU time per request well under 10 ms. Look in particular at the first request after the deploy (a cold isolate) and at `/mcp` calls.
   - MCP: add `https://akoma.hendril.dev/mcp` to an MCP client and call `list_norms`.
8. **Turn on automatic deploys.** Create the token above, then run `gh secret set CLOUDFLARE_API_TOKEN -R hendrillara/akoma`. From then on, every push to `main` runs `.github/workflows/deploy.yml`: `pnpm verify`, `wrangler deploy` of the committed `dataset/`, then the smoke check. You can run it by hand with *Run workflow*. Until the secret exists, the deploy job skips with a notice and the verify job still runs.

**Rollback:** `pnpm exec wrangler deployments list`, then `pnpm exec wrangler rollback [version-id]`. Each version has its own cache, so a rollback serves that version's answers.

---

# Deploy de akoma.hendril.dev (PT)

O Akoma roda como um Worker da Cloudflare, `hendril-dev-akoma`, no domínio próprio `akoma.hendril.dev` (`wrangler.jsonc`). Ele não ocupa nenhuma outra rota de hendril.dev. Os outros Workers de hendril.dev têm rotas de caminho no domínio raiz (`hendril.dev/*`, `hendril.dev/acesa*`…), e um domínio próprio num subdomínio não casa com nenhuma delas. O mapa de rotas da zona fica em `hendril-portfolio/README.md` § "Deployment boundaries".

Um deploy envia duas coisas, ambas da pasta `dataset/` commitada (gerada por `pnpm build:dataset`, #12):

| Caminho | Quem atende | O quê |
|---|---|---|
| `/v1/…` (`norms`, `provisions`, `search`, `status`) e `/mcp` | o Worker (`src/worker/main.ts`), sempre (`run_worker_first`) | a API REST e o endpoint MCP remoto, empacotados com `dataset/dataset.json` |
| cada arquivo de `dataset/`, no próprio caminho (`/cf/art5.json`, `/cf/art5.md`, `/cf.md`, `/status.json`, `/search-index.json`, `/dataset.json`) | os static assets do Workers, sem rodar o Worker | o dataset para download, com os cabeçalhos de `dataset/_headers` (CORS aberto) |

O spec dizia Cloudflare Pages. Os static assets do Workers fazem o mesmo papel dentro do mesmo Worker: um deploy, um domínio, e as requisições de arquivo são gratuitas e ilimitadas.

## Como as requisições são tratadas

- **Cache na borda.** A CDN não guarda sozinha as respostas de um Worker, porque o Worker roda antes do cache. O Workers Cache (`"cache": { "enabled": true }`, wrangler ≥ 4.69) guarda essas respostas só pelo `Cache-Control`, sem código da Cache API. Respostas de sucesso levam `public, max-age=300, s-maxage=3600`; as que não acham nada, `public, max-age=60`. Um 429, toda resposta a HEAD e toda resposta de `/mcp` levam `no-store`. GET e HEAD dividem a mesma entrada de cache, e um corpo vazio de HEAD nunca pode chegar a um GET. Chamadas MCP são POSTs, que nunca entram no cache. A chave do cache inclui a versão do Worker, então cada deploy, e portanto cada dataset, começa com o cache vazio.
- **Acertos de cache não passam pelo rate limiter.** Um acerto é respondido sem rodar o Worker: não gasta CPU e não é contado. Mesmo assim é uma requisição cobrada: o Free dá 100.000 por dia, e as requisições de arquivos estáticos não entram nessa conta. O limitador, portanto, limita o caminho sem cache, que é onde se gasta CPU. Uma query string nova é uma chave nova: não está no cache e é limitada.
- **Rate limiting.** São 120 requisições por minuto por IP (`RATE_LIMIT` em `src/worker/worker.ts`; `ratelimits` em `wrangler.jsonc` repete o valor). O binding de rate limit do Workers conta por local da Cloudflare. Se não houver binding, o Worker recorre a uma janela em memória por isolate, mais frouxa, mas nunca ausente. `/mcp` tem um orçamento próprio, do mesmo tamanho, por IP (chave `mcp:<ip>`). Uma sessão MCP do protocolo 2025 gasta umas quatro requisições no handshake, e o uso de REST e de MCP pelo mesmo IP não pode sufocar um ao outro.
- **CPU.** O dataset é avaliado e indexado no escopo global, uma vez por isolate. Isso leva 43–47 ms em `wrangler check startup` (bundle de 6,5 MB, 889 KB gzip, SDK do MCP incluído). Esse trabalho é feito uma vez por isolate, dentro do limite de 1 s de inicialização, em vez de em toda requisição (10 ms de CPU no Free). A página de limites da Cloudflare não diz se o trabalho de inicialização conta na CPU da primeira requisição que o isolate atende, então o passo 7 confere essa primeira requisição. No Node, requisições REST já aquecidas mediram 0,5–1,5 ms de CPU, e chamadas de ferramenta MCP aquecidas, 2–3 ms. A primeira chamada MCP num processo novo mediu uns 30 ms, que é o aquecimento do próprio SDK. A Cloudflare tolera estouros esporádicos, mas é essa a requisição com mais chance de passar do limite. Nenhum desses números é medição de produção: o passo 7 abaixo confere.
- **Localmente**, `pnpm dev` (`wrangler dev`, depois que `dataset/` existir) simula o binding de rate limit, mas não o Workers Cache: o cabeçalho `cf-cache-status` não aparece. O `/mcp` responde lá nas duas gerações do protocolo (conferido com JSON-RPC cru).

## Credenciais de deploy

O deploy automático precisa de um secret do repositório, `CLOUDFLARE_API_TOKEN`. Crie o token em *Account API tokens → Create Token → modelo "Edit Cloudflare Workers"* e depois restrinja:

- **Recursos de conta:** só esta conta. **Recursos de zona:** só `hendril.dev`.
- **Mínimo esperado:** Account › Workers Scripts › Edit e Zone › Workers Routes › Edit. Tire as permissões de KV, R2 e Pages que vêm no modelo.
- **Não verificado:** esse conjunto ainda não foi testado contra a API. Se o passo do domínio próprio responder 403, adicione Zone › DNS › Edit.

O id da conta está commitado em `wrangler.jsonc`. Ele não é segredo. Se preferir não deixá-lo num repositório público, apague-o de lá e defina `CLOUDFLARE_ACCOUNT_ID` como variável do repositório no workflow.

## Primeiro deploy (o mantenedor roda e aprova cada passo)

0. **Verificações prévias.**
   - `dataset/` está commitada: o #12 entrou e `dataset/dataset.json` existe.
   - `pnpm install && pnpm verify` passa.
   - O DNS de `hendril.dev` não tem registro `akoma` (painel → hendril.dev → DNS → Records). Um CNAME existente impede o domínio próprio.
   - `pnpm exec wrangler deploy --dry-run` empacota sem erro e lista `env.RATE_LIMITER`.
1. **Login.** Rode `pnpm exec wrangler login` (OAuth no navegador) e depois `pnpm exec wrangler whoami`. A conta tem que ser a do `account_id`.
2. **Deploy.** Rode `pnpm exec wrangler deploy`. A saída mostra a rota `akoma.hendril.dev (custom domain)`, o binding de rate limit e o "Worker Startup Time". O domínio próprio cria o registro DNS e o certificado, o que pode levar alguns minutos.
3. **Se o deploy for recusado**, leia o erro e corrija só o bloco envolvido:
   - **`ratelimits`** (indisponível no plano): apague o bloco `ratelimits` e faça o deploy de novo. O Worker passa sozinho para o limitador em memória.
   - **`cache`**: apague o bloco `cache` e faça o deploy de novo. Aí toda resposta da API roda o Worker. Os cabeçalhos não mudam, o navegador continua guardando cache e a CPU fica dentro do orçamento.
   - **Domínio próprio**: já existe um registro DNS `akoma`, ou falta permissão ao token (veja acima).
4. **Smoke check.** Rode
   `node scripts/smoke.mjs https://akoma.hendril.dev "$(node -p 'JSON.parse(require("fs").readFileSync("dataset/dataset.json","utf8")).provisions[0].provenance.datasetVersion')"`.
   Ele confere `/v1/status` (e a versão do dataset), um dispositivo em Markdown, a busca e um arquivo estático, todos com CORS aberto, e o `tools/list` do MCP. Tenta de novo durante um minuto.
5. **Cache na borda.** Rode `curl -sI https://akoma.hendril.dev/v1/norms` duas vezes. A segunda resposta deve mostrar `cf-cache-status: HIT` e um `age`.
   - **Nunca dá HIT:** o Workers Cache não está ativo na conta. A API continua funcionando.
   - **`age` nunca passa de 300:** a borda ignora `s-maxage` e usa `max-age`. Não faz mal.
6. **Vizinhos intactos.**
   - `curl -sI https://hendril.dev/` responde como antes, com o redirecionamento de idioma.
   - `curl -sI https://hendril.dev/acesa` responde como antes.
   - A lista de Workers Routes da zona não tem rota nova.
   - Adicione `akoma.hendril.dev` → `hendril-dev-akoma` → `~/Developer/akoma` ao mapa de rotas em `hendril-portfolio/README.md`.
7. **Limites em produção.**
   - Rate limit: `for i in $(seq 1 130); do curl -s -o /dev/null -w "%{http_code}\n" "https://akoma.hendril.dev/v1/norms?n=$i"; done | sort | uniq -c`. Espere alguns `429`. A query string variada evita o cache.
   - CPU: em Workers → hendril-dev-akoma → Observability não deve aparecer nenhum erro "Exceeded CPU" (erro 1102), e o tempo de CPU por requisição deve ficar bem abaixo de 10 ms. Olhe em especial a primeira requisição depois do deploy (isolate frio) e as chamadas a `/mcp`.
   - MCP: adicione `https://akoma.hendril.dev/mcp` a um cliente MCP e chame `list_norms`.
8. **Ligue o deploy automático.** Crie o token acima e rode `gh secret set CLOUDFLARE_API_TOKEN -R hendrillara/akoma`. A partir daí, cada push em `main` roda `.github/workflows/deploy.yml`: `pnpm verify`, `wrangler deploy` da `dataset/` commitada e o smoke check. Dá para rodar à mão com *Run workflow*. Enquanto o secret não existir, o job de deploy é pulado com um aviso, e o de verify continua rodando.

**Rollback:** `pnpm exec wrangler deployments list` e depois `pnpm exec wrangler rollback [version-id]`. Cada versão tem o próprio cache, então um rollback serve as respostas daquela versão.

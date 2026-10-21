# Akoma

[![CI](https://github.com/hendrillara/akoma/actions/workflows/ci.yml/badge.svg)](https://github.com/hendrillara/akoma/actions/workflows/ci.yml)

**Português** · [English](#english)

O Akoma espelha a legislação federal brasileira em dados estruturados por dispositivo (artigo, parágrafo, inciso, alínea, item), cada um com um id LexML estável e a sua proveniência, para agentes de IA. A v1 cobre a Constituição Federal (CF), o ADCT e o Código de Defesa do Consumidor (CDC, Lei 8.078/1990). O agente busca ("direito de arrependimento") ou pede um dispositivo exato pelo id, por um servidor MCP remoto ou por uma API REST, e recebe só o texto de que precisa.

> **Situação: em construção, ainda não publicado.** `akoma.hendril.dev` é o endereço planejado; o primeiro deploy ainda não aconteceu ([`docs/deploy.md`](docs/deploy.md)). Os exemplos abaixo descrevem a API como ela está no código e são conferidos pelos testes. Localmente, `pnpm dev` serve a API depois que a pasta `dataset/` é gerada (o comando que a gera vem com o #12).

## O que o Akoma não é

- **Não é aconselhamento jurídico.** Ele entrega o texto da lei, não a interpretação dele.
- **Não é fonte oficial.** O texto vem das páginas compiladas do Planalto, mas a cópia é não oficial. Toda resposta traz o link da fonte e a data em que foi obtida: confira lá.
- **Não verifica decisões do STF.** A vigência não é conferida contra decisões do STF. As notas "Vide ADI…" que o Planalto imprime aparecem no dispositivo, mas o Akoma não sabe o que o STF decidiu.
- **Não é uma implementação do Akoma Ntoso.** O nome ("coração" em akan) é uma homenagem a esse padrão de XML legislativo; o projeto não lê nem gera Akoma Ntoso.

## Conectar um agente (MCP)

URL do servidor MCP remoto (Streamable HTTP, sem estado, sem cadastro nem chave):

```
https://akoma.hendril.dev/mcp
```

No Claude Code:

```sh
claude mcp add --transport http akoma https://akoma.hendril.dev/mcp
```

Em outros clientes, a configuração varia; um exemplo comum:

```json
{ "mcpServers": { "akoma": { "type": "http", "url": "https://akoma.hendril.dev/mcp" } } }
```

Ferramentas (nomes em inglês, descrições em inglês e português):

| Ferramenta | Argumentos | O que faz |
|---|---|---|
| `search` | `query`, `norm?`, `limit?` | busca por palavras-chave ou pergunta e devolve os dispositivos mais relevantes |
| `get_provision` | `norm`, `id` | texto exato de um dispositivo (`art5_cpt_inc10`) ou de um artigo inteiro (`art5`) |
| `get_structure` | `norm` | sumário da norma (títulos, capítulos, seções, intervalos de artigos), sem texto |
| `list_norms` | — | normas disponíveis, URN e quando cada texto foi obtido |

As respostas são Markdown compacto: o texto primeiro, depois o caminho (Título II › Capítulo I › Art. 5º › inciso X), a situação (revogado, vetado), a redação pendente com a data de início, as notas "Vide"/ADI e um rodapé com a fonte e o aviso.

Agentes também se descobrem sozinhos por [`/llms.txt`](https://akoma.hendril.dev/llms.txt) e pelo guia de uso [`/usage.md`](https://akoma.hendril.dev/usage.md). A verificação de que um agente que recebe só a URL do MCP encontra e usa as ferramentas está registrada em [`docs/agent-discovery-check.md`](docs/agent-discovery-check.md) (feita localmente; a verificação em produção fica para depois do deploy).

## API REST

JSON por padrão; `format=md` devolve o mesmo Markdown do MCP. Os ids seguem a convenção LexML e nunca são reaproveitados.

```sh
# normas disponíveis
curl https://akoma.hendril.dev/v1/norms
# CF art. 5º, inciso X
curl "https://akoma.hendril.dev/v1/provisions/cf/art5_cpt_inc10?format=md"
# CF art. 7º, inciso XV: em vigor + redação pendente da EC 141/2026, a partir de 2026-12-17
curl https://akoma.hendril.dev/v1/provisions/cf/art7_cpt_inc15
# CF art. 5º § 3º: traz a nota "Vide ADIN 3392"
curl https://akoma.hendril.dev/v1/provisions/cf/art5_par3
# CDC art. 49 inteiro (caput e parágrafo único)
curl "https://akoma.hendril.dev/v1/provisions/cdc/art49?format=md"
# busca, só no CDC
curl "https://akoma.hendril.dev/v1/search?q=direito%20de%20arrependimento&norm=cdc&limit=5"
# sumário do CDC
curl "https://akoma.hendril.dev/v1/norms/cdc/structure?format=md"
# versão do dataset, contagens por norma, páginas de origem e atribuição
curl https://akoma.hendril.dev/v1/status
```

| Endpoint | O que devolve |
|---|---|
| `GET /v1/norms` | as normas |
| `GET /v1/norms/{norm}` | uma norma e suas contagens |
| `GET /v1/norms/{norm}/structure` | o sumário |
| `GET /v1/provisions/{norm}/{id}` | um dispositivo, ou um artigo inteiro quando `id` é de artigo |
| `GET /v1/search?q=…&norm=…&limit=…` | resultados ordenados (padrão 10, máximo 50) |
| `GET /v1/status` | versão do dataset, contagens, páginas de origem, atribuição |

Erros: 400 para parâmetros inválidos; 404 para id desconhecido, com `suggestion` quando o id é um alias conhecido do normas.leg.br (`/v1/provisions/cf/art7_par1u` sugere `art7_par1`); 429 com `Retry-After` acima de 120 requisições por minuto por IP (o `/mcp` tem uma cota própria do mesmo tamanho). As respostas de sucesso podem ser guardadas em cache pela CDN por até uma hora.

Depois que o dataset for commitado (#12), os mesmos dados ficam também como arquivos estáticos: `/cf/art5.json`, `/cf/art5.md`, `/cf.md`, `/dataset.json`, `/status.json`.

## O que cada dispositivo traz

`id`, `norm`, `kind`, `label`, o caminho na hierarquia, o `text` literal, `status` (`in_force`, `revoked`, `vetoed`, `renumbered`, `not_yet_in_force`), `amendments` (os atos que o incluíram, alteraram ou revogaram), `references` (notas "Vide", inclusive ADI/ADPF), `pending` (redação com vigência diferida e `effectiveFrom`), `aliases` (ids do normas.leg.br, com atribuição) e `provenance`: URL da fonte, data de obtenção, hash do conteúdo, versão do dataset, o resultado da conferência com uma segunda fonte (`agrees`, `secondary-stale`, `unconfirmed`) e o aviso fixo.

## Garantias de precisão: o que é medido hoje

Tudo isto roda em `pnpm verify`, o mesmo comando do CI (o badge acima):

- **Golden sets** conferidos à mão contra o HTML oficial: 62 dispositivos da CF e do ADCT e 60 do CDC (texto, id, caminho, situação, anotações).
- **Invariantes estruturais** (ids únicos, numeração monotônica, contagens exatas de incisos, parágrafos e alíneas) e **snapshots do texto completo** de cada norma: qualquer mudança no texto falha o teste.
- **Conferência entre fontes** por dispositivo: CF e ADCT contra o normas.leg.br (Senado), CDC contra a compilação da Câmara (LEGIN). Uma divergência sem explicação bloqueia ([ADR 0004](docs/adr/0004-cross-source-agreement.md)).
- **Vigência diferida**: quando uma emenda só vale depois, a redação em vigor continua e a nova aparece como pendente, com a data de início ([ADR 0003](docs/adr/0003-deferred-vigencia.md)).
- **Avaliação da busca**: 184 perguntas → dispositivos esperados. recall@10 de 0,859 no conjunto todo e de 0,697 nas 38 perguntas de controle (*holdout*), as mais independentes ([`docs/search.md`](docs/search.md)).

### Limites conhecidos

- **Não publicado ainda.** O endereço é planejado; nada roda em produção.
- **A atualização diária ainda não roda.** O job que busca o Planalto, abre um PR e faz merge sozinho ou pede revisão humana é o #12. Os dados de hoje vêm das capturas de 2026-10-20/21 (`fixtures/`).
- **Revisão por LLM (camada 3): construída, não ativa.** O revisor e seus testes existem, mas ainda não rodam em nenhum fluxo.
- **Mudanças no CDC sempre vão para revisão humana na v1.** A conferência de alvos lê só os comandos de emendas constitucionais; o CDC é alterado por leis, então toda mudança de texto nele é escalada.
- **STF não verificado** (ver acima). A busca é lexical (BM25 com dicionário de sinônimos), não semântica.

## Estado do serviço

O badge acima é o do CI (os testes na branch principal). O arquivo de estado do job diário e o badge dele (última verificação, última mudança, atraso por fonte, resultado dos testes) vêm com o #12. Já existem `GET /v1/status` e o `status.json` do dataset, com a conferência entre fontes por norma e a atribuição ao Senado/LexML.

## Licenças e atribuição

- **Código:** [MIT](LICENSE).
- **Dataset:** [CC0 1.0](LICENSE-DATA.md), exceto os campos `aliases`.
- **Atribuição:** os `aliases` são fragmentos de URN do **normas.leg.br / LexML Brasil, © Senado Federal, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. O dataset não republica texto nem histórico do normas.leg.br; a atribuição acompanha os aliases em cada resposta que os traz, e está no `status.json` e em `/v1/status`.
- O texto das leis não tem proteção autoral (Lei 9.610/1998, art. 8º, IV).

## Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Em resumo: PRs no parser, nos manifestos e nos testes; os dados gerados nunca são editados à mão.

## Documentação técnica

[Deploy](docs/deploy.md) · [Busca](docs/search.md) · [Como adicionar uma norma](docs/adding-a-norm.md) · [ADRs](docs/adr/) · [Pesquisa de fontes](docs/research/2026-10-20-sources.md) · [Verificação de descoberta por agente](docs/agent-discovery-check.md)

---

<a id="english"></a>

## English

Akoma mirrors Brazilian federal law as structured data, one dispositivo (article, paragraph, inciso, alínea, item) at a time, each with a stable LexML id and its provenance, for AI agents. v1 covers the Constituição Federal (CF), the ADCT and the Código de Defesa do Consumidor (CDC, Lei 8.078/1990). An agent searches ("direito de arrependimento") or fetches an exact dispositivo by id, over a remote MCP server or a REST API, and gets only the text it needs.

> **Status: building, not deployed yet.** `akoma.hendril.dev` is the planned address; the first deploy has not happened ([`docs/deploy.md`](docs/deploy.md)). The examples below describe the API as it is in the code, and the tests check them. Locally, `pnpm dev` serves the API once the `dataset/` folder is generated (the command that generates it comes with #12).

### What Akoma is not

- **Not legal advice.** It serves the text of the law, not its interpretation.
- **Not an official source.** The text comes from Planalto's compiled pages, but this copy is unofficial. Every answer carries the source link and retrieval date: check there.
- **Not checked against the STF.** Vigência is not verified against STF decisions. The "Vide ADI…" notes Planalto prints are surfaced on the dispositivo, but Akoma does not know what the STF decided.
- **Not an Akoma Ntoso implementation.** The name (Akan for "heart") nods to that legal-XML standard; the project neither reads nor writes Akoma Ntoso.

### Connect an agent (MCP)

Remote MCP server URL (Streamable HTTP, stateless, no signup or key):

```
https://akoma.hendril.dev/mcp
```

In Claude Code:

```sh
claude mcp add --transport http akoma https://akoma.hendril.dev/mcp
```

Other clients differ; a common shape, as an example:

```json
{ "mcpServers": { "akoma": { "type": "http", "url": "https://akoma.hendril.dev/mcp" } } }
```

Tools (English names, English and Portuguese descriptions):

| Tool | Arguments | What it does |
|---|---|---|
| `search` | `query`, `norm?`, `limit?` | keyword or question search; returns the best-matching dispositivos |
| `get_provision` | `norm`, `id` | exact text of one dispositivo (`art5_cpt_inc10`) or a whole article (`art5`) |
| `get_structure` | `norm` | the norm's outline (títulos, capítulos, seções, article ranges), no text |
| `list_norms` | — | available norms, URNs and when each text was retrieved |

Answers are compact Markdown: the text first, then the path (Título II › Capítulo I › Art. 5º › inciso X), the status (revoked, vetoed), any pending wording with its start date, the "Vide"/ADI notes and a footer with the source and the notice.

Agents can also discover the service through [`/llms.txt`](https://akoma.hendril.dev/llms.txt) and the usage guide [`/usage.md`](https://akoma.hendril.dev/usage.md). The check that an agent given only the MCP URL finds and uses the tools is recorded in [`docs/agent-discovery-check.md`](docs/agent-discovery-check.md) (run locally; production verification is pending the deploy).

### REST API

JSON by default; `format=md` returns the same Markdown as MCP. Ids follow the LexML convention and are never reused.

```sh
# available norms
curl https://akoma.hendril.dev/v1/norms
# CF art. 5º, inciso X
curl "https://akoma.hendril.dev/v1/provisions/cf/art5_cpt_inc10?format=md"
# CF art. 7º, inciso XV: in force + EC 141/2026's pending wording, from 2026-12-17
curl https://akoma.hendril.dev/v1/provisions/cf/art7_cpt_inc15
# CF art. 5º § 3º: carries the "Vide ADIN 3392" note
curl https://akoma.hendril.dev/v1/provisions/cf/art5_par3
# the whole CDC art. 49 (caput and parágrafo único)
curl "https://akoma.hendril.dev/v1/provisions/cdc/art49?format=md"
# search, CDC only
curl "https://akoma.hendril.dev/v1/search?q=direito%20de%20arrependimento&norm=cdc&limit=5"
# the CDC's outline
curl "https://akoma.hendril.dev/v1/norms/cdc/structure?format=md"
# dataset version, per-norm counts, source pages and attribution
curl https://akoma.hendril.dev/v1/status
```

| Endpoint | Returns |
|---|---|
| `GET /v1/norms` | the norms |
| `GET /v1/norms/{norm}` | one norm and its counts |
| `GET /v1/norms/{norm}/structure` | the outline |
| `GET /v1/provisions/{norm}/{id}` | a dispositivo, or a whole article when `id` is an article id |
| `GET /v1/search?q=…&norm=…&limit=…` | ranked results (default 10, max 50) |
| `GET /v1/status` | dataset version, counts, source pages, attribution |

Errors: 400 for invalid parameters; 404 for an unknown id, with a `suggestion` when the id is a known normas.leg.br alias (`/v1/provisions/cf/art7_par1u` suggests `art7_par1`); 429 with `Retry-After` above 120 requests a minute per IP (`/mcp` has its own budget of the same size). Successful answers may be cached by the CDN for up to an hour.

Once the dataset is committed (#12), the same data is also served as static files: `/cf/art5.json`, `/cf/art5.md`, `/cf.md`, `/dataset.json`, `/status.json`.

### What each dispositivo carries

`id`, `norm`, `kind`, `label`, its hierarchy path, the verbatim `text`, `status` (`in_force`, `revoked`, `vetoed`, `renumbered`, `not_yet_in_force`), `amendments` (the acts that inserted, reworded or revoked it), `references` ("Vide" notes, including ADI/ADPF), `pending` (deferred-vigência wording with `effectiveFrom`), `aliases` (normas.leg.br ids, with attribution) and `provenance`: source URL, retrieval time, content hash, dataset version, the outcome of the check against a second source (`agrees`, `secondary-stale`, `unconfirmed`) and the fixed notice.

### Accuracy guarantees: what is measured today

All of this runs in `pnpm verify`, the same command CI runs (the badge above):

- **Golden sets** hand-checked against the official HTML: 62 CF and ADCT dispositivos and 60 CDC ones (text, id, path, status, annotations).
- **Structural invariants** (unique ids, monotonic numbering, exact counts of incisos, paragraphs and alíneas) and **full-text snapshots** of each norm: any change to the text fails the tests.
- **Cross-source agreement** per dispositivo: CF and ADCT against normas.leg.br (Senado), the CDC against Câmara's compilation (LEGIN). An unexplained divergence blocks ([ADR 0004](docs/adr/0004-cross-source-agreement.md)).
- **Deferred vigência:** when an amendment takes effect later, the wording in force stays and the new one is exposed as pending, with its start date ([ADR 0003](docs/adr/0003-deferred-vigencia.md)).
- **Search evaluation:** 184 questions → expected dispositivos. recall@10 is 0.859 over the whole set and 0.697 on the 38 holdout questions, the more independent ones ([`docs/search.md`](docs/search.md)).

#### Known limits

- **Not deployed yet.** The address is planned; nothing runs in production.
- **The daily refresh does not run yet.** The job that fetches Planalto, opens a PR and merges it or asks for human review is #12. Today's data is built from the 2026-10-20/21 captures (`fixtures/`).
- **LLM review (layer 3): built, not active.** The reviewer and its tests exist, but no workflow runs it yet.
- **CDC changes always escalate to human review in v1.** Target matching reads only constitutional amendments' commands; the CDC is amended by laws, so every text change to it is escalated.
- **STF not verified** (see above). Search is lexical (BM25 with a synonym dictionary), not semantic.

### Service status

The badge above is CI's (the tests on the default branch). The daily job's status file and its badge (last check, last change, per-source lag, test results) come with #12. `GET /v1/status` and the dataset's `status.json` already exist, with the per-norm cross-source results and the Senado/LexML attribution.

### Licences and attribution

- **Code:** [MIT](LICENSE).
- **Dataset:** [CC0 1.0](LICENSE-DATA.md), except the `aliases` fields.
- **Attribution:** the `aliases` are URN fragments from **normas.leg.br / LexML Brasil, © Senado Federal, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. The dataset does not republish normas.leg.br text or history; the credit travels with the aliases in every answer that carries them, and is in `status.json` and `/v1/status`.
- The text of the laws is not protected by copyright (Lei 9.610/1998, art. 8º, IV).

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: PRs to the parser, manifests and tests; generated data is never hand-edited.

### Technical docs

[Deploy](docs/deploy.md) · [Search](docs/search.md) · [Adding a norm](docs/adding-a-norm.md) · [ADRs](docs/adr/) · [Source research](docs/research/2026-10-20-sources.md) · [Agent discovery check](docs/agent-discovery-check.md)

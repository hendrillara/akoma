# Agent discovery check

**Question:** can an agent that is given only the MCP URL discover Akoma's tools and use them correctly?

**Status:** passed locally on 2026-10-21, against `wrangler dev`. **Production verification is pending:** the service is not deployed yet. Repeat this check after the first deploy ([`deploy.md`](deploy.md) step 7, "MCP"), with `https://akoma.hendril.dev/mcp` in place of the local URL.

## Setup

1. Dataset: built from the committed fixtures (`fixtures/2026-10-20/`, `fixtures/2026-10-21/`) with `build()` and `datasetFiles()` into a local, uncommitted `dataset/` (version `2026.10.21-local`). It was deleted afterwards.
2. Server: `pnpm dev --port 8787 --ip 127.0.0.1` (wrangler 4.151.2). This runs the real Worker bundle (`src/worker/main.ts` with the bundled `dataset.json`), with static assets in front.
3. Agent: Claude Code in headless mode (`claude -p`, model Claude Opus 5.5), run from an empty directory. Its only configuration was an MCP config naming one server, `{"akoma": {"type": "http", "url": "http://127.0.0.1:8787/mcp"}}`, with `--strict-mcp-config`, `--tools ""` (no built-in tools) and `--allowedTools mcp__akoma`. The prompts gave no tool names, ids or article numbers.

Before the agent runs, `/llms.txt`, `/usage.md`, `/v1/status`, `/status.json` (with the Senado/LexML attribution) and a static file (`/cf/art5.json`) all answered 200 through the same server. A raw `initialize` returned the server's name and its bilingual instructions.

## Run 1: a question the agent could place from memory

> *"Under Brazil's consumer protection code, within how many days can a consumer withdraw from a contract signed outside a store, and what happens to amounts already paid? Quote the provision text exactly as the tool returns it, and give its source line."*

- **Discovery:** at connection the agent listed four tools: `search`, `get_provision`, `get_structure`, `list_norms`.
- **Calls:** `get_provision {norm: "cdc", id: "art49"}`, which returned the whole article (caput and parágrafo único).
- **Answer:** 7 days, with amounts paid refunded at once and monetarily updated. The article was quoted verbatim with its source line (`https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm · obtido em / retrieved 2026-10-20 · dataset 2026.10.21-local`). The agent repeated the notice that the text is unofficial and that vigência is not verified against the STF.
- **Cost:** 2 turns, about 8 s.

## Run 2: the agent must find the article with the tools

> *"Do not rely on your memory for article numbers: find them with the tools. What does the Brazilian Constitution currently say about weekly paid rest (repouso semanal remunerado) for workers, and is a change to that wording pending? Quote the text exactly as the tool returns it and give its source line."*

- **Calls:**
  1. `search {query: "repouso semanal remunerado", norm: "cf"}`: CF art. 7º XV (`art7_cpt_inc15`) came first, with its pending wording.
  2. `get_provision` for `art7_cpt_inc15`, `art7_par2` and `art7_par3`.
  3. `search` in the `adct`, looking for a transition rule. It found none relevant.
- **Answer:** the wording in force ("repouso semanal remunerado, preferencialmente aos domingos;"), then the pending wording from EC 141/2026, from 2026-12-17 ("…de 2 (dois) dias, um dos quais preferencialmente aos domingos;"). Both were quoted verbatim with the source line, and the answer explained that the current wording applies until that date.
- **Agent caution:** the agent noted that §§ 2º and 3º (also inserted by EC 141) are served as in force, without a pending date, and said it could not confirm whether they also wait for 2026-12-17. The data is right: EC 141's vigência clause (art. 10) defers only the change to inciso XV, and `test/vigencia.test.ts` covers this. The caution is reasonable. It also suggests that answers could quote the act's vigência clause, which is already in the JSON `pending[].vigencia` but not in the Markdown.
- **Cost:** 6 turns, about 30 s.

## Conclusion

Given only the MCP URL, the agent found the four tools. It chose `search` when it had no article number and `get_provision` for the exact text. It quoted the text verbatim, kept the source line and repeated the notice. No call failed. What this check does not cover: production behaviour (edge cache, rate-limit binding, CPU limits), other MCP clients, and the `/llms.txt` route discovered by an agent on its own. The seam 2 tests (`test/mcp.test.ts`, `test/discovery.test.ts`) cover the protocol in both eras and every example in `/llms.txt`, `/usage.md` and the README.

---

# Verificação de descoberta por agente (PT)

**Pergunta:** um agente que recebe só a URL do MCP consegue descobrir as ferramentas do Akoma e usá-las direito?

**Situação:** aprovada localmente em 2026-10-21, contra o `wrangler dev`. **A verificação em produção está pendente:** o serviço ainda não foi publicado. Repita esta verificação depois do primeiro deploy ([`deploy.md`](deploy.md), passo 7, "MCP"), com `https://akoma.hendril.dev/mcp` no lugar da URL local.

## Montagem

1. Dataset: gerado das fixtures commitadas (`fixtures/2026-10-20/`, `fixtures/2026-10-21/`) com `build()` e `datasetFiles()` numa `dataset/` local, fora do commit (versão `2026.10.21-local`). Depois foi apagada.
2. Servidor: `pnpm dev --port 8787 --ip 127.0.0.1` (wrangler 4.151.2). Isso roda o bundle real do Worker (`src/worker/main.ts` com o `dataset.json` empacotado), com os static assets na frente.
3. Agente: Claude Code em modo headless (`claude -p`, modelo Claude Opus 5.5), rodando numa pasta vazia. A única configuração foi um MCP config com um servidor, `{"akoma": {"type": "http", "url": "http://127.0.0.1:8787/mcp"}}`, mais `--strict-mcp-config`, `--tools ""` (nenhuma ferramenta embutida) e `--allowedTools mcp__akoma`. Os prompts não deram nome de ferramenta, id nem número de artigo.

Antes das rodadas do agente, `/llms.txt`, `/usage.md`, `/v1/status`, `/status.json` (com a atribuição ao Senado/LexML) e um arquivo estático (`/cf/art5.json`) responderam 200 pelo mesmo servidor. Um `initialize` cru devolveu o nome do servidor e as instruções bilíngues.

## Rodada 1: uma pergunta que o agente sabia localizar de memória

> *"Pelo Código de Defesa do Consumidor, em quantos dias o consumidor pode desistir de um contrato assinado fora da loja, e o que acontece com os valores já pagos? Cite o texto exatamente como a ferramenta devolve, com a linha da fonte."* (o prompt foi em inglês)

- **Descoberta:** ao conectar, o agente listou quatro ferramentas: `search`, `get_provision`, `get_structure`, `list_norms`.
- **Chamadas:** `get_provision {norm: "cdc", id: "art49"}`, que devolveu o artigo inteiro (caput e parágrafo único).
- **Resposta:** 7 dias, e os valores pagos são devolvidos de imediato, com correção monetária. O artigo foi citado literalmente, com a linha da fonte. O agente repetiu o aviso de que o texto não é oficial e de que a vigência não é conferida contra o STF.
- **Custo:** 2 turnos, cerca de 8 s.

## Rodada 2: o agente precisa achar o artigo com as ferramentas

> *"Não use a memória para números de artigo: ache-os com as ferramentas. O que a Constituição diz hoje sobre o repouso semanal remunerado, e há mudança pendente nessa redação? Cite o texto exatamente como a ferramenta devolve, com a linha da fonte."* (o prompt foi em inglês)

- **Chamadas:**
  1. `search {query: "repouso semanal remunerado", norm: "cf"}`: o art. 7º, XV, da CF (`art7_cpt_inc15`) veio primeiro, com a redação pendente.
  2. `get_provision` para `art7_cpt_inc15`, `art7_par2` e `art7_par3`.
  3. `search` no `adct`, procurando regra de transição. Não achou nada relevante.
- **Resposta:** a redação em vigor ("repouso semanal remunerado, preferencialmente aos domingos;") e depois a redação pendente da EC 141/2026, a partir de 2026-12-17 ("…de 2 (dois) dias, um dos quais preferencialmente aos domingos;"). As duas foram citadas literalmente, com a linha da fonte, e a resposta explicou que a redação atual vale até essa data.
- **Cautela do agente:** o agente notou que os §§ 2º e 3º (também incluídos pela EC 141) aparecem como em vigor, sem data pendente, e disse que não conseguia confirmar se eles também esperam 2026-12-17. O dado está certo: a cláusula de vigência da EC 141 (art. 10) só adia a mudança do inciso XV, e o `test/vigencia.test.ts` cobre isso. A cautela é razoável. Ela também sugere que as respostas poderiam citar a cláusula de vigência do ato, que já está no JSON (`pending[].vigencia`), mas não no Markdown.
- **Custo:** 6 turnos, cerca de 30 s.

## Conclusão

Recebendo só a URL do MCP, o agente achou as quatro ferramentas. Escolheu `search` quando não tinha número de artigo e `get_provision` para o texto exato. Citou o texto literalmente, manteve a linha da fonte e repetiu o aviso. Nenhuma chamada falhou. O que esta verificação não cobre: o comportamento em produção (cache na borda, binding de rate limit, limites de CPU), outros clientes MCP e a descoberta da rota `/llms.txt` por um agente sozinho. Os testes da fronteira 2 (`test/mcp.test.ts`, `test/discovery.test.ts`) cobrem o protocolo nas duas gerações e todos os exemplos de `/llms.txt`, `/usage.md` e do README.

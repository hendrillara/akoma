# ADR 0006: The LLM reviewer's model (review layer 3)

**Status:** proposed (2026-10-21), amended 2026-10-22: OpenAI `gpt-6-luna` is the reviewer whenever an OpenAI key is set and no provider is named; `claude-opus-5` stays the Claude default; the maintainer decides whether to keep them · **Tickets:** #11 (layer 3), #12 (the daily job sets the model)

## Context

Review layer 3 asks an LLM to map every changed dispositivo to a command of an amending act it cites, and to name orphan changes and unapplied commands (`src/review/llm.ts`, prompt `src/review/prompts/llm-reviewer.v1.md`). Its answers are never trusted as given: the layer checks the answer's schema and that it accounts for every change, and anything unusable blocks the merge.

Spec #1 asks for a reviewer model independent of the one used to develop the parser. The parser and its tests were developed with `claude-opus-5-5`. The Claude adapter (`src/review/claude.ts`) defaults to `DEFAULT_REVIEW_MODEL = "claude-opus-5"`, and the daily workflow overrides it with the repository variable `AKOMA_REVIEW_MODEL` when set.

The review found that this choice was made in code without a recorded decision.

On 2026-10-22 an OpenAI key became available, and an OpenAI adapter (`src/review/openai.ts`) joined the Claude one behind the same port. It sends the same versioned prompt, constrains the answer to the same schema (Structured Outputs on the Responses API) and fails the same way: an error, a timeout, a refusal, a cut-off answer, malformed JSON or a missing field throws, and the layer reports a blocking problem. Its default model is `DEFAULT_OPENAI_REVIEW_MODEL = "gpt-6-luna"`, the model that key is known to work with.

## Options

1. **Keep `claude-opus-5` (current default).** A model other than the one that wrote the parser, from the same family's large tier, so it reads long Portuguese act texts and many changes per refresh. It is the costliest of the three Claude options per refresh. A refresh with no change makes no call.
2. **A smaller, cheaper model (Sonnet 5).** Lower cost and latency per refresh. Weaker reading of long acts is the risk, and a wrong *pass* is worse than a false alarm (the prompt says so). The layer's own checks catch an answer that skips a change, but not one that maps a change to the wrong command with confidence.
3. **Fable 5.1.** Independent of the Opus line used for development. How well it follows the reviewer's structured-output schema and reads legislative Portuguese has not been measured for Akoma.
4. **OpenAI `gpt-6-luna`.** A different vendor from the model family that developed the parser, so its training and its blind spots overlap least with the parser's author: the strongest independence of the four. OpenAI's model page lists Structured Outputs and the Responses API for it, with reasoning effort up to `max`. Like the others, it has not been measured on Akoma's diffs.

No option has been measured on Akoma's diffs: `pnpm review:live` (`scripts/review-live.ts`) runs the real reviewer once on the EC 141 diff and checks its mapping, and it has not been run with any of these models for this decision. It is a paid call and needs the selected provider's key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`), so it is the maintainer's to run.

## Decision

The provider comes from the environment (`src/review/select.ts`), the same way in the daily job and in `pnpm review:live`:

- `AKOMA_REVIEW_PROVIDER` = `openai` or `anthropic` names it. Its key must be set; a missing key, or any other value, gives no reviewer and a blocking finding, never the other provider.
- Unset (or empty, as an unset Actions variable reads), the reviewer is **OpenAI `gpt-6-luna` when `OPENAI_API_KEY` is set**, else Claude `claude-opus-5` when `ANTHROPIC_API_KEY` is set, else none (blocking). With both keys, OpenAI wins, for the vendor independence above.
- `AKOMA_REVIEW_MODEL` overrides the selected provider's default model. It must be that provider's model id: a Claude id sent to OpenAI (or the reverse) is an API error, so it blocks the merge rather than passing.

Neither adapter falls back to another model or provider. To change a default for everyone, change `DEFAULT_OPENAI_REVIEW_MODEL` in `src/review/openai.ts` or `DEFAULT_REVIEW_MODEL` in `src/review/claude.ts`.

Before switching provider or model, run `[AKOMA_REVIEW_PROVIDER=<provider>] AKOMA_REVIEW_MODEL=<id> pnpm review:live` and keep the switch only if it prints `"correct": true` (the hand-read mapping of EC 141, no orphan change, no unapplied command).

## Consequences

- The provider and model are named in every PR body ("LLM reviewer (layer 3): OpenAI `gpt-6-luna`") and the model that answered in every finding the layer writes, so a change of provider or model is visible in the record.
- A cheaper model lowers the daily cost but raises the chance of a confident wrong mapping; the gates (layer 1, target matching against the acts' commands) still check every change deterministically, so a wrong mapping alone cannot merge a change no command targets.
- Whatever the provider or model, a missing API key, an unknown provider, an error, a refusal or an incomplete answer blocks the merge.
- Adding a key changes the reviewer: once `OPENAI_API_KEY` is set, a repository that also has `ANTHROPIC_API_KEY` reviews with OpenAI unless `AKOMA_REVIEW_PROVIDER=anthropic`.

---

# ADR 0006 (PT): O modelo do revisor LLM (camada 3 de revisão)

**Status:** proposta (21/10/2026), emendada em 22/10/2026: o OpenAI `gpt-6-luna` é o revisor sempre que há chave da OpenAI e nenhum provedor foi nomeado; o `claude-opus-5` continua o padrão do Claude; o mantenedor decide se mantém · **Tickets:** #11 (camada 3), #12 (o job diário define o modelo)

## Contexto

A camada 3 pede a um LLM que associe cada dispositivo alterado a um comando de um ato que ele cita, e que aponte mudanças órfãs e comandos não aplicados (`src/review/llm.ts`, prompt `src/review/prompts/llm-reviewer.v1.md`). A resposta nunca é aceita como veio: a camada confere o esquema e se todas as mudanças foram contadas, e qualquer coisa inutilizável bloqueia o merge.

O spec #1 pede um modelo revisor independente do usado para desenvolver o parser. O parser e os testes foram desenvolvidos com `claude-opus-5-5`. O adaptador do Claude (`src/review/claude.ts`) usa por padrão `DEFAULT_REVIEW_MODEL = "claude-opus-5"`, e o workflow diário o troca pela variável de repositório `AKOMA_REVIEW_MODEL` quando ela existe.

A revisão notou que essa escolha foi feita no código sem uma decisão registrada.

Em 22/10/2026 passou a existir uma chave da OpenAI, e um adaptador da OpenAI (`src/review/openai.ts`) entrou ao lado do Claude, atrás da mesma porta. Ele manda o mesmo prompt versionado, restringe a resposta ao mesmo esquema (Structured Outputs na Responses API) e falha do mesmo jeito: erro, timeout, recusa, resposta cortada, JSON malformado ou campo faltando lançam exceção, e a camada registra um problema bloqueante. O modelo padrão dele é `DEFAULT_OPENAI_REVIEW_MODEL = "gpt-6-luna"`, o modelo com que essa chave comprovadamente funciona.

## Opções

1. **Manter `claude-opus-5` (o padrão atual).** Um modelo diferente do que escreveu o parser, do nível grande da mesma família, para ler atos longos em português e muitas mudanças por atualização. É o mais caro das três opções do Claude por atualização. Uma atualização sem mudança não faz chamada.
2. **Um modelo menor e mais barato (Sonnet 5).** Menor custo e latência por atualização. O risco é ler pior atos longos, e um *aprovado* errado é pior que um alarme falso (o prompt diz isso). As conferências da própria camada pegam uma resposta que pula uma mudança, mas não uma que associa com segurança uma mudança ao comando errado.
3. **Fable 5.1.** Independente da linha Opus usada no desenvolvimento. Não se mediu, para o Akoma, como ele segue o esquema de saída estruturada do revisor e lê português legislativo.
4. **OpenAI `gpt-6-luna`.** De outro fornecedor que não o da família de modelos que desenvolveu o parser, então o treino e os pontos cegos dele são os que menos coincidem com os do autor do parser: a independência mais forte das quatro. A página do modelo na OpenAI lista Structured Outputs e a Responses API para ele, com esforço de raciocínio até `max`. Como os outros, não foi medido nos diffs do Akoma.

Nenhuma opção foi medida nos diffs do Akoma: o `pnpm review:live` (`scripts/review-live.ts`) roda o revisor real uma vez no diff da EC 141 e confere a associação, e não foi rodado com nenhum desses modelos para esta decisão. É uma chamada paga e precisa da chave do provedor escolhido (`OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`), então cabe ao mantenedor.

## Decisão

O provedor vem do ambiente (`src/review/select.ts`), do mesmo jeito no job diário e no `pnpm review:live`:

- `AKOMA_REVIEW_PROVIDER` = `openai` ou `anthropic` o nomeia. A chave dele precisa existir; sem ela, ou com qualquer outro valor, não há revisor e há um achado bloqueante, nunca o outro provedor.
- Sem a variável (ou vazia, como uma variável do Actions não definida chega), o revisor é **o OpenAI `gpt-6-luna` quando `OPENAI_API_KEY` existe**, senão o Claude `claude-opus-5` quando `ANTHROPIC_API_KEY` existe, senão nenhum (bloqueante). Com as duas chaves, vence a OpenAI, pela independência de fornecedor acima.
- `AKOMA_REVIEW_MODEL` substitui o modelo padrão do provedor escolhido. Precisa ser um id de modelo desse provedor: um id do Claude mandado à OpenAI (ou o contrário) é erro de API, então bloqueia o merge em vez de passar.

Nenhum adaptador recorre a outro modelo ou provedor. Para mudar um padrão para todos, mude `DEFAULT_OPENAI_REVIEW_MODEL` em `src/review/openai.ts` ou `DEFAULT_REVIEW_MODEL` em `src/review/claude.ts`.

Antes de trocar de provedor ou de modelo, rode `[AKOMA_REVIEW_PROVIDER=<provedor>] AKOMA_REVIEW_MODEL=<id> pnpm review:live` e só mantenha a troca se ele imprimir `"correct": true` (a associação da EC 141 lida à mão, sem mudança órfã e sem comando não aplicado).

## Consequências

- O provedor e o modelo aparecem em todo corpo de PR ("LLM reviewer (layer 3): OpenAI `gpt-6-luna`"), e o modelo que respondeu, em todo achado da camada, então uma troca de provedor ou de modelo fica visível no registro.
- Um modelo mais barato reduz o custo diário mas aumenta a chance de uma associação errada com segurança; as travas (camada 1, conferência de alvos contra os comandos dos atos) continuam conferindo cada mudança de forma determinística, então uma associação errada sozinha não faz merge de uma mudança que nenhum comando visa.
- Seja qual for o provedor ou o modelo, falta de chave de API, provedor desconhecido, erro, recusa ou resposta incompleta bloqueiam o merge.
- Acrescentar uma chave muda o revisor: definida a `OPENAI_API_KEY`, um repositório que também tem a `ANTHROPIC_API_KEY` revisa com a OpenAI, a menos que `AKOMA_REVIEW_PROVIDER=anthropic`.

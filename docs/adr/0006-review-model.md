# ADR 0006: The LLM reviewer's model (review layer 3)

**Status:** proposed (2026-10-21): the default stays `claude-opus-5`; the maintainer decides whether to keep it · **Tickets:** #11 (layer 3), #12 (the daily job sets the model)

## Context

Review layer 3 asks an LLM to map every changed dispositivo to a command of an amending act it cites, and to name orphan changes and unapplied commands (`src/review/llm.ts`, prompt `src/review/prompts/llm-reviewer.v1.md`). Its answers are never trusted as given: the layer checks the answer's schema and that it accounts for every change, and anything unusable blocks the merge.

Spec #1 asks for a reviewer model independent of the one used to develop the parser. The parser and its tests were developed with `claude-opus-5-5`. The adapter (`src/review/claude.ts`) defaults to `DEFAULT_REVIEW_MODEL = "claude-opus-5"`, and the daily workflow overrides it with the repository variable `AKOMA_REVIEW_MODEL` when set.

The review found that this choice was made in code without a recorded decision.

## Options

1. **Keep `claude-opus-5` (current default).** A model other than the one that wrote the parser, from the same family's large tier, so it reads long Portuguese act texts and many changes per refresh. It is the costliest of the three per refresh. A refresh with no change makes no call.
2. **A smaller, cheaper model (Sonnet 5).** Lower cost and latency per refresh. Weaker reading of long acts is the risk, and a wrong *pass* is worse than a false alarm (the prompt says so). The layer's own checks catch an answer that skips a change, but not one that maps a change to the wrong command with confidence.
3. **Fable 5.1.** Independent of the Opus line used for development. How well it follows the reviewer's structured-output schema and reads legislative Portuguese has not been measured for Akoma.

No option has been measured on Akoma's diffs: `pnpm review:live` (`scripts/review-live.ts`) runs the real reviewer once on the EC 141 diff and checks its mapping, and it has not been run with any of these models for this decision. It is a paid call and needs `ANTHROPIC_API_KEY`, so it is the maintainer's to run.

## Decision

Keep `claude-opus-5` as the default until the maintainer decides. To switch, set the repository variable `AKOMA_REVIEW_MODEL` to the other model's API id (no code change); to change the default for everyone, change `DEFAULT_REVIEW_MODEL` in `src/review/claude.ts`.

Before switching, run `AKOMA_REVIEW_MODEL=<id> pnpm review:live` and keep the switch only if it prints `"correct": true` (the hand-read mapping of EC 141, no orphan change, no unapplied command).

## Consequences

- The model is named in every PR body ("LLM reviewer (layer 3): `<model>`") and in every finding the layer writes, so a change of model is visible in the record.
- A cheaper model lowers the daily cost but raises the chance of a confident wrong mapping; the gates (layer 1, target matching against the acts' commands) still check every change deterministically, so a wrong mapping alone cannot merge a change no command targets.
- Whatever the model, a missing API key, an error, a refusal or an incomplete answer blocks the merge.

---

# ADR 0006 (PT): O modelo do revisor LLM (camada 3 de revisão)

**Status:** proposta (21/10/2026): o padrão continua `claude-opus-5`; o mantenedor decide se mantém · **Tickets:** #11 (camada 3), #12 (o job diário define o modelo)

## Contexto

A camada 3 pede a um LLM que associe cada dispositivo alterado a um comando de um ato que ele cita, e que aponte mudanças órfãs e comandos não aplicados (`src/review/llm.ts`, prompt `src/review/prompts/llm-reviewer.v1.md`). A resposta nunca é aceita como veio: a camada confere o esquema e se todas as mudanças foram contadas, e qualquer coisa inutilizável bloqueia o merge.

O spec #1 pede um modelo revisor independente do usado para desenvolver o parser. O parser e os testes foram desenvolvidos com `claude-opus-5-5`. O adaptador (`src/review/claude.ts`) usa por padrão `DEFAULT_REVIEW_MODEL = "claude-opus-5"`, e o workflow diário o troca pela variável de repositório `AKOMA_REVIEW_MODEL` quando ela existe.

A revisão notou que essa escolha foi feita no código sem uma decisão registrada.

## Opções

1. **Manter `claude-opus-5` (o padrão atual).** Um modelo diferente do que escreveu o parser, do nível grande da mesma família, para ler atos longos em português e muitas mudanças por atualização. É o mais caro dos três por atualização. Uma atualização sem mudança não faz chamada.
2. **Um modelo menor e mais barato (Sonnet 5).** Menor custo e latência por atualização. O risco é ler pior atos longos, e um *aprovado* errado é pior que um alarme falso (o prompt diz isso). As conferências da própria camada pegam uma resposta que pula uma mudança, mas não uma que associa com segurança uma mudança ao comando errado.
3. **Fable 5.1.** Independente da linha Opus usada no desenvolvimento. Não se mediu, para o Akoma, como ele segue o esquema de saída estruturada do revisor e lê português legislativo.

Nenhuma opção foi medida nos diffs do Akoma: o `pnpm review:live` (`scripts/review-live.ts`) roda o revisor real uma vez no diff da EC 141 e confere a associação, e não foi rodado com nenhum desses modelos para esta decisão. É uma chamada paga e precisa de `ANTHROPIC_API_KEY`, então cabe ao mantenedor.

## Decisão

Manter `claude-opus-5` como padrão até o mantenedor decidir. Para trocar, defina a variável de repositório `AKOMA_REVIEW_MODEL` com o id de API do outro modelo (sem mudar código); para mudar o padrão de todos, mude `DEFAULT_REVIEW_MODEL` em `src/review/claude.ts`.

Antes de trocar, rode `AKOMA_REVIEW_MODEL=<id> pnpm review:live` e só mantenha a troca se ele imprimir `"correct": true` (a associação da EC 141 lida à mão, sem mudança órfã e sem comando não aplicado).

## Consequências

- O modelo aparece em todo corpo de PR ("LLM reviewer (layer 3): `<modelo>`") e em todo achado da camada, então uma troca fica visível no registro.
- Um modelo mais barato reduz o custo diário mas aumenta a chance de uma associação errada com segurança; as travas (camada 1, conferência de alvos contra os comandos dos atos) continuam conferindo cada mudança de forma determinística, então uma associação errada sozinha não faz merge de uma mudança que nenhum comando visa.
- Seja qual for o modelo, falta de chave de API, erro, recusa ou resposta incompleta bloqueiam o merge.

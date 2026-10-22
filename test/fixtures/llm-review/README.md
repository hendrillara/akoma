# API response fixtures for the LLM reviewer (Claude, and OpenAI in `openai/`)

`test/llm-review.test.ts` runs the real Claude adapter (`src/review/claude.ts`) with the network replaced by a fake `fetch` that serves one of these files as the response body of `POST /v1/messages`. No test calls the API or uses a credential.

**These files are handwritten, not recorded.** No API key was available when they were made (2026-10-21), so each one follows the Messages API response shape (`type: "message"`, `content` blocks, `stop_reason`, `usage`) as documented, with made-up ids, token counts and an empty `thinking` block with a fake signature. The answers are about the simulated EC 142 refresh (`test/fixtures/refresh/ec142/`); the mapping was read by hand from its act page, `emc142.htm`.

| File | Status | What it is | Expected verdict |
| --- | --- | --- | --- |
| `ec142-mapping.json` | 200 | A complete answer: the five changes mapped to EC 142 arts. 1º–3º, nothing orphan or unapplied | `merge` |
| `malformed.json` | 200 | The same answer cut off mid-string: not JSON | `needs-human` |
| `missing-field.json` | 200 | Valid JSON without `unappliedCommands` | `needs-human` |
| `refusal.json` | 200 | `stop_reason: "refusal"` with `stop_details`, no content | `needs-human` |
| `max-tokens.json` | 200 | `stop_reason: "max_tokens"`, the JSON cut off | `needs-human` |
| `api-error-500.json` | 500 | The API's error body (`api_error`) | `needs-human` |

`index.json` gives each file's HTTP status, SHA-256 and size; the test checks the checksum before serving a file.

When the real adapter first runs with a key (`pnpm review:live`), its response can replace these as a recorded fixture.

## `openai/`: OpenAI Responses API responses

The same contract for the OpenAI adapter (`src/review/openai.ts`): the fake `fetch` serves one of these as the body of `POST https://api.openai.com/v1/responses`. They are handwritten too (2026-10-22, no key used): each follows the documented Response object (`object: "response"`, `status`, `incomplete_details`, `output` with a `reasoning` item and one `message` item whose `content` is an `output_text` or a `refusal`, `usage`), with made-up ids and token counts. The model they report, `gpt-6-luna-2026-09-15`, is a made-up snapshot id, so that the tests tell the model that answered from the one requested (`gpt-6-luna`). The answer texts are the Claude fixtures' answers, word for word.

| File | Status | What it is | Expected verdict |
| --- | --- | --- | --- |
| `ec142-mapping.json` | 200 | `status: "completed"`, the complete answer | `merge` |
| `malformed.json` | 200 | The answer cut off mid-string: not JSON | `needs-human` |
| `missing-field.json` | 200 | Valid JSON without `unappliedCommands` | `needs-human` |
| `refusal.json` | 200 | A `refusal` content item instead of `output_text` | `needs-human` |
| `incomplete.json` | 200 | `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, the JSON cut off | `needs-human` |
| `api-error-500.json` | 500 | The API's error body (`server_error`) | `needs-human` |

`openai/index.json` gives each file's HTTP status, SHA-256 and size, checked the same way.

---

# Fixtures de respostas de API para o revisor LLM (Claude, e OpenAI em `openai/`) (PT)

`test/llm-review.test.ts` executa o adaptador real do Claude (`src/review/claude.ts`) com a rede substituída por um `fetch` falso, que serve um destes arquivos como corpo da resposta de `POST /v1/messages`. Nenhum teste chama a API nem usa credencial.

**Estes arquivos foram escritos à mão, não gravados.** Não havia chave de API quando foram feitos (21/10/2026). Por isso cada um segue o formato documentado de resposta da Messages API (`type: "message"`, blocos de `content`, `stop_reason`, `usage`), com ids e contagens de tokens inventados e um bloco `thinking` vazio com assinatura falsa. As respostas tratam da atualização simulada da EC 142 (`test/fixtures/refresh/ec142/`); o mapeamento foi lido à mão na página do ato, `emc142.htm`.

| Arquivo | Status | O que é | Veredito esperado |
| --- | --- | --- | --- |
| `ec142-mapping.json` | 200 | Resposta completa: as cinco mudanças mapeadas aos arts. 1º–3º da EC 142, nada órfão nem comando não aplicado | `merge` |
| `malformed.json` | 200 | A mesma resposta cortada no meio de uma string: não é JSON | `needs-human` |
| `missing-field.json` | 200 | JSON válido sem `unappliedCommands` | `needs-human` |
| `refusal.json` | 200 | `stop_reason: "refusal"` com `stop_details`, sem conteúdo | `needs-human` |
| `max-tokens.json` | 200 | `stop_reason: "max_tokens"`, o JSON cortado | `needs-human` |
| `api-error-500.json` | 500 | O corpo de erro da API (`api_error`) | `needs-human` |

`index.json` traz o status HTTP, o SHA-256 e o tamanho de cada arquivo; o teste confere o checksum antes de servir o arquivo.

Quando o adaptador real rodar pela primeira vez com uma chave (`pnpm review:live`), a resposta dele pode substituir estes arquivos como fixture gravada.

## `openai/`: respostas da Responses API da OpenAI

O mesmo contrato para o adaptador da OpenAI (`src/review/openai.ts`): o `fetch` falso serve um destes arquivos como corpo de `POST https://api.openai.com/v1/responses`. Também foram escritos à mão (22/10/2026, sem usar chave): cada um segue o objeto Response documentado (`object: "response"`, `status`, `incomplete_details`, `output` com um item `reasoning` e um item `message` cujo `content` é um `output_text` ou um `refusal`, `usage`), com ids e contagens de tokens inventados. O modelo que eles informam, `gpt-6-luna-2026-09-15`, é um id de snapshot inventado, para que os testes distingam o modelo que respondeu do pedido (`gpt-6-luna`). Os textos das respostas são os das fixtures do Claude, palavra por palavra.

| Arquivo | Status | O que é | Veredito esperado |
| --- | --- | --- | --- |
| `ec142-mapping.json` | 200 | `status: "completed"`, a resposta completa | `merge` |
| `malformed.json` | 200 | A resposta cortada no meio de uma string: não é JSON | `needs-human` |
| `missing-field.json` | 200 | JSON válido sem `unappliedCommands` | `needs-human` |
| `refusal.json` | 200 | Um item de conteúdo `refusal` no lugar do `output_text` | `needs-human` |
| `incomplete.json` | 200 | `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, o JSON cortado | `needs-human` |
| `api-error-500.json` | 500 | O corpo de erro da API (`server_error`) | `needs-human` |

O `openai/index.json` traz o status HTTP, o SHA-256 e o tamanho de cada arquivo, conferidos do mesmo jeito.

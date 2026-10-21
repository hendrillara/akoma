# Claude API response fixtures for the LLM reviewer

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

---

# Fixtures de respostas da API Claude para o revisor LLM (PT)

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

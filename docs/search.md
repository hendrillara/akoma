# Search

`GET /v1/search?q=…[&norm=cf|adct|cdc][&limit=1–50]` returns the dispositivos that best match a query, best first. Each result is `{ score, provision }`, and `provision` is the full record with its provenance, the same object `GET /v1/provisions/<norm>/<id>` returns. The response never repeats the query: agents treat these bodies as trusted legal text, so the API never sends back what a request typed. `norm` and `limit` come back only after validation. Errors are 400 `bad_request` (missing or over-long `q`, unknown `norm`, `limit` out of range) and 503 `search_unavailable` (the dataset has no index, or an index built by another analyzer).

## How it works

- **The build makes the index** (`src/search/build-index.ts`, called by `build()`). It is plain JSON: `dataset.search`, published as `search-index.json`. The Worker only reads it. It never builds the index or changes it per request, since the Workers Free plan allows about 10 ms of CPU per request.
- **Documents.** Each in-force dispositivo that has text is one document. Revoked, vetoed and renumbered records are left out. A dispositivo's text is indexed together with the text of the dispositivo it hangs under, at weight 0.5: an inciso with its caput, an alínea with its inciso, a paragraph with its article's caput. So "natos:" is found as part of "São brasileiros: natos".
- **Analysis** (`src/search/analyze.ts`, the same code at build time and at query time):
  - lower case, accents and ordinals folded (`cinqüenta` → `cinquenta`, `5º` → `5`);
  - Portuguese stopwords dropped;
  - plurals reduced to the singular (`ações` → `acao`, `sociais` → `social`, `leis` → `lei`).

  Gender and verb endings stay.
- **BM25** with k1 = 1.2 and b = 0.75 (`src/search/query.ts`). Ties keep dataset order, so results are deterministic.
- **Synonyms** (`data/synonyms.json`) are data, not code. When the analysed query contains a `when` phrase, in order, the entry's `add` words join the query at weight 1. The dictionary maps everyday words, acronyms and doctrine names to the law's own words: "licença-maternidade" → "licença à gestante", "nome sujo" → "informações negativas", "IPVA" → "propriedade de veículos automotores". Entries must be general vocabulary, never the answer to one evaluation question. A test fails when an `add` word appears in no dispositivo.

## Evaluation

`test/search-eval.json` holds 186 questions, each mapped to the dispositivos that answer it: 103 touch the CF, 29 the ADCT and 56 the CDC (some questions expect dispositivos from two norms). 90 of them are colloquial.

- **146 authored questions.** Written by reading the law text before any search code existed, and committed alone first.
- **40 holdout questions.** Written by a second author who saw only the law text: not the dictionary and not the code. Recall on them estimates how the dictionary generalises to phrasings it was not written for. Some of their topics overlap the authored ones.

`test/search.test.ts` runs every question through `GET /v1/search` and measures **recall@10**: the share of a question's expected dispositivos among the first 10 results, averaged over questions. It fails below the first baseline (2026-10-21), rounded down:

| Set | recall@10 | without the dictionary | threshold |
|---|---|---|---|
| all (186) | 0.860 | 0.677 | 0.86 |
| authored (146) | 0.901 | 0.709 | – |
| holdout (40) | 0.713 | 0.563 | 0.71 |
| colloquial (90) | 0.822 | 0.478 | 0.82, and at least 0.25 above the run without the dictionary |

When a change gains questions, raise the thresholds in the same commit. Never edit a question to match what the search returns.

### Choosing the analysis (authored set, recall@10 / @5 / @1)

| Stemming | Parent context | With synonyms | Without |
|---|---|---|---|
| none | 0 | 0.853 / 0.777 / 0.572 | 0.661 / 0.565 / 0.421 |
| none | 0.5 | 0.853 / 0.798 / 0.582 | 0.658 / 0.596 / 0.421 |
| **plural** | **0.5** | **0.901 / 0.846 / 0.596** | 0.709 / 0.640 / 0.455 |
| plural | 0 | 0.887 / 0.839 / 0.575 | 0.675 / 0.599 / 0.449 |
| plural | 1 | 0.884 / 0.805 / 0.589 | 0.695 / 0.640 / 0.469 |
| plural + final vowel cut | 0.5 | 0.901 / 0.846 / 0.589 | 0.729 / 0.647 / 0.452 |

A synonym weight of 0.5 never scored higher than 1. A plural-only stemmer beats no stemming by about 5 points. A further cut of the final vowel, which merges gender forms, gains nothing with synonyms, and it merges words the law keeps apart ("casa"/"caso", "mora"/"moro"), so it was left out. Known weakness: verb forms don't meet ("recusa" ≠ "recusar"). A heavier stemmer (RSLP) is the next experiment if the holdout set shows it matters.

### Cost (Node 24 on an Apple M1 Pro, full CF + ADCT + CDC index)

- **Index.** 903 KiB JSON (224 KiB gzip): 3,732 documents, 5,634 terms, 94 synonym entries.
- **`JSON.parse` of the index:** 3.3 ms, once per isolate.
- **Per query, through the handler and JSON response:** p50 0.15 ms, p95 0.32 ms, max 0.96 ms (930 queries).

Workers CPUs may be slower than this machine, but the margin under 10 ms is wide. Measure with `wrangler dev` once the Worker is deployed.

---

# Busca (PT)

`GET /v1/search?q=…[&norm=cf|adct|cdc][&limit=1–50]` devolve os dispositivos que melhor correspondem à consulta, do mais relevante para o menos relevante. Cada resultado é `{ score, provision }`, e `provision` é o registro completo, com a proveniência: o mesmo objeto que `GET /v1/provisions/<norma>/<id>` devolve. A resposta nunca repete a consulta. Agentes tratam essas respostas como texto legal confiável, então a API nunca devolve o que a requisição digitou. `norm` e `limit` só voltam depois de validados. Os erros são 400 `bad_request` (`q` ausente ou longo demais, `norm` desconhecida, `limit` fora do intervalo) e 503 `search_unavailable` (o dataset não tem índice, ou o índice foi gerado por outro analisador).

## Como funciona

- **O build gera o índice** (`src/search/build-index.ts`, chamado por `build()`). É JSON puro: `dataset.search`, publicado como `search-index.json`. O Worker só lê o índice. Nunca o constrói nem o altera a cada requisição, porque o plano gratuito do Workers permite cerca de 10 ms de CPU por requisição.
- **Documentos.** Cada dispositivo em vigor que tem texto é um documento. Registros revogados, vetados ou renumerados ficam de fora. O texto de um dispositivo é indexado junto com o texto do dispositivo ao qual ele pertence, com peso 0,5: o inciso com o seu caput, a alínea com o seu inciso, o parágrafo com o caput do seu artigo. Assim, "natos:" é encontrado como parte de "São brasileiros: natos".
- **Análise** (`src/search/analyze.ts`, o mesmo código no build e na consulta):
  - caixa baixa, acentos e ordinais removidos (`cinqüenta` → `cinquenta`, `5º` → `5`);
  - stopwords do português descartadas;
  - plural reduzido ao singular (`ações` → `acao`, `sociais` → `social`, `leis` → `lei`).

  Terminações de gênero e de verbo ficam como estão.
- **BM25** com k1 = 1,2 e b = 0,75 (`src/search/query.ts`). Empates mantêm a ordem do dataset, então o resultado é determinístico.
- **Sinônimos** (`data/synonyms.json`) são dados, não código. Quando a consulta analisada contém uma frase de `when`, na ordem, as palavras de `add` entram na consulta com peso 1. O dicionário liga palavras do dia a dia, siglas e nomes de doutrina às palavras da própria lei: "licença-maternidade" → "licença à gestante", "nome sujo" → "informações negativas", "IPVA" → "propriedade de veículos automotores". As entradas devem ser vocabulário geral, nunca a resposta de uma pergunta da avaliação. Um teste falha quando uma palavra de `add` não aparece em nenhum dispositivo.

## Avaliação

`test/search-eval.json` tem 186 perguntas, cada uma ligada aos dispositivos que a respondem: 103 tocam a CF, 29 o ADCT e 56 o CDC (algumas perguntas esperam dispositivos de duas normas). 90 delas são coloquiais.

- **146 perguntas autorais.** Escritas a partir da leitura do texto da lei antes de existir qualquer código de busca, e commitadas sozinhas, primeiro.
- **40 perguntas de holdout.** Escritas por um segundo autor que viu só o texto da lei, sem o dicionário e sem o código. O recall nelas estima o quanto o dicionário generaliza para formulações que ele não previu. Parte dos temas se sobrepõe aos das perguntas autorais.

`test/search.test.ts` roda cada pergunta por `GET /v1/search` e mede o **recall@10**: a fração dos dispositivos esperados de cada pergunta que aparece entre os 10 primeiros resultados, na média das perguntas. O teste falha abaixo da primeira linha de base (21/10/2026), arredondada para baixo: geral 0,86; holdout 0,71; coloquiais 0,82, e pelo menos 0,25 acima da rodada sem o dicionário. As tabelas de medição estão na seção em inglês acima.

Quando uma mudança acerta mais perguntas, suba os limites no mesmo commit. Nunca edite uma pergunta para ela bater com o que a busca devolve.

O stemmer só de plural ganha uns 5 pontos sobre não usar stemmer nenhum. Cortar também a vogal final, que junta as formas de gênero, não ganha nada com os sinônimos ativos. Além disso, esse corte junta palavras que a lei mantém separadas ("casa"/"caso", "mora"/"moro"), por isso ficou de fora. Ponto fraco conhecido: formas verbais não se encontram ("recusa" ≠ "recusar").

Custo medido no Node 24 (Apple M1 Pro), com o índice completo da CF, do ADCT e do CDC:

- **Índice:** 903 KiB de JSON (224 KiB com gzip).
- **`JSON.parse` do índice:** 3,3 ms, uma vez por isolate.
- **Por consulta:** p50 0,15 ms, p95 0,32 ms, máximo 0,96 ms.

Folga ampla sob os 10 ms. Medir de novo com `wrangler dev` quando o Worker for publicado.

# Licença do dataset / Dataset licence

**Português** · [English](#english)

## O que cobre

O **dataset do Akoma** é o que o build gera e o serviço publica: os arquivos de `dataset/` (JSON por artigo, espelhos em Markdown, `dataset.json`, `search-index.json`, `status.json`) e as respostas da API REST e do MCP feitas a partir deles.

## Dataset existente: CC0 1.0, exceto os aliases

Para o material publicado até o commit `262e60ec8e9814ddaca1b9e81c9f63bb90b858e0`, inclusive o dataset `2026-10-21`, na medida do possível pela lei, os Akoma contributors renunciam a todos os direitos autorais e conexos sobre o dataset, sob a [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode). Use, copie, modifique e redistribua sem pedir permissão nem dar crédito.

**Exceção: os campos `aliases`.** Eles são fragmentos de URN do **normas.leg.br / LexML Brasil, © Senado Federal**, sob a [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). A CC0 não os cobre. Quem os redistribuir deve dar o crédito, que já vai junto: no campo `attribution` de cada norma que tem aliases, em toda resposta da API que traz aliases, no `status.json` e em `/v1/status`. O dataset não republica texto nem histórico do normas.leg.br, só esses ids.

## Novas contribuições ao dataset

A [licença atual](LICENSE) se aplica somente a novas contribuições próprias protegíveis, publicadas após esse marco e identificadas como tal nas notas da respectiva versão. Uma atualização, regeneração ou conversão de formato não torna dados antigos, fatos ou texto legal exclusivos. Material novo sem identificação de escopo não deve ser publicado até que o mantenedor registre os termos aplicáveis. O snapshot atual e suas respostas REST/MCP continuam sob as permissões anteriores; este documento não institui cobrança pelo acesso à API hospedada. Os aliases e as capturas de terceiros preservam seus termos.

## O texto das leis

O texto das leis, da Constituição e dos atos oficiais não tem proteção autoral (Lei 9.610/1998, art. 8º, IV). A CC0 cobre a seleção, a estrutura e os metadados que o Akoma acrescenta. Ela não dá a esse texto um caráter oficial: o Akoma não é fonte oficial (veja o [README](README.md)).

## O que não cobre

- **Código:** [licença atual e exceção MIT para o código anterior](LICENSE).
- **`fixtures/`:** capturas brutas de páginas de terceiros, guardadas só como entrada de teste, cada uma nos termos da sua fonte (os arquivos do normas.leg.br são CC BY 4.0). Veja [`fixtures/README.md`](fixtures/README.md).

---

<a id="english"></a>

## English

### What it covers

The **Akoma dataset** is what the build generates and the service publishes: the files in `dataset/` (per-article JSON, Markdown mirrors, `dataset.json`, `search-index.json`, `status.json`) and the REST and MCP answers made from them.

### Existing dataset: CC0 1.0, except the aliases

For material published through commit `262e60ec8e9814ddaca1b9e81c9f63bb90b858e0`, including dataset `2026-10-21`, to the extent possible under law, the Akoma contributors waive all copyright and related rights in the dataset under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode). Use, copy, modify and redistribute it without asking or crediting.

**Exception: the `aliases` fields.** They are URN fragments from **normas.leg.br / LexML Brasil, © Senado Federal**, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). CC0 does not cover them. If you redistribute them, give the credit, which already travels with them: in the `attribution` field of each norm that has aliases, in every API answer that carries aliases, in `status.json` and in `/v1/status`. The dataset does not republish normas.leg.br text or history, only these ids.

### New dataset contributions

The [current licence](LICENSE) applies only to new protectable original contributions published after that boundary and identified as such in the relevant release notes. An update, regeneration or format conversion does not make legacy data, facts or statutory text exclusive. New material without an identified scope must not be published until the maintainer records its applicable terms. The current snapshot and its REST/MCP answers retain their previous permissions; this document does not introduce hosted API access fees. Aliases and third-party captures retain their terms.

### The text of the laws

The text of laws, of the Constitution and of official acts is not protected by copyright in Brazil (Lei 9.610/1998, art. 8º, IV). CC0 covers the selection, structure and metadata Akoma adds. It does not make that text official: Akoma is not an official source (see the [README](README.md#english)).

### What it does not cover

- **Code:** [current licence and legacy MIT exception](LICENSE).
- **`fixtures/`:** raw captures of third-party pages, kept only as test inputs, each under its source's terms (the normas.leg.br files are CC BY 4.0). See [`fixtures/README.md`](fixtures/README.md).

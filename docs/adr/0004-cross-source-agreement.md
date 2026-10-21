# ADR 0004: Cross-source agreement (review layer 2)

**Status:** accepted for v1 (2026-10-21); the `right` rule for known divergences and the "unreachable secondary passes as unconfirmed" rule await the maintainer's confirmation · **Ticket:** #8

## Context

Review layer 2 confirms the primary text (Planalto) against an independent secondary source: normas.leg.br for the CF and the ADCT, Câmara LEGIN for the CDC (ADR 0002). The 2026-10-20 exploration found three traps:

- normas.leg.br **never renumbers its ids, and some repeat**. Its node `art100_par1` is the § 5º that EC 62/2009 renumbered, and `art29_cpt_inc6` exists twice. Matching by its ids pairs the wrong dispositivos.
- Its wording differs from Planalto's in about 9% of dispositivos, almost always by case, commas or spacing. Exact comparison would block every run.
- It versions by publication date, not vigência. It shows EC 141's art. 7º XV as current from 2026-10-16, although EC 141 art. 10 I defers it to 2026-12-17.

LEGIN has no ids at all, annotates in its own style, and has defects of its own.

## Decision

1. **Every dispositivo is matched by the id its printed labels give it.** The id is derived the way the Planalto parser derives Akoma's own: `Art. 103-A` → `art103-1`, `Parágrafo único` → `par1`, `XV –` → `inc15`, read along the node's path. normas.leg.br's own fragment is kept only as an alias (`aliases` on the record), and only where it differs from Akoma's id. A node with no label in any version (CF art. 42 § 3º, ADCT art. 111-A) falls back to its fragment. LEGIN is read by the generic Planalto parser with a Câmara annotation peeler, so its ids come out the same way.
2. **Both wordings are compared after one documented normalisation.** It removes inline markup and entities, case, the diaeresis (pre-2009 spelling: `antigüidade`), ordinal marks (`1º`, `1°`, `1o`, `§ 2 º`), punctuation, quote and dash styles, and the spacing between words. Accents stay: `déficit` against `deficit` still differs.
3. **Each dispositivo gets one outcome, recorded in `provenance.secondary` and counted in the status (`status.json`, `crossSource`):**
   - `agrees`: the normalised wordings are equal, or both sources mark the dispositivo revoked (or vetoed).
   - `agrees` + note when the secondary dates a deferred change early. The primary holds that change as `pending` (ADR 0003), the secondary's latest version is that act's wording, and the primary's text in force equals the secondary's previous version.
   - `secondary-stale` + note: the wordings differ, and the primary cites an amending act that the secondary records neither for this dispositivo nor for any dispositivo above it. normas.leg.br records acts per node and LEGIN per article, because Câmara annotates a whole article on just one of its lines. For example, normas.leg.br lacks EC 136 on CF art. 100 § 5º, though it has EC 136 elsewhere. A dispositivo the secondary lacks, inserted by such an act, is stale too.
   - **Reviewed known divergence** (`src/review/known-divergences.ts`): data, one entry per dispositivo. Each entry pins the exact difference (the words on each side), states which side is right when the page shows it (`right`), and gives a reason. Any other change to either wording turns it back into an unexplained divergence. An entry that no longer applies is reported for removal, and a test keeps the list clean on the recorded sources. `right: primary` (a defect of the secondary, such as a doubled word, a label's ordinal glued to the text or a dropped parenthetical) → `agrees` + reason. `secondary` or `unknown` → `unconfirmed` + reason, because the secondary did not confirm those words.
   - `unconfirmed` + note: the norm has no usable secondary source, the source is unreachable on this run, the dispositivo is not yet in force, or the secondary has no dispositivo with that label. In the last case the build also records a `problem` finding, unless the dispositivo is revoked or vetoed.
   - **Unexplained divergence:** `unconfirmed` in provenance plus a `problem` finding, which blocks the merge. Nothing else blocks.
4. **Dispositivos only the secondary has:** under a dispositivo the primary marks revoked (normas.leg.br keeps a revoked article's subtree; Planalto prints one line), they produce one aggregated note. A revoked or vetoed one gets a note of its own (LEGIN's art. 11-A and art. 39 XV, vetoed insertions Planalto omits). One in force is a `problem`, because the parser may have dropped it.
5. **Findings** have the shape every review layer reports: `{ layer: "cross-source", check, severity: "problem" | "note", norm, id?, act?, message }`. They live in `dataset.status.crossSource[].findings`; `crossSourceFindings(dataset)` hands them to `decide()` (src/review/verdict.ts, #10). Messages and reasons never quote text that only the secondary has.
6. **The build fails when normas.leg.br's undocumented API changes shape.** The guard fails on:
   - a licence other than CC BY 4.0;
   - another URN, a missing articulated root, or an unknown node kind;
   - a version kind outside the 15 known ones (treated as a comma-separated set);
   - a field of the wrong type (`name`, `text`, `legislationConsolidates`), or a dispositivo with no versions;
   - more than 1% of dispositivos with no readable label.

   Two floors stop a renamed field from passing quietly: fewer than 95% of the primary's dispositivos found in the secondary, or fewer than 80% of matched wordings agreeing outright, fails the build. Both floors apply to LEGIN too. On the recorded captures every dispositivo is found, and 95% (ADCT) to 98% (CF, CDC) of wordings agree outright.
7. **Published data:** only the aliases come from normas.leg.br. A norm whose records carry them gets an `attribution` (Senado Federal, CC BY 4.0) in its norm entry, so the credit travels in every per-article JSON. Aliases are excluded from change detection, since they change with the secondary, not with the law.

## Consequences

- On the 2026-10-20/21 captures there is no `problem`. The outcomes:

  | Norm | agrees | secondary-stale | unconfirmed |
  |---|---|---|---|
  | CF | 2,625 | 1 | 30 |
  | ADCT | 696 | 0 | 15 |
  | CDC | 465 | 0 | 7 |

  The list holds 61 reviewed divergences (28 CF, 24 ADCT, 9 CDC).
- The check found two Akoma parser bugs, which were fixed rather than listed:
  - words spaced only by CSS margins in pasted DOU HTML (`o<strong style="margin-left:4px">de cujus</strong>`);
  - the `(Numerado do parágrafo único …)` annotation leaking into ADCT arts. 102 § 1º and 105 § 1º.
- **Open for the maintainer:**
  - `right` was judged from the pages alone, not the DOU, and is `unknown` wherever the page doesn't show which side is right.
  - An unreachable secondary passes as `unconfirmed` (note), so a normas.leg.br outage doesn't block every run. Layers 1 and 3 still apply, and #12's 48h-unreachable issue covers long outages. Making it block is a one-line change.
- `known-divergences.ts` is data to maintain. A Planalto correction or a normas.leg.br update can retire an entry (reported as unused), and a new norm starts with its own list (docs/adding-a-norm.md).

---

# ADR 0004 (PT): Conferência entre fontes (camada 2 de revisão)

**Status:** aceita para a v1 (21/10/2026); a regra `right` das divergências conhecidas e a regra "fonte secundária inacessível passa como `unconfirmed`" aguardam confirmação do mantenedor · **Ticket:** #8

**Contexto:** a camada 2 confere o texto principal (Planalto) com uma fonte secundária independente: o normas.leg.br para a CF e o ADCT, o LEGIN da Câmara para o CDC (ADR 0002). A exploração de 20/10 encontrou três armadilhas:

- O normas.leg.br **nunca renumera seus ids, e alguns se repetem**. O nó `art100_par1` é o § 5º renumerado pela EC 62/2009. Parear pelos ids dele junta os dispositivos errados.
- A redação difere da do Planalto em cerca de 9% dos dispositivos, quase sempre por caixa, vírgulas ou espaços. Uma comparação exata bloquearia toda execução.
- Ele versiona pela data de publicação, não pela vigência. Mostra o art. 7º, XV, da EC 141 como vigente desde 16/10/2026, embora o art. 10, I, da EC 141 o adie para 17/12/2026.

O LEGIN não tem ids, anota no estilo da Câmara e tem defeitos próprios.

**Decisão:**

1. **Cada dispositivo é pareado pelo id que seus rótulos impressos lhe dão,** derivado como o parser do Planalto deriva o do Akoma. O fragmento do normas.leg.br fica só como alias (`aliases`), e só quando difere. Um nó sem rótulo em nenhuma versão (CF art. 42, § 3º; ADCT art. 111-A) usa o próprio fragmento. O LEGIN é lido pelo parser genérico com um leitor de anotações da Câmara.
2. **As duas redações são comparadas após uma normalização documentada.** Ela ignora marcação e entidades, caixa, trema, marcas de ordinal, pontuação, estilos de aspas e travessões, e o espaçamento entre palavras. Os acentos contam.
3. **Cada dispositivo recebe um resultado,** gravado em `provenance.secondary` e contado no status (`status.json`, `crossSource`):
   - `agrees`: redações iguais após a normalização, ou ambas as fontes marcam o dispositivo como revogado (ou vetado).
   - `agrees` com nota quando a fonte secundária data cedo uma mudança diferida: o principal tem a mudança como `pending` (ADR 0003), a última versão da secundária é essa redação, e o texto vigente do principal é a versão anterior da secundária.
   - `secondary-stale` com nota: as redações diferem, e o principal cita um ato que a secundária não registra para o dispositivo nem para nenhum acima dele. O normas.leg.br registra os atos por nó, e o LEGIN por artigo, porque a Câmara anota o artigo inteiro numa só das suas linhas.
   - **Divergência conhecida revisada** (`src/review/known-divergences.ts`): dados, uma entrada por dispositivo. Cada entrada fixa a diferença exata, diz qual lado está certo quando a página mostra (`right`) e dá o motivo. `right: primary` (defeito da secundária) → `agrees` com o motivo. `secondary` ou `unknown` → `unconfirmed` com o motivo. Uma entrada que deixou de valer é apontada para remoção.
   - `unconfirmed` com nota: norma sem fonte utilizável, fonte inacessível nesta execução, dispositivo ainda não vigente, ou dispositivo ausente na secundária. No último caso há também um achado `problem`, salvo se o dispositivo for revogado ou vetado.
   - **Divergência sem explicação:** `unconfirmed` na proveniência e um achado `problem`, que bloqueia o merge. Nada mais bloqueia.
4. **Dispositivos só na secundária:** sob um dispositivo revogado no principal, viram uma nota agregada. Um revogado ou vetado ganha nota própria (os vetos que só o LEGIN imprime: art. 11-A e art. 39, XV). Um vigente é `problem`, porque o parser pode tê-lo perdido.
5. **Achados** têm o formato de toda camada de revisão (`layer`, `check`, `severity`, `norm`, `id`, `act`, `message`) e ficam em `dataset.status.crossSource[].findings`; `crossSourceFindings(dataset)` os entrega ao `decide()` (src/review/verdict.ts, #10). Mensagens e motivos nunca citam texto que só a secundária tem.
6. **O build falha quando a API não documentada do normas.leg.br muda de formato.** O guarda falha em:
   - licença diferente de CC BY 4.0;
   - outra URN, raiz articulada ausente ou tipo de nó desconhecido;
   - tipo de versão fora dos 15 conhecidos;
   - campo com tipo errado, ou dispositivo sem versões;
   - mais de 1% de dispositivos sem rótulo legível.

   Dois pisos impedem que um campo renomeado passe calado: menos de 95% dos dispositivos do principal encontrados na secundária, ou menos de 80% das redações pareadas iguais, faz o build falhar. Os pisos valem também para o LEGIN.
7. **Dados publicados:** do normas.leg.br, só os aliases. A norma cujos registros os têm ganha `attribution` (Senado Federal, CC BY 4.0) na sua entrada, que vai em cada JSON por artigo. Os aliases ficam fora da detecção de mudanças.

**Consequências:**

- Nas capturas de 20 e 21/10 não há nenhum `problem`. Os resultados:
  - CF: 2.625 `agrees`, 1 `secondary-stale`, 30 `unconfirmed`;
  - ADCT: 696 `agrees`, 15 `unconfirmed`;
  - CDC: 465 `agrees`, 7 `unconfirmed`.

  A lista tem 61 divergências revisadas (28 da CF, 24 do ADCT, 9 do CDC).
- A conferência achou dois bugs do parser, corrigidos em vez de listados:
  - palavras separadas só por margens CSS no HTML colado do DOU;
  - a anotação "(Numerado do parágrafo único …)" vazando para o texto do ADCT, arts. 102, § 1º, e 105, § 1º.
- **Fica para o mantenedor:**
  - `right` foi julgado só pelas páginas, sem o DOU, e fica `unknown` onde a página não mostra qual lado está certo.
  - Uma fonte secundária inacessível passa como `unconfirmed`, para que uma queda do normas.leg.br não bloqueie toda execução. As camadas 1 e 3 continuam valendo, e o alerta de 48h do #12 cobre quedas longas.

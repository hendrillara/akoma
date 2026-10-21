# ADR 0002: Deferred vigência from the amending acts, with counted start dates

**Status:** accepted for v1 (2026-10-21); the "em 2027" reading and the art. 239 § 3º hold await the maintainer's confirmation · **Ticket:** #6

## Context

Some amendments take effect after they are published. The compiled CF keeps showing the wording in force, but Planalto marks the deferred changes unevenly:

- **EC 141/2026** rewrites art. 7º XV "após decorridos 2 (dois) meses de sua publicação" (art. 10 I). The CF page shows the old wording plus `(Vide …) (Vigência)`. The new wording appears only on the EC page.
- **EC 132/2023** (tax reform) phases its changes by year. Arts. 3 and 4 reword or insert CF text "em 2027" and "em 2033", art. 5 does the same for the ADCT in 2033, and art. 22 revokes dispositivos in 2027 and 2033. Planalto flags only 14 of these dispositivos, and none of the rewordings: art. 153 V shows today's text with no marker, and art. 37 §§ 17–18 (2027) are not on the page at all.

So the CF page's markers cannot tell which dispositivos have a pending change, or what that change is. And no single-object `pending` field can hold EC 132's two phases on the same dispositivo (art. 146 III "d" is reworded in 2027 and again in 2033).

## Decision

1. **The pending set comes from the amending acts, not from the CF page.** Each norm manifest lists in `deferredActs` the acts whose vigência clause still defers changes to it: CF = EC 132 and EC 141; ADCT = EC 132. The build reads each act's page:
   - its vigência article (`Esta Emenda Constitucional entra em vigor: I - …`), mapping each item to the act's articles or to one cited dispositivo;
   - the quoted blocks of those articles, read with the parser's cursor (placeholders such as `III - ......` only move the cursor);
   - its revocation article, where an item can carry its own date (`I - em 2027, o art. 195, I, "b", e IV, e § 12, da Constituição Federal;`).

   Revoking a § or an article also revokes everything under it. The effect follows from the page: a quoted dispositivo the page has → `wording`; one it doesn't have → `inserted`, recorded with status `not_yet_in_force` and empty text (its parent must be on the page, or the build fails); `(Revogado)` quoted or listed → `revoked`. A missing act page, an unknown clause form or a citation the reader doesn't understand stops the build.
2. **Start dates are counted from the DOU publication date**, read from the act page's footer (`Este texto não substitui o publicado no DOU 16.10.2026`). It can differ from the promulgation date: EC 132 was promulgated on 20.12.2023 and published on 21.12.2023.
   - `após decorridos N dias`: LC 95/1998 art. 8º § 1º counts the publication day and the last day, and the norm is in force on the day after. That is publication + N days.
   - `após decorridos N meses/anos`: the period ends on the corresponding day N months (or years) later. Lei 810/1949 arts. 2º–3º add that when that month has no such day, the period ends on the first day after. The norm is in force on the next day (LC 95 art. 8º § 1º).
   - `em AAAA`: 1 January of that year. This is an interpretation, not a count: it is the first day the clause allows. Each pending entry also carries the clause verbatim (`vigencia`), so a reader sees "em 2027" and not only the date.
   - Any other form (event-based, such as EC 109's "primeira legislatura municipal", or conditional, such as EC 103 art. 36 II) has no computable date. The build fails instead of guessing.
3. **Resulting dates.**

   | Act | Clause | Published (DOU) | `effectiveFrom` |
   |---|---|---|---|
   | EC 141/2026 | art. 10 I: "após decorridos 2 (dois) meses de sua publicação" (art. 7º XV) | 16.10.2026, extra edition | **2026-12-17**. The period runs 16.10 → 16.12.2026, inclusive, and the change is in force the next day. |
   | EC 132/2023 | art. 23 I (arts. 3 and 11) and art. 22 I: "em 2027" | 21.12.2023 | **2027-01-01** |
   | EC 132/2023 | art. 23 II (arts. 4 and 5) and art. 22 II: "em 2033" | 21.12.2023 | **2033-01-01** |

   For EC 141 we considered **2026-12-16** (the corresponding day itself) and rejected it: LC 95 puts the start on the day *after* the last day of the period. The same reading gives the best-known worked example, cited here from general knowledge and not re-checked in this ticket: CPC/2015 (Lei 13.105, published 17.03.2015, "após decorrido 1 (um) ano") came into force on 18.03.2016, as the STJ plenary held.
4. **The build has a date.** `build({ today })` takes a calendar day (YYYY-MM-DD) in Brasília, where a norm takes effect at the start of the day. It defaults to the day the norm's primary page was retrieved, so builds of recorded pages are deterministic; the daily job (#12) passes the run's date. A change whose `effectiveFrom` ≤ `today` is **promoted**:
   - its wording becomes the text in force (a revocation sets `revoked` with empty text);
   - the dispositivo gains an amendment `Redação dada pela …` / `Incluído pela …` / `Revogado pela …` that carries `effectiveFrom`.

   That field marks a change the build applied itself: the change report (#9) lists such a record as `pending-activated`.
5. **The page wins once it shows a change.** Per dispositivo, the latest phase whose result the page already shows is done, and so is every phase before it; only later phases stay outstanding. When Planalto updates the compiled page, nothing is left pending and nothing is applied twice. A 2027 wording never overwrites a page that already shows the 2033 one.
6. **A wording that a later act has reworded since is held, never promoted.** If the page cites an amendment to the dispositivo by a later act of the same type (a higher EC number), the pending entry gets a bilingual `note`. It then stays pending past its date until a person decides. Today this hits one case: **art. 239 § 3º**, which EC 132 art. 3 rewrites for 2027 but EC 135/2024 has reworded since.
7. **Schema** (minor extension of the spec's shape):
   - `pending` is an ordered list of `{ effect: wording | inserted | revoked, text?, effectiveFrom, vigencia, act, note? }`;
   - `status` gains `not_yet_in_force`;
   - `Amendment` gains an optional `effectiveFrom`.

   The spec described a single `pending { text, effectiveFrom, act }`. A list is the smallest shape that holds EC 132's phases, and amending acts already carried an effect.

## Consequences

- With the 2026-10-20/21 captures, the CF and the ADCT carry 86 pending entries on 82 dispositivos, plus 4 dispositivos not yet in force (CF art. 37 §§ 17–18 and art. 195 § 19 I–II).
- `deferredActs` is data to maintain. When a new EC defers a change, its page joins the list (#12 sees every new EC through the amendment index). An act can leave the list once the page shows all its phases.
- Every build of the CF or the ADCT now needs the EC 132 and EC 141 pages in its source. Tests load the `2026-10-20` and `2026-10-21` captures together.
- EC 132 art. 11 is in the 2027 clause, but it is a rule of its own, not CF text, so nothing is staged for it.
- Planalto's own `(Vigência)` markers are kept as references, but they trigger nothing; those pointing to past acts (CPC, EC 103, EC 109) stay plain references.
- Open for the maintainer: confirm "em 2027" = 2027-01-01, and decide art. 239 § 3º before 2027-01-01.

---

# ADR 0002 (PT): Vigência diferida a partir das emendas, com datas contadas

**Status:** aceita para a v1 (21/10/2026); a leitura de "em 2027" e a retenção do art. 239, § 3º, aguardam confirmação do mantenedor · **Ticket:** #6

**Contexto:** algumas emendas só produzem efeito depois de publicadas. A CF compilada continua mostrando a redação vigente, mas o Planalto marca as mudanças diferidas de forma irregular:

- A **EC 141/2026** reescreve o art. 7º, XV, "após decorridos 2 (dois) meses de sua publicação" (art. 10, I). A página da CF mostra a redação antiga com `(Vide …) (Vigência)`, e a nova só aparece na página da EC.
- A **EC 132/2023** escalona as mudanças por ano. Os arts. 3º e 4º alteram ou incluem texto na CF "em 2027" e "em 2033", o art. 5º faz o mesmo no ADCT em 2033, e o art. 22 revoga dispositivos em 2027 e 2033. O Planalto sinaliza só 14 desses dispositivos e nenhuma das novas redações: o art. 153, V, mostra o texto de hoje sem marca, e os §§ 17 e 18 do art. 37 (2027) nem estão na página.

As marcas da página da CF, portanto, não dizem quais dispositivos têm mudança pendente nem qual é a mudança. E um campo `pending` de objeto único não comporta as duas fases da EC 132 num mesmo dispositivo: o art. 146, III, "d", muda em 2027 e de novo em 2033.

**Decisão:**

1. **O conjunto pendente vem das emendas, não da página da CF.** Cada manifesto lista em `deferredActs` as emendas cuja cláusula de vigência ainda adia mudanças na norma: na CF, as EC 132 e 141; no ADCT, a EC 132. O build lê a página de cada emenda:
   - o artigo de vigência, ligando cada inciso a artigos da emenda ou a um dispositivo citado;
   - os blocos entre aspas desses artigos, lidos com o cursor do parser (`III - ......` só move o cursor);
   - o artigo de revogação, cujos incisos podem ter data própria.

   Revogar um § ou um artigo revoga tudo o que está abaixo dele. O efeito sai da página: dispositivo citado que a página tem → `wording`; que não tem → `inserted`, com status `not_yet_in_force` e texto vazio (o pai precisa estar na página, senão o build falha); `(Revogado)` citado ou listado → `revoked`. Página ausente, forma de cláusula desconhecida ou citação não entendida param o build.
2. **As datas contam da publicação no DOU**, lida no rodapé da página da emenda. Essa data pode diferir da promulgação: a EC 132 foi promulgada em 20/12/2023 e publicada em 21/12/2023.
   - **N dias:** a LC 95/1998, art. 8º, § 1º, inclui o dia da publicação e o último dia, e a vigência começa no dia seguinte; o resultado é a publicação + N dias.
   - **N meses ou anos:** o prazo termina no dia correspondente. Se o mês não tiver esse dia, termina no primeiro dia seguinte (Lei 810/1949, arts. 2º e 3º). A vigência começa no dia seguinte ao fim do prazo.
   - **"Em AAAA":** 1º de janeiro do ano. É uma interpretação, não uma contagem: o primeiro dia que a cláusula admite. Cada entrada traz a cláusula literal (`vigencia`).
   - **Outras formas** (por evento ou condicionais, como as das EC 109 e EC 103, art. 36, II) não têm data calculável, e o build falha em vez de adivinhar.
3. **Datas resultantes:**
   - **EC 141:** DOU de 16/10/2026, edição extra. O prazo vai de 16/10 a 16/12/2026 e a vigência começa em **2026-12-17**. A data 2026-12-16 foi considerada e rejeitada, porque a LC 95 põe o início no dia *seguinte* ao último dia do prazo. O exemplo mais conhecido da mesma regra, citado de memória e não reconferido neste ticket, é o CPC/2015: publicado em 17/03/2015, entrou em vigor em 18/03/2016, segundo o Plenário do STJ.
   - **EC 132:** DOU de 21/12/2023. A fase de 2027 (art. 23, I, e art. 22, I) começa em **2027-01-01** e a de 2033 (art. 23, II, e art. 22, II) em **2033-01-01**.
4. **O build tem data.** `build({ today })` recebe um dia do calendário de Brasília. O padrão é o dia em que a página principal foi capturada, o que mantém os testes determinísticos; o job diário (#12) passa a data da execução. Uma mudança com `effectiveFrom` ≤ `today` é **promovida**: a redação passa a vigorar (uma revogação deixa status `revoked` e texto vazio), e o dispositivo ganha uma alteração "Redação dada / Incluído / Revogado pela …" com `effectiveFrom`. Por esse campo, o relatório de mudanças (#9) lista o registro como `pending-activated`.
5. **A página prevalece quando já mostra a mudança.** Por dispositivo, a fase mais recente que a página já reflete conta como aplicada, junto com todas as anteriores; só as fases posteriores ficam pendentes. Assim, uma redação de 2027 nunca sobrescreve a de 2033 que a página já mostra.
6. **Uma redação que um ato posterior já alterou fica retida e nunca é promovida.** Se a página cita uma alteração do dispositivo por uma EC de número maior, a entrada pendente ganha uma `note` e espera decisão humana. Hoje isso atinge um caso: o **art. 239, § 3º**, que a EC 132, art. 3º, reescreve para 2027, mas que a EC 135/2024 já alterou.
7. **Esquema:** `pending` é uma lista ordenada; `status` ganha `not_yet_in_force`; `Amendment` ganha `effectiveFrom` opcional. É uma extensão pequena do formato do spec, que previa um único `pending`.

**Consequências:**

- Com as capturas de 20 e 21/10, a CF e o ADCT têm 86 entradas pendentes em 82 dispositivos, mais 4 dispositivos ainda não vigentes.
- `deferredActs` é um dado a manter: uma emenda nova com vigência diferida entra na lista (o #12 vê cada EC nova pelo quadro de emendas), e sai quando a página já mostra todas as suas fases.
- Todo build da CF ou do ADCT precisa das páginas das EC 132 e 141.
- Fica para o mantenedor confirmar "em 2027" = 2027-01-01 e decidir o art. 239, § 3º, antes de 1º/1/2027.

# ADR 0001: Fetch Planalto directly from GitHub Actions

**Status:** accepted (2026-10-21), pending time-of-day confirmation by the scheduled runs · **Ticket:** #3

## Context

Planalto (`planalto.gov.br`, behind an F5 firewall) resets connections from non-browser user agents. Research on 2026-10-20 ran from a residential IP only, so it was unknown whether datacenter IPs such as GitHub Actions runners are also filtered. The answer decides whether v1 needs the R2 fallback (#13): a scheduled Cloudflare Worker storing raw pages in R2.

## Evidence

The probe workflow (`scripts/probe-planalto.mjs`) requested the CF compiled page and the amendment index from `ubuntu-latest` runners. It sent a plain GET with `Mozilla/5.0 (compatible; akoma/0.0.0)`, the same request again with `If-None-Match`, and a control GET with curl's default UA.

| Run | When (UTC) | Plain GET | Conditional GET | Control (curl UA) |
|---|---|---|---|---|
| [39540625907](https://github.com/hendrillara/akoma/actions/runs/39540625907) | 2026-10-21 03:49 | 200 / 200 | 304 / 304 | timeout / timeout |
| [39540718248](https://github.com/hendrillara/akoma/actions/runs/39540718248) | 2026-10-21 03:50 | 200 / 200 | 304 / 304 | timeout / timeout |
| [39540797066](https://github.com/hendrillara/akoma/actions/runs/39540797066) | 2026-10-21 03:51 | 200 / 200 | 304 / 304 | timeout / timeout |

(CF page / amendment index.) The bytes and ETags matched the committed fixtures. The control requests got no response within 15 s on the same runner (a timeout, not a TCP reset as seen from the residential IP), while the Akoma UA was served. So the runner's IP is not blocked; the firewall treats requests by user agent.

## Decision

The daily publish workflow (#12) fetches Planalto directly from GitHub Actions, using the Akoma UA and conditional requests. The R2 fallback (#13) is **not needed for v1**.

## Consequences

- All three runs fell in one time window. GitHub only fires schedules from the default branch, so once this merges the probe runs every 6 hours to cover other hours; revisit this ADR if any scheduled run fails. Remove the schedule once #12 is live.
- **Update (#12, 2026-10-21):** the daily publish job (`.github/workflows/publish.yml`, 09:17 UTC) now fetches Planalto from a runner every day with the Akoma UA and conditional requests (`src/sources/http.ts`), so the probe's 6-hour schedule is removed; the probe stays runnable by hand (`workflow_dispatch`). Each run records per-source reachability in the run status, and a source unreachable for more than 48 hours opens the outage issue. A manual dry run of the job from a residential connection on 2026-10-21 got 304 for both conditional requests and 200 for the 7 full GETs (Planalto, normas.leg.br, LEGIN).
- If Planalto later blocks runner IPs, #12's ">48h source unreachable" issue surfaces it, and #13 becomes the plan.
- The UA must stay honest and browser-compatible (`Mozilla/5.0 (compatible; akoma/<ver>)`), with no contact info or personal identifier.

---

# ADR 0001 (PT): Buscar o Planalto direto do GitHub Actions

**Status:** aceita (21/10/2026), aguardando confirmação em outros horários pelas execuções agendadas · **Ticket:** #3

**Contexto:** o Planalto, atrás de um firewall F5, corta conexões de user agents que não parecem navegador. A pesquisa de 20/10 rodou só de IP residencial, então não se sabia se IPs de datacenter (runners do GitHub Actions) também são filtrados. A resposta decide se a v1 precisa do fallback R2 (#13).

**Evidência:** o workflow de probe (`scripts/probe-planalto.mjs`) pediu a página compilada da CF e o índice de emendas a partir de runners `ubuntu-latest`. Cada URL recebeu um GET simples com `Mozilla/5.0 (compatible; akoma/0.0.0)`, o mesmo pedido com `If-None-Match` e um GET de controle com o UA padrão do curl. Houve três execuções em 21/10/2026, entre 03:49 e 03:51 UTC ([39540625907](https://github.com/hendrillara/akoma/actions/runs/39540625907), [39540718248](https://github.com/hendrillara/akoma/actions/runs/39540718248), [39540797066](https://github.com/hendrillara/akoma/actions/runs/39540797066)). Em todas, o GET simples deu 200 e o condicional 304, com bytes e ETags iguais aos das fixtures. Já o controle ficou sem resposta por 15 s no mesmo runner: um timeout, não o reset de TCP visto do IP residencial. Portanto, o IP do runner não está bloqueado; o firewall decide pelo user agent.

**Decisão:** o workflow diário (#12) busca o Planalto direto do GitHub Actions, com o UA do Akoma e requisições condicionais. O fallback R2 (#13), em que um Cloudflare Worker agendado guarda as páginas brutas no R2, **não é necessário na v1**.

**Consequências:** as três execuções caíram na mesma janela de horário. O GitHub só dispara agendamentos a partir do branch padrão; depois do merge, o probe roda a cada 6 horas para cobrir outros horários, e esta ADR deve ser revista se alguma execução agendada falhar. O agendamento sai quando o #12 estiver rodando. **Atualização (#12, 21/10/2026):** o job diário de publicação (`.github/workflows/publish.yml`, 09:17 UTC) passou a buscar o Planalto de um runner todo dia, com o UA do Akoma e requisições condicionais (`src/sources/http.ts`); por isso o agendamento de 6 horas do probe saiu, e o probe continua disponível para execução manual (`workflow_dispatch`). Cada execução registra no status se cada fonte respondeu, e uma fonte inacessível por mais de 48 horas abre a issue de indisponibilidade. Se o Planalto passar a bloquear os IPs dos runners, a issue de "fonte inacessível por mais de 48h" do #12 avisa, e o #13 vira o plano. O UA precisa continuar honesto e compatível com navegador, sem contato nem identificador pessoal.

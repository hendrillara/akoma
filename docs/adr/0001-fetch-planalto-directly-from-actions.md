# ADR 0001: Fetch Planalto directly from GitHub Actions

**Status:** accepted (2026-10-21) · **Ticket:** #3

## Context

Planalto (`planalto.gov.br`, behind an F5 firewall) resets connections from non-browser user agents. Research on 2026-10-20 ran from a residential IP only, so it was unknown whether datacenter IPs such as GitHub Actions runners are also filtered. The answer decides whether v1 needs the R2 fallback (#13): a scheduled Cloudflare Worker storing raw pages in R2.

## Evidence

The probe workflow (`scripts/probe-planalto.mjs`) requested the CF compiled page and the amendment index from `ubuntu-latest` runners. It sent a plain GET with `Mozilla/5.0 (compatible; akoma/0.0.0)`, the same request again with `If-None-Match`, and a control GET with curl's default UA.

| Run | When (UTC) | Plain GET | Conditional GET | Control (curl UA) |
|---|---|---|---|---|
| [39540625907](https://github.com/hendrillara/akoma/actions/runs/39540625907) | 2026-10-21 03:49 | 200 / 200 | 304 / 304 | timeout / timeout |
| [39540718248](https://github.com/hendrillara/akoma/actions/runs/39540718248) | 2026-10-21 03:50 | 200 / 200 | 304 / 304 | timeout / timeout |
| [39540797066](https://github.com/hendrillara/akoma/actions/runs/39540797066) | 2026-10-21 03:51 | 200 / 200 | 304 / 304 | timeout / timeout |

(CF page / amendment index.) The bytes and ETags matched the committed fixtures. The control requests failing on the same runner shows the filter keys on the user agent, not on the runner's IP.

## Decision

The daily publish workflow (#12) fetches Planalto directly from GitHub Actions, using the Akoma UA and conditional requests. The R2 fallback (#13) is **not needed for v1**.

## Consequences

- All three runs fell in one time window. Until #12 runs daily, the probe also runs on a schedule (every 6 hours) to cover other hours. Remove the schedule once #12 is live.
- If Planalto later blocks runner IPs, #12's ">48h source unreachable" issue surfaces it, and #13 becomes the plan.
- The UA must stay honest and browser-compatible (`Mozilla/5.0 (compatible; akoma/<ver>)`), with no contact info or personal identifier.

---

# ADR 0001 (PT): Buscar o Planalto direto do GitHub Actions

**Status:** aceita (21/10/2026) · **Ticket:** #3

**Contexto:** o Planalto, atrás de um firewall F5, corta conexões de user agents que não parecem navegador. A pesquisa de 20/10 rodou só de IP residencial, então não se sabia se IPs de datacenter (runners do GitHub Actions) também são filtrados. A resposta decide se a v1 precisa do fallback R2 (#13).

**Evidência:** três execuções do probe em runners `ubuntu-latest`, em 21/10/2026 por volta de 03:50 UTC (tabela acima). Com o UA do Akoma, o GET simples deu 200 e o condicional deu 304; bytes e ETags bateram com as fixtures. A requisição de controle, com o UA padrão do curl, foi cortada no mesmo runner. Logo, o filtro é por user agent, não por IP.

**Decisão:** o workflow diário (#12) busca o Planalto direto do GitHub Actions, com o UA do Akoma e requisições condicionais. O fallback R2 (#13) **não é necessário na v1**.

**Consequências:** as três execuções caíram na mesma janela de horário. Até o #12 entrar no ar, o probe roda a cada 6 horas para cobrir outros horários; o agendamento sai quando o #12 estiver rodando. Se o Planalto passar a bloquear os IPs dos runners, a issue de "fonte inacessível por mais de 48h" do #12 avisa, e o #13 vira o plano. O UA precisa continuar honesto e compatível com navegador, sem contato nem identificador pessoal.

# Akoma — agent instructions

Akoma mirrors Brazilian federal legislation (CF + ADCT first, then CDC, CLT…) as structured, per-dispositivo data, refreshed by a daily job and served to AI agents via static files, a REST API and a remote MCP at akoma.hendril.dev. Stage: building (spec #1). Open source, personal project; it is NOT related to Locus/Kanzen or Lucentive.

## Map
Check here before searching. When a listed path moves, update this Map in the same commit (the map check fails otherwise).
- `src/schema/` — dataset types shared by the pipeline (producer) and the Worker (consumer)
- `src/pipeline/` — the build: raw snapshots + norm manifests → dataset (test seam 1); `planalto.ts` page → dispositivos, `annotations.ts` annotations → metadata, `acts.ts` amending-act page → deferred changes, `vigencia.ts` + `vigencia-dates.ts` pending wordings, start dates and promotion (ADR 0002), `files.ts` dataset → per-article JSON + Markdown mirrors
- `src/norms/` — one declarative manifest per norm (`cf.ts`, `adct.ts`: identity, primary Planalto URL, page quirks, `deferredActs` with pending vigência)
- `src/sources/` — the `Source` port and its adapters (recorded fixtures today; live HTTP next, per ADR 0001)
- `src/worker/` — the served API: HTTP request → response over a dataset (test seam 2)
- `test/` — seam tests only (`build.test.ts`, `cf-adct.test.ts` and `vigencia.test.ts` = seam 1, `api.test.ts` = seam 2); no unit tests of parser internals
- `test/vigencia.test.ts` — deferred vigência: EC 141 and EC 132 pending wordings, promotion by build date, page-already-applied scenarios
- `test/cf-adct.test.ts` — CF/ADCT golden set (hand-verified against the fixture HTML), structural invariants, full-text snapshot
- `test/snapshots/` — committed full-text Markdown mirrors of the CF and ADCT (generated; never hand-edited)
- `test/fixtures/` — scenario fixtures derived from real pages (`hygiene/`: cp1252 parser-hygiene page, see its README)
- `fixtures/` — committed raw source captures (checksummed `index.json` per capture; `2026-10-21/` = the EC 132 page; normas.leg.br files are CC BY 4.0, see its README)
- `scripts/probe-planalto.mjs` — checks whether Planalto serves a runner (Akoma UA, conditional GET, control UA)
- `docs/adr/` — architecture decisions (0001: fetch Planalto directly from Actions; no R2 fallback in v1; 0002: deferred vigência from the amending acts, start-date counting)
- `docs/research/2026-10-20-sources.md` — source-of-truth research: Planalto, normas.leg.br, LEGIN, LexML IDs, parser traps, accuracy checks
- `docs/agents/` — issue tracker, triage labels, domain-doc rules for the engineering skills
- GitHub Issues — the spec (#1) and tickets live there (see `docs/agents/issue-tracker.md`)

The full 2026-10-20 raw capture (all codes, 40 MB) is local-only in the git-ignored `.scratch/raw-2026-10-20/`.

## Verify
`pnpm verify` must pass before calling work done: typecheck, both seam test suites and the Map check (the same command CI runs). It needs no server and no network.
A failing full-text snapshot (`test/snapshots/*.md`) means the CF/ADCT text changed: regenerate with `pnpm vitest run -u` only when a parser fix or a new fixture explains every line of the diff.

## Rules
- Never hand-edit generated legal data (JSON/MD): fix the parser, manifest or tests and regenerate. Text corrections come from the source, never from a person.
- Planalto is the primary text source; normas.leg.br and Câmara LEGIN are cross-checks only. normas.leg.br is CC BY 4.0: the published dataset must not republish its text or history (only ID aliases, with attribution); committed test fixtures from it carry attribution in their README.
- Requests to government sites use `Mozilla/5.0 (compatible; akoma/<ver>)`, conditional GETs and low rates. Never put a personal identifier (email, name) in a request. Only exception: the probe's control request uses curl's default UA on purpose, to detect UA filtering (ADR 0001).
- Docs: technical docs in English and Portuguese; code and schema in English; legal content verbatim in Portuguese.

## Gotchas
- Planalto resets connections from non-browser user agents (curl default, python-requests, empty UA).
- Planalto pages are cp1252 with no charset declared; struck text appears as `<strike>`, `<s>` or CSS line-through, even on "compilado" pages.

## Git & deploy
- Remote `origin` = github.com/hendrillara/akoma (public), branch `main`. Pushing and deploying to Cloudflare need explicit OK.

## Agent skills

### Issue tracker

GitHub Issues on hendrillara/akoma via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, names unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.

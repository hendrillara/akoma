# Akoma — agent instructions

Akoma mirrors Brazilian federal legislation (CF + ADCT first, then CDC, CLT…) as structured, per-dispositivo data, refreshed by a daily job and served to AI agents via static files, a REST API and a remote MCP at akoma.hendril.dev. Stage: spec. Open source, personal project; it is NOT related to Locus/Kanzen or Lucentive.

## Map
Check here before searching. When a listed path moves, update this Map in the same commit (the map check fails otherwise).
- `docs/research/2026-10-20-sources.md` — source-of-truth research: Planalto, normas.leg.br, LEGIN, LexML IDs, parser traps, accuracy checks
- `.scratch/raw-2026-10-20/` — git-ignored raw source responses; use as parser fixtures
- `docs/agents/` — issue tracker, triage labels, domain-doc rules for the engineering skills
- GitHub Issues — the spec and tickets live there (see `docs/agents/issue-tracker.md`)

## Verify
`node ~/.claude/bin/check-agent-map.mjs AGENTS.md` must pass. No build or test command exists yet; add it here when the first package lands.

## Rules
- Never hand-edit generated legal data (JSON/MD): fix the parser, manifest or tests and regenerate. Text corrections come from the source, never from a person.
- Planalto is the primary text source; normas.leg.br and Câmara LEGIN are cross-checks only. normas.leg.br is CC BY 4.0: the published dataset must not republish its text or history (only ID aliases, with attribution); committed test fixtures from it carry attribution in their README.
- Requests to government sites use `Mozilla/5.0 (compatible; akoma/<ver>)`, conditional GETs and low rates. Never put a personal identifier (email, name) in a request.
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

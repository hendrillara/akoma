# Akoma — agent instructions

Akoma mirrors Brazilian federal legislation (CF + ADCT first, then CDC, CLT…) as structured, per-dispositivo data, refreshed by a daily job and served to AI agents via static files, a REST API and a remote MCP at akoma.hendril.dev. Stage: building (spec #1). Open source, personal project; it is NOT related to Locus/Kanzen or Lucentive.

## Map
Check here before searching. When a listed path moves, update this Map in the same commit (the map check fails otherwise).
- `README.md` — what Akoma is and is not, MCP connection, REST examples (checked by `test/discovery.test.ts`), accuracy guarantees and known limits, licences (PT first, then EN)
- `LICENSE` — MIT (code), "Akoma contributors"
- `LICENSE-DATA.md` — CC0 1.0 for the dataset except the `aliases` (normas.leg.br / LexML, © Senado Federal, CC BY 4.0) (PT + EN)
- `CONTRIBUTING.md` — PR scope (parser, manifests, tests), no hand-edited data, the divergence-issue flow (#18) (PT + EN)
- `docs/agent-discovery-check.md` — the recorded check that an agent given only the MCP URL finds and uses the tools (local `wrangler dev`; production pending)
- `src/schema/` — dataset types shared by the pipeline (producer) and the Worker (consumer); `SCHEMA_VERSION` is the format's semver, with the bump rule in its comment and the README
- `src/pipeline/` — the build: raw snapshots + norm manifests → dataset (test seam 1); `planalto.ts` page → dispositivos, groupings (headings with LexML ids and names) and articles, `annotations.ts` annotations → metadata, `acts.ts` amending-act page → deferred changes (build) and every command's targets (review), `vigencia.ts` + `vigencia-dates.ts` pending wordings, start dates and promotion (ADR 0003), `files.ts` dataset → per-article JSON + Markdown mirrors + `search-index.json` + `dataset.json` (the whole dataset, which the Worker bundles) + `_headers` (static-asset CORS), `changes.ts` previous + new dataset → change report (data + Markdown PR body)
- `src/review/` — the review of a refresh: `verdict.ts` findings from every layer → `merge` | `needs-human`; `gates.ts` layer 1 (schema, id stability, invariants, per-norm-and-kind counts against the previous dataset (`COUNT_TOLERANCE`), promoted wording vs page, target matching against the commands of every act a change cites (ECs, laws, MPs: `citedActs`); `reviewDeferredActs`, run by the daily job: a new deferring EC missing from `deferredActs`); `llm.ts` layer 3, the LLM reviewer port and the checks on its answer (every change mapped or orphan, unapplied commands); `claude.ts` its Claude API adapter (structured output; `model` option, which the daily job sets from `AKOMA_REVIEW_MODEL`); `prompts/` the versioned reviewer prompts (`llm-reviewer.v1.md`)
- `src/norms/` — one declarative manifest per norm (`cf.ts`, `adct.ts`, `cdc.ts`: identity, primary Planalto URL, secondary sources, known quirks, `deferredActs` with pending vigência); `index.ts` is the registry of all norms
- `src/review/` — the review layers; `cross-source.ts` = layer 2 (each dispositivo vs its secondary source → outcome in provenance + status, blocking findings; ADR 0004), `normas.ts` normas.leg.br JSON-LD reader + response-shape guard, `legin.ts` Câmara LEGIN reader, `known-divergences.ts` reviewed source differences (data, one reason each), `act-pages.ts` an act's Planalto address from its identity (links never fetched as given) and the check that a fetched page is the act's
- `src/sources/` — the `Source` port (`get`, and `probe` for conditional requests) and its adapters: `recorded.ts` fixture captures (an `unavailable` list shadows older folders), `http.ts` live HTTP (ADR 0001: Akoma UA, conditional GETs, one request at a time; https on `ALLOWED_HOSTS` only, redirects only there; never called from tests), `redact.ts` page metadata redacted by an allowlist over the page as parse5 reads it (only the charset declaration and stylesheet links kept; every other meta, every comment, raw-text content and Office XML/property element blanked; fails closed with `RedactionError` on a page it cannot redact with certainty; only normas.leg.br's API JSON passes unread; the job and the recheck wrap every source in it, and the committed captures are redacted the same way)
- `src/publish/` — the daily publish job (#12; docs/publishing.md): `job.ts` `runDailyJob` (pre-filter, rebuild on moved pages or due pending changes, three-layer review, PR merged or labelled, failure/outage issues, run status), `published.ts` dataset/ as the regeneration of the committed captures (`build:dataset`, `check:dataset`), `capture.ts` the recording source and the `fixtures/<day>-daily/` capture, `github.ts` the GitHub port (`memoryGitHub` for dry runs and tests, `ghCli` for the workflow), `workspace.ts` the working-tree port, `status.ts` run status + badge, `pr-body.ts` the PR body and its 65,536-character cut; the text-divergence intake (#18): `recheck.ts` `runRecheck` (issue event → recheck of one dispositivo or article → comment, and on a confirmed divergence a forced-rebuild dispatch of `publish.yml`), `divergence.ts` the untrusted form → registered norm + dataset ids, and the markers in the job's own comments (dedupe, daily cap, the daily job's follow-ups)
- `dataset/` — the published dataset (generated by `pnpm build:dataset`, never edited; `pnpm check:dataset` in verify fails on any difference from the regeneration)
- `docs/publishing.md` — the daily job, the divergence recheck (#18), the regeneration guard, the run status branch and badge, and the repository settings the workflows need
- `scripts/publish.ts` — `pnpm publish:daily`: the daily job (`--rebuild` skips the pre-filter; `--dry-run [--recorded <folders…>] [--now <instant>]` touches no GitHub and writes `out/dry-run/`)
- `scripts/recheck.ts` — `pnpm recheck`: the divergence recheck, reading the issue from `GITHUB_EVENT_PATH` (`--dry-run --event <file> [--recorded …] [--now …]` prints the comment instead)
- `scripts/build-dataset.ts` — `pnpm build:dataset`; `scripts/check-dataset.ts` — `pnpm check:dataset`
- `.github/workflows/publish.yml` — the daily cron (09:17 UTC) running the job, and its dispatch (`rebuild` from the recheck)
- `.github/workflows/` (all of them) — every action pinned by commit SHA with its version as a comment, pnpm from `corepack enable` (no third-party setup action), a minimal `permissions:` block per workflow; `ci.yml` runs `pnpm verify` on every push and PR
- `.github/dependabot.yml` — weekly PRs that move the actions' SHA pins (github-actions only)
- `.github/workflows/recheck.yml` — `issues: opened/edited` with the `text-divergence` label → `scripts/recheck.ts`; contents read, issues + actions write, no secrets, no issue expression in any script
- `.github/ISSUE_TEMPLATE/text-divergence.yml` — the "Divergência de texto / Text divergence" issue form (PT + EN): norm (dropdown of the registered norms), dispositivo, what looks wrong
- `src/search/` — BM25 search shared by both sides: `analyze.ts` text → terms (same code at build and query time), `build-index.ts` dispositivos + synonyms → prebuilt index (build), `query.ts` index + query → ranked hits (Worker)
- `src/worker/` — the served API: HTTP request → response over a dataset (test seam 2); `handler.ts` routes `/v1/` (flat route table, `format=md`, CDN cache headers, 429), `views.ts` each endpoint's JSON + Markdown, `rate-limit.ts` the limiter port (Workers binding adapter, in-memory window), `search.ts` `GET /v1/search`, `mcp.ts` `POST /mcp` (stateless remote MCP over the official SDK: tools `search`, `get_provision`, `get_structure`, `list_norms` answering with the views' Markdown; arguments checked before any view, every SDK error message replaced by a fixed one, JSON-RPC ids accepted only as integers or short plain strings); `discovery.ts` `/llms.txt` and the `/usage.md` agent guide (fixed base URL, the dataset's norm list); `worker.ts` the deployed Worker over a dataset and its bindings (rate-limit binding or in-memory fallback, `RATE_LIMIT`), `main.ts` the wrangler entry (bundles `dataset/dataset.json`, global-scope setup), `modules.d.ts` types of the bundle-only modules
- `data/synonyms.json` — the search synonym dictionary (everyday words and acronyms → the law's words); data, not code
- `docs/search.md` — how search works, the evaluation set and its thresholds, the analysis choices and their measurements, query cost
- `test/` — seam tests only (`build.test.ts`, `cf-adct.test.ts`, `cdc.test.ts`, `changes.test.ts`, `vigencia.test.ts`, `review.test.ts`, `llm-review.test.ts`, `structure.test.ts`, `cross-source.test.ts`, `publish.test.ts` (the daily job in dry run, the regeneration guard) and `recheck.test.ts` (the divergence intake: the rendered issue form → comment, dispatch and, through the daily job, the correction PR; malicious bodies, dedupe, cap) = seam 1, `api.test.ts`, `search.test.ts`, `discovery.test.ts` (`/llms.txt`, `/usage.md`, and every `/v1/` example in them and in the README answers) and `mcp.test.ts` (the official MCP client over an in-process fetch, both protocol eras) and `worker.test.ts` (the deployed entry: bindings, fallback, edge-cache headers) = seam 2); no unit tests of parser internals
- `test/structure.test.ts` — groupings (LexML ids, verbatim heading names and annotations) and article records, hand-checked against the fixture HTML
- `test/search-eval.json` — search evaluation set: questions → expected dispositivos (authored + holdout); `search.test.ts` enforces its recall@10 thresholds
- `test/cf-adct.test.ts` — CF/ADCT golden set (hand-verified against the fixture HTML), structural invariants, full-text snapshot
- `test/cdc.test.ts` — CDC golden set (hand-verified against the fixture HTML), structural invariants, full-text snapshot, secondary source
- `test/cross-source.test.ts` — review layer 2: outcomes on the recorded sources, scenarios (stale, divergence, missing, no secondary) and the normas.leg.br shape guard
- `test/vigencia.test.ts` — deferred vigência: EC 141 and EC 132 pending wordings, promotion by build date, page-already-applied scenarios
- `test/llm-review.test.ts` — review layer 3: a fake reviewer's orphan changes and unapplied commands, and the Claude adapter over handwritten API responses (no network)
- `test/snapshots/` — committed full-text Markdown mirrors of the CF, ADCT and CDC (generated; never hand-edited)
- `test/fixtures/` — scenario fixtures derived from real pages (`hygiene/`: cp1252 parser-hygiene page; `refresh/`: refreshes of the CF page (a simulated EC 142 with its act page, the same with planted faults, the CF before EC 140/141, an ETag-only refetch, the CDC reworded by a simulated law with that law's page, the CDC without a dispositivo the real Lei 14.181 inserted), made by its `make.mjs`; `unclosed-quote/`: a quotation that never closes; `redaction/`: the LEGIN page with personal data planted in every metadata form its README lists (attribute tricks, raw text, comments, CDATA, Office XML), made by its `make.mjs`; `llm-review/`: handwritten Claude API responses, checksummed in its `index.json`; see their READMEs)
- `fixtures/` — committed raw source captures (checksummed `index.json` per capture; normas.leg.br files are CC BY 4.0; `2026-10-21/` holds Câmara LEGIN's compiled CDC, the EC 132 page and the Lei 14.181/2021 page; `<day>-daily/` are the daily job's; all dated folders are `build:dataset`'s input; see its README)
- `scripts/review-live.ts` — `pnpm review:live`: runs the real LLM reviewer once on the EC 141 diff (needs `ANTHROPIC_API_KEY`; paid; not in `pnpm verify`)
- `wrangler.jsonc` — the Worker `hendril-dev-akoma` on the `akoma.hendril.dev` custom domain only: static assets from `dataset/`, Workers Cache, rate-limit binding
- `docs/deploy.md` — deploy runbook (EN + PT): what is served where, caching and rate limiting, token permissions, first deploy, smoke and rollback
- `scripts/smoke.mjs` — post-deploy smoke check (`node scripts/smoke.mjs <base> [datasetVersion]`)
- `.github/workflows/deploy.yml` — push to `main` (or a dispatch by the daily job after its merge) → `pnpm verify` → `wrangler deploy` → smoke; skipped while the `CLOUDFLARE_API_TOKEN` secret is absent
- `scripts/probe-planalto.mjs` — checks whether Planalto serves a runner (Akoma UA, conditional GET, control UA); manual only since #12
- `docs/adr/` — architecture decisions (0001: fetch Planalto directly from Actions; no R2 fallback in v1; 0002: Câmara LEGIN is the CDC's secondary source; 0003: deferred vigência from the amending acts, start-date counting; 0004: cross-source agreement, normalisation, outcomes, known divergences)
- `docs/adding-a-norm.md` — how to add a norm: capture, manifest, golden set, invariants, snapshot; parser evolution over per-norm hooks
- `docs/research/2026-10-20-sources.md` — source-of-truth research: Planalto, normas.leg.br, LEGIN, LexML IDs, parser traps, accuracy checks
- `docs/agents/` — issue tracker, triage labels, domain-doc rules for the engineering skills
- GitHub Issues — the spec (#1) and tickets live there (see `docs/agents/issue-tracker.md`)

The full 2026-10-20 raw capture (all codes, 40 MB) is local-only in the git-ignored `.scratch/raw-2026-10-20/`.

## Verify
`pnpm verify` must pass before calling work done: typecheck, both seam test suites, the Map check and the dataset regeneration check (the same command CI runs). It needs no server and no network.
A failing `pnpm check:dataset` means `dataset/` is not the regeneration of the committed captures: after a parser, manifest or capture change (or a merge that brings one), run `pnpm build:dataset` and commit `dataset/`; never edit it by hand.
A failing full-text snapshot (`test/snapshots/*.md`) means the CF/ADCT text changed: regenerate with `pnpm vitest run -u` only when a parser fix or a new fixture explains every line of the diff.

## Rules
- Never hand-edit generated legal data (JSON/MD): fix the parser, manifest or tests and regenerate. Text corrections come from the source, never from a person.
- Planalto is the primary text source; normas.leg.br and Câmara LEGIN are cross-checks only. normas.leg.br is CC BY 4.0: the published dataset must not republish its text or history (only ID aliases, with attribution); committed test fixtures from it carry attribution in their README.
- Requests to government sites use `Mozilla/5.0 (compatible; akoma/<ver>)`, conditional GETs and low rates. Never put a personal identifier (email, name) in a request. Only exception: the probe's control request uses curl's default UA on purpose, to detect UA filtering (ADR 0001).
- Docs: technical docs in English and Portuguese; code and schema in English; legal content verbatim in Portuguese.

## Gotchas
- Planalto resets connections from non-browser user agents (curl default, python-requests, empty UA).
- Planalto's F5 WAF injects a `<script>` with a random token after `</html>` in every response: hash a page only with its scripts removed, and treat ETag/Last-Modified as a pre-filter.
- Planalto pages are cp1252 with no charset declared; struck text appears as `<strike>`, `<s>` or CSS line-through, even on "compilado" pages.
- normas.leg.br never renumbers its ids and repeats some: match it by printed label, keep its id only as an alias. It dates deferred changes from publication (EC 141 art. 7º XV): not a Planalto error.
- Lines that belong to the dispositivo above them: "Pena" sanction lines (CDC arts. 63–74) and text quoted from another act (CDC arts. 110–117, EC pages). Inside a quote nothing is a label of the norm.

## Git & deploy
- Remote `origin` = github.com/hendrillara/akoma (public), branch `main`. Pushing and deploying to Cloudflare need explicit OK. The daily job (`publish.yml`) pushes only `publish/daily` and `status`, and merges only its own PR on a `merge` verdict.
- Merges to `main` deploy through `.github/workflows/deploy.yml` once the `CLOUDFLARE_API_TOKEN` secret exists; the first deploy is the maintainer's, by hand (`docs/deploy.md`). Never run `wrangler deploy`/`login` as an agent; `wrangler deploy --dry-run` and `pnpm dev` are local only.

## Agent skills

### Issue tracker

GitHub Issues on hendrillara/akoma via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, names unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.

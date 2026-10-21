// Probes whether Planalto serves this runner: plain + conditional GETs with Akoma's UA,
// plus a control request with curl's default UA (expected to be reset by the firewall).
// Writes a Markdown report to $GITHUB_STEP_SUMMARY (or stdout) and JSON to probe-result.json.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const AKOMA_UA = `Mozilla/5.0 (compatible; akoma/${version})`;
const CONTROL_UA = "curl/8.7.1";
const URLS = [
  "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm",
  "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/quadro_emc.htm",
];

async function request(url, userAgent, { headers = {}, timeoutMs = 30_000 } = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      bytes: body.byteLength,
      ms: Date.now() - started,
    };
  } catch (error) {
    const cause = error.cause?.code ?? error.cause?.message ?? error.name;
    return { error: `${error.message} (${cause})`, ms: Date.now() - started };
  }
}

const results = [];
for (const url of URLS) {
  const plain = await request(url, AKOMA_UA);
  const conditional = plain.etag
    ? await request(url, AKOMA_UA, { headers: { "if-none-match": plain.etag } })
    : { error: "skipped: no ETag on plain GET" };
  const control = await request(url, CONTROL_UA, { timeoutMs: 15_000 });
  results.push({ url, plain, conditional, control });
}

const describe = (r) => (r.error ? `❌ ${r.error}` : `${r.status} · ${r.bytes} B · ${r.ms} ms`);
const lines = [
  `## Planalto probe — ${new Date().toISOString()}`,
  "",
  `Runner: ${process.env.RUNNER_OS ?? "local"} · UA: \`${AKOMA_UA}\``,
  "",
  "| URL | GET (Akoma UA) | Conditional GET | Control (curl UA) | ETag | Last-Modified |",
  "|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.url.split("/").pop()} | ${describe(r.plain)} | ${describe(r.conditional)} | ${describe(r.control)} | \`${r.plain.etag ?? "–"}\` | ${r.plain.lastModified ?? "–"} |`,
  ),
];
const report = lines.join("\n") + "\n";

writeFileSync("probe-result.json", JSON.stringify({ at: new Date().toISOString(), ua: AKOMA_UA, results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);

const reachable = results.every((r) => r.plain.status === 200);
process.exit(reachable ? 0 : 1);

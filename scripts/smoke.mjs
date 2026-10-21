// Post-deploy smoke check (docs/deploy.md): the API, MCP and the static dataset answer from production, with open CORS.
// Usage: node scripts/smoke.mjs [base URL] [expected datasetVersion, e.g. the one in dataset/dataset.json]
// Retries for up to a minute while the new version reaches the edge, then fails with what it saw.
const base = process.argv[2] ?? "https://akoma.hendril.dev";
const expected = process.argv[3];

const checks = [
  ["/v1/status", "application/json"],
  ["/v1/provisions/cf/art5_cpt_inc10?format=md", "text/markdown"],
  ["/v1/search?q=teto%20remunerat%C3%B3rio&limit=1", "application/json"],
  ["/cf/art5.json", "application/json"],
];

let last = "";
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    await run();
    process.exit(0);
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
    console.log(`attempt ${attempt}: ${last}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
console.error(`smoke: failed: ${last}`);
process.exit(1);

async function run() {
  const status = await (await get("/v1/status", "application/json")).json();
  if (typeof status.datasetVersion !== "string") throw new Error("/v1/status has no datasetVersion");
  if (expected && status.datasetVersion !== expected) {
    throw new Error(`serving dataset ${status.datasetVersion}, expected ${expected}`);
  }
  for (const [path, type] of checks.slice(1)) await get(path, type);
  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (mcp.status !== 200 || !(await mcp.text()).includes('"get_provision"')) throw new Error(`/mcp tools/list: HTTP ${mcp.status}`);
  // A second identical GET should come from Workers Cache (HIT) once it is enabled; reported, not enforced.
  const again = await fetch(`${base}/v1/status`, { signal: AbortSignal.timeout(10_000) });
  console.log(`smoke: ok, dataset ${status.datasetVersion}; repeat GET cf-cache-status=${again.headers.get("cf-cache-status")} age=${again.headers.get("age")}`);
}

async function get(path, type) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.startsWith(type)) throw new Error(`${path}: content-type ${response.headers.get("content-type")}`);
  if (response.headers.get("access-control-allow-origin") !== "*") throw new Error(`${path}: no open CORS`);
  return response;
}

// Fails when a path listed in AGENTS.md's `## Map` no longer exists.
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "AGENTS.md";
const text = readFileSync(file, "utf8");
const map = text.split(/^## Map$/m)[1]?.split(/^## /m)[0];
if (!map) {
  console.error(`${file}: no "## Map" section`);
  process.exit(1);
}

const paths = [...map.matchAll(/^- `([^`\s]+)`/gm)].map((m) => m[1]);
const missing = paths.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(`${file}: Map lists missing paths:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`${file}: all ${paths.length} Map paths exist`);

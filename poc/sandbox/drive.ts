// bun drive.ts merge <runner> <left> <right> [snapshotId] | bun drive.ts snapshot <runner> | bun drive.ts stop <runner>
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Environment: COMMUTE_POC_DIR (secrets/probe-key holds the probe key) and
// COMMUTE_SANDBOX_URL (the workers.dev URL of commute-poc-sandbox).
const KEY_FILE = join(requiredEnv("COMMUTE_POC_DIR"), "secrets", "probe-key");
const BASE = requiredEnv("COMMUTE_SANDBOX_URL");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`set ${name}`);
  return value;
}
const [command, runner, left, right, snapshotId] = process.argv.slice(2);
const startedAt = Date.now();
const response = await fetch(`${BASE}/${command}?runner=${runner}`, {
  method: "POST",
  headers: { authorization: `Bearer ${readFileSync(KEY_FILE, "utf8").trim()}`, "content-type": "application/json" },
  body: JSON.stringify({ left, right, snapshotId }),
  signal: AbortSignal.timeout(300_000),
});
const text = await response.text();
console.log(JSON.stringify({ status: response.status, roundTripMs: Date.now() - startedAt }));
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 2000));
}

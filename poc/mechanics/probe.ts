#!/usr/bin/env bun
/**
 * Probe P1 for Commute: do the three core mechanics hold with plain git?
 *
 *   C1  Commute: two changes merge cleanly in either order and give one tree.
 *   C2  Results keyed to content: a check result keeps its key while the
 *       subtrees it reads keep their object ids.
 *   C3  Resolve once: a conflict resolved once is reused, keyed by its content.
 *   C4  Cost of each mechanic on a trunk of 20,000 files.
 *
 * Usage: bun probe.ts <work-dir>
 * The probe owns <work-dir>. It deletes and recreates it on every run.
 * Lines that start with "TIME" hold timings. All other lines are deterministic.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment: every ambient input git reads is pinned here.

const WORK_DIR_MARKER = ".commute-probe-p1";
const EPOCH = "1790812800 +0000"; // 2026-10-01T00:00:00Z
const TIMING_RUNS = 5;

const workDir = process.argv[2];
if (!workDir) throw new Error("usage: bun probe.ts <work-dir>");
prepareWorkDir(workDir);

const ENV: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  HOME: join(workDir, "home"),
  XDG_CONFIG_HOME: join(workDir, "home", ".config"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Commute Probe",
  GIT_AUTHOR_EMAIL: "probe@commute.invalid",
  GIT_AUTHOR_DATE: EPOCH,
  GIT_COMMITTER_NAME: "Commute Probe",
  GIT_COMMITTER_EMAIL: "probe@commute.invalid",
  GIT_COMMITTER_DATE: EPOCH,
  GIT_EDITOR: ":",
  GIT_ADVICE: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  TZ: "UTC",
};

// On macOS, /usr/bin/git is an xcrun shim that adds about 5 ms to every call.
// The probe calls the real binary so that the timings show the cost of git itself.
const GIT = process.platform === "darwin" ? run(["xcrun", "-f", "git"]).trim() : "git";

function prepareWorkDir(dir: string): void {
  if (existsSync(dir)) {
    if (!existsSync(join(dir, WORK_DIR_MARKER))) {
      throw new Error(`${dir} exists and was not made by this probe; refusing to delete it`);
    }
    rmSync(dir, { recursive: true });
  }
  mkdirSync(join(dir, "home"), { recursive: true });
  writeFileSync(join(dir, WORK_DIR_MARKER), "");
}

// ---------------------------------------------------------------------------
// Git plumbing helpers.

type Output = { exitCode: number; stdout: string; stderr: string };
type GitOptions = { input?: string; env?: Record<string, string> };

function run(argv: string[]): string {
  const result = Bun.spawnSync(argv, { env: ENV });
  if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${result.stderr}`);
  return result.stdout.toString();
}

function gitRaw(cwd: string, args: string[], options: GitOptions = {}): Output {
  const result = Bun.spawnSync([GIT, ...args], {
    cwd,
    env: { ...ENV, ...options.env },
    stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** Runs git, asserts success, and returns stdout without the trailing newline. */
function git(cwd: string, args: string[], options: GitOptions = {}): string {
  const out = gitRaw(cwd, args, options);
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} exited ${out.exitCode}: ${out.stderr}`);
  return out.stdout.trimEnd();
}

function readFile(repo: string, rev: string, path: string): string {
  const out = gitRaw(repo, ["cat-file", "blob", `${rev}:${path}`]);
  if (out.exitCode !== 0) throw new Error(`cannot read ${rev}:${path}: ${out.stderr}`);
  return out.stdout;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

function short(oid: string): string {
  return oid.slice(0, 12);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function replaceOnce(text: string, from: string, to: string): string {
  const first = text.indexOf(from);
  if (first === -1 || text.indexOf(from, first + 1) !== -1) throw new Error(`expected exactly one "${from}"`);
  return text.replace(from, to);
}

/** Path to new content, or null to delete the path. */
type Edits = Record<string, string | null>;

/** Builds a commit from a parent and a set of file edits, without a worktree. */
function commit(repo: string, parent: string | null, edits: Edits, message: string): string {
  const env = { GIT_INDEX_FILE: join(workDir, "build.index") };
  rmSync(env.GIT_INDEX_FILE, { force: true });
  git(repo, parent ? ["read-tree", parent] : ["read-tree", "--empty"], { env });
  for (const [path, content] of Object.entries(edits)) {
    if (content === null) {
      // Mode 0 removes the entry; --force-remove would need a worktree.
      git(repo, ["update-index", "--index-info"], { env, input: `0 ${"0".repeat(40)}\t${path}\n` });
    } else {
      const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: content });
      git(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    }
  }
  const tree = git(repo, ["write-tree"], { env });
  return git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
}

type Merge = { clean: boolean; tree: string; conflicts: string[] };

/** Three-way merge with `git merge-tree --write-tree`: no worktree, no index, no checkout. */
function mergeTree(repo: string, ours: string, theirs: string, conflictStyle = "merge"): Merge {
  const out = gitRaw(repo, ["-c", `merge.conflictStyle=${conflictStyle}`, "merge-tree", "--write-tree", "--name-only", ours, theirs]);
  if (out.exitCode !== 0 && out.exitCode !== 1) throw new Error(`merge-tree failed: ${out.stderr}`);
  const [tree, ...conflicts] = lines(out.stdout.split("\n\n")[0]);
  return { clean: out.exitCode === 0, tree, conflicts: [...new Set(conflicts)] };
}

/**
 * Puts a single-commit change on top of `onto` as one commit whose only parent
 * is `onto`. The merge base is the change's parent, so the result equals a
 * cherry-pick. The coordinator uses this both to land and to restack.
 */
function stackOnto(repo: string, onto: string, change: string, message: string): string {
  const merge = mergeTree(repo, onto, change);
  if (!merge.clean) throw new Error(`expected a clean merge of ${message}, got conflicts in ${merge.conflicts}`);
  return git(repo, ["commit-tree", merge.tree, "-p", onto, "-m", message]);
}

function footprint(repo: string, base: string, change: string): string[] {
  return lines(git(repo, ["diff-tree", "-r", "--name-only", "--no-renames", base, change]));
}

function timeMs(action: () => unknown): { median: number; min: number; max: number } {
  const samples: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i++) {
    const start = performance.now();
    action();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(TIMING_RUNS / 2)], min: samples[0], max: samples[TIMING_RUNS - 1] };
}

function printTime(label: string, action: () => unknown): void {
  const t = timeMs(action);
  const ms = (n: number) => n.toFixed(1);
  console.log(`TIME  ${label.padEnd(58)} median ${ms(t.median).padStart(6)} ms  (min ${ms(t.min)}, max ${ms(t.max)}, n=${TIMING_RUNS})`);
}

// ---------------------------------------------------------------------------
// Summary rows: each claim item records what was expected and what happened.

type Row = { claim: string; item: string; expected: string; observed: string };
const summary: Row[] = [];
function record(claim: string, item: string, expected: string, observed: string): void {
  summary.push({ claim, item, expected, observed });
}

function heading(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

// ---------------------------------------------------------------------------
// The synthetic monorepo.

const TRUNK_FILES: Edits = {
  "README.md": "# Demo monorepo\n",
  "eslint.config.json": '{\n  "rules": { "no-unused-vars": "error" }\n}\n',
  "packages/api/src/server.ts": 'import { routes } from "./routes";\n\nexport function start(): void {\n  routes();\n}\n',
  "packages/api/src/routes.ts": 'export function routes(): string[] {\n  return ["/health", "/users"];\n}\n',
  "packages/api/src/config.ts":
    'export const config = {\n  port: 8080,\n  host: "0.0.0.0",\n  timeoutMs: 30000,\n  logLevel: "info",\n};\n',
  "packages/web/src/app.ts": 'import { header } from "./header";\n\nexport function app(): string {\n  return header("Home");\n}\n',
  "packages/web/src/header.ts": "export function header(title: string): string {\n  return `<h1>${title}</h1>`;\n}\n",
  "packages/shared/src/util.ts": [
    "// Shared utilities used by api and web.",
    "export function clamp(n: number, lo: number, hi: number): number {",
    "  return Math.min(Math.max(n, lo), hi);",
    "}",
    "",
    "export function slug(s: string): string {",
    '  return s.toLowerCase().replace(/\\s+/g, "-");',
    "}",
    "",
    "export function sum(xs: number[]): number {",
    "  return xs.reduce((a, b) => a + b, 0);",
    "}",
    "",
    "export function unique<T>(xs: T[]): T[] {",
    "  return [...new Set(xs)];",
    "}",
    "",
    "export function chunk<T>(xs: T[], size: number): T[][] {",
    "  const out: T[][] = [];",
    "  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));",
    "  return out;",
    "}",
    "",
  ].join("\n"),
  "db/migrations/0040_init.sql": "CREATE TABLE accounts (id INTEGER PRIMARY KEY);\n",
  "db/migrations/0041_users.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n",
};

const forge = join(workDir, "forge.git");
git(workDir, ["init", "-q", "--bare", "-b", "trunk", forge]);
const T0 = commit(forge, null, TRUNK_FILES, "trunk T0");
git(forge, ["update-ref", "refs/heads/trunk", T0]);

/** Returns the content of `path` at T0 with one replacement applied. */
function editT0(path: string, from: string, to: string): string {
  return replaceOnce(readFile(forge, T0, path), from, to);
}

heading("SETUP");
console.log(`git binary        ${GIT}`);
console.log(`git version       ${git(workDir, ["--version"])}`);
console.log(`machine           ${run(["uname", "-m"]).trim()}`);
console.log(`bun version       ${Bun.version}`);
console.log(`trunk T0          ${T0}  (${Object.keys(TRUNK_FILES).length} files)`);
console.log(`trunk T0 tree     ${git(forge, ["rev-parse", `${T0}^{tree}`])}`);

// ---------------------------------------------------------------------------
// C1. Commute.

heading("C1  COMMUTE: merge A then B and B then A with git merge-tree --write-tree");

type PairCase = { name: string; a: Edits; b: Edits; expected: "commute" | "conflict" };

const UTIL = "packages/shared/src/util.ts";
const PAIR_CASES: PairCase[] = [
  {
    name: "disjoint files",
    a: { "packages/api/src/routes.ts": editT0("packages/api/src/routes.ts", '"/users"', '"/users", "/teams"') },
    b: { "packages/web/src/app.ts": editT0("packages/web/src/app.ts", '"Home"', '"Welcome"') },
    expected: "commute",
  },
  {
    name: "same file, separate hunks",
    a: { [UTIL]: editT0(UTIL, "Math.min(Math.max(n, lo), hi)", "n < lo ? lo : n > hi ? hi : n") },
    b: { [UTIL]: editT0(UTIL, "i += size)", "i += Math.max(1, size))") },
    expected: "commute",
  },
  {
    name: "same file, same hunk",
    a: { [UTIL]: editT0(UTIL, '.replace(/\\s+/g, "-")', '.replace(/\\s+/g, "_")') },
    b: { [UTIL]: editT0(UTIL, '.replace(/\\s+/g, "-")', '.trim().replace(/\\s+/g, "-")') },
    expected: "conflict",
  },
  {
    name: "migrations 0042_a.sql and 0042_b.sql",
    a: { "db/migrations/0042_a.sql": "ALTER TABLE users ADD COLUMN email TEXT;\n" },
    b: { "db/migrations/0042_b.sql": "ALTER TABLE users ADD COLUMN phone TEXT;\n" },
    expected: "commute",
  },
  {
    name: "file and directory at one path",
    a: { "packages/web/src/theme": "dark\n" },
    b: { "packages/web/src/theme/dark.ts": 'export const theme = "dark";\n' },
    expected: "conflict",
  },
];

/** True when two paths are equal or one is an ancestor directory of the other. */
function pathsMeet(p: string, q: string): boolean {
  return p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`);
}

type PrefilterTally = { falseAlarms: number; misses: number };
const exactTally: PrefilterTally = { falseAlarms: 0, misses: 0 };
const ancestorTally: PrefilterTally = { falseAlarms: 0, misses: 0 };
let pairwiseDisagreements = 0;

function tallyPrefilter(tally: PrefilterTally, overlap: boolean, cleanBothOrders: boolean): string {
  if (overlap && cleanBothOrders) {
    tally.falseAlarms++;
    return "disagree (overlap, but merges are clean)";
  }
  if (!overlap && !cleanBothOrders) {
    tally.misses++;
    return "disagree (disjoint, but merge conflicts)";
  }
  return "agree";
}

PAIR_CASES.forEach((pairCase, index) => {
  const A = commit(forge, T0, pairCase.a, `change A: ${pairCase.name}`);
  const B = commit(forge, T0, pairCase.b, `change B: ${pairCase.name}`);
  const footprintA = footprint(forge, T0, A);
  const footprintB = footprint(forge, T0, B);
  const exactOverlap = footprintA.some((p) => footprintB.includes(p));
  const ancestorOverlap = footprintA.some((p) => footprintB.some((q) => pathsMeet(p, q)));

  const landedA = stackOnto(forge, T0, A, "land A");
  const landedB = stackOnto(forge, T0, B, "land B");
  const aThenB = mergeTree(forge, landedA, B);
  const bThenA = mergeTree(forge, landedB, A);
  const cleanBothOrders = aThenB.clean && bThenA.clean;
  const conflictBothOrders = !aThenB.clean && !bThenA.clean;
  const treesEqual = aThenB.tree === bThenA.tree;
  let verdict = "order-dependent";
  if (cleanBothOrders && treesEqual) verdict = "commute";
  if (conflictBothOrders) verdict = "conflict";
  // The coordinator checks a pair in flight with one call: merge A and B over their common base.
  const pairwise = mergeTree(forge, A, B);
  const pairwiseAgrees = pairwise.clean ? verdict === "commute" && pairwise.tree === aThenB.tree : verdict === "conflict";
  if (!pairwiseAgrees) pairwiseDisagreements++;

  const describe = (merge: Merge) =>
    merge.clean ? `clean     exit 0  tree ${short(merge.tree)}` : `CONFLICT  exit 1  paths: ${merge.conflicts.join(", ")}`;
  console.log(`\ncase ${index + 1}: ${pairCase.name}`);
  console.log(`  footprint A        ${footprintA.join(", ")}`);
  console.log(`  footprint B        ${footprintB.join(", ")}`);
  console.log(`  A then B           ${describe(aThenB)}`);
  console.log(`  B then A           ${describe(bThenA)}`);
  console.log(`  trees equal        ${cleanBothOrders ? (treesEqual ? "yes" : "NO") : "n/a (conflict)"}`);
  console.log(`  verdict            ${verdict}`);
  console.log(`  pairwise A B       ${describe(pairwise)}  agrees with both orders: ${pairwiseAgrees ? "yes" : "NO"}`);
  console.log(`  pre-filter exact   ${exactOverlap ? "overlap" : "disjoint"} -> ${tallyPrefilter(exactTally, exactOverlap, cleanBothOrders)}`);
  console.log(`  pre-filter prefix  ${ancestorOverlap ? "overlap" : "disjoint"} -> ${tallyPrefilter(ancestorTally, ancestorOverlap, cleanBothOrders)}`);
  record("C1", pairCase.name, pairCase.expected, verdict);
});

console.log("\npre-filter disagreements with merge-tree across the 5 cases:");
console.log(`  exact path sets        false alarms ${exactTally.falseAlarms}, misses ${exactTally.misses}`);
console.log(`  prefix-aware path sets false alarms ${ancestorTally.falseAlarms}, misses ${ancestorTally.misses}`);
console.log("  (a false alarm costs one merge-tree call; a miss skips a merge that conflicts)");
record("C1", "one pairwise merge-tree agrees with both orders", "yes", pairwiseDisagreements === 0 ? "yes" : "no");
record("C1", "exact pre-filter safe to skip merge-tree", "yes", exactTally.misses === 0 ? "yes" : "no");
record("C1", "prefix-aware pre-filter safe to skip merge-tree", "yes", ancestorTally.misses === 0 ? "yes" : "no");

// ---------------------------------------------------------------------------
// C2. Results keyed to content.

heading("C2  RESULTS KEYED TO CONTENT: key = hash(check, version, object id of each read path)");

type Check = { name: string; version: number; reads: string[] };

// "" is the repository root.
const CHECKS: Check[] = [
  { name: "api-tests", version: 1, reads: ["packages/api", "packages/shared"] },
  { name: "web-tests", version: 1, reads: ["packages/web", "packages/shared"] },
  { name: "lint", version: 1, reads: ["eslint.config.json", "packages"] },
  { name: "migrations-check", version: 1, reads: ["db/migrations", "db/schema.sql"] },
  { name: "e2e", version: 1, reads: [""] },
];
const ABSENT = "absent";

/** Object id of each path at `commit`, from one `git cat-file --batch-check` process. */
function objectIds(repo: string, commitId: string, paths: string[]): Map<string, string> {
  const unique = [...new Set(paths)];
  const input = unique.map((path) => `${commitId}:${path}\n`).join("");
  const output = git(repo, ["cat-file", "--batch-check=%(objectname)"], { input }).split("\n");
  return new Map(unique.map((path, i) => [path, output[i].endsWith(" missing") ? ABSENT : output[i]]));
}

type Keyed = { check: Check; ids: string[]; key: string };

function resultKeys(repo: string, commitId: string, checks: Check[]): Keyed[] {
  const ids = objectIds(repo, commitId, checks.flatMap((check) => check.reads));
  return checks.map((check) => {
    const readIds = check.reads.map((path) => ids.get(path)!);
    const key = sha256(JSON.stringify([check.name, check.version, check.reads, readIds])).slice(0, 16);
    return { check, ids: readIds, key };
  });
}

function displayPath(path: string): string {
  return path === "" ? "(root)" : path;
}

/** Results known to the coordinator: result key -> who produced the result. */
const resultStore = new Map<string, string>();

function runChecks(producer: string, keyed: Keyed[]): void {
  for (const { key } of keyed) if (!resultStore.has(key)) resultStore.set(key, producer);
}

type Outcome = "kept" | "reused" | "run";

/** Classifies each check of a restacked change, prints the table, and runs the checks that must run. */
function classifyRestack(title: string, label: string, before: Keyed[], after: Keyed[]): Map<string, Outcome> {
  console.log(`\n${title}`);
  const outcomes = new Map<string, Outcome>();
  after.forEach((now, i) => {
    const old = before[i];
    const changedPaths = now.check.reads.flatMap((path, j) =>
      old.ids[j] === now.ids[j] ? [] : [`${displayPath(path)} ${short(old.ids[j])} -> ${short(now.ids[j])}`],
    );
    let outcome: Outcome = "run";
    let detail = "run";
    if (now.key === old.key) {
      outcome = "kept";
      detail = "keep";
    } else if (resultStore.has(now.key)) {
      outcome = "reused";
      detail = `reuse result of ${resultStore.get(now.key)}`;
    }
    outcomes.set(now.check.name, outcome);
    console.log(
      `  ${now.check.name.padEnd(17)} key ${old.key} -> ${now.key === old.key ? "same".padEnd(16) : now.key}  ${detail}`,
    );
    for (const changed of changedPaths) console.log(`  ${"".padEnd(17)}   subtree ${changed}`);
  });
  runChecks(label, after);
  const count = (wanted: Outcome) => [...outcomes.values()].filter((o) => o === wanted).length;
  console.log(
    `  kept ${count("kept")}, key changed ${count("reused") + count("run")} (reused from store ${count("reused")}, must run ${count("run")})`,
  );
  return outcomes;
}

function namesWith(outcomes: Map<string, Outcome>, wanted: Outcome[]): string {
  const names = [...outcomes].filter(([, o]) => wanted.includes(o)).map(([name]) => name);
  return names.length === 0 ? "none" : names.join(",");
}

console.log("checks:");
for (const check of CHECKS) {
  console.log(`  ${check.name.padEnd(17)} v${check.version}  reads ${check.reads.map(displayPath).join(", ")}`);
}
console.log("restack method: git merge-tree --write-tree <new trunk> <change>, then git commit-tree -p <new trunk>.");
console.log("  With a single-commit change, the merge base is the old trunk, so the result equals a cherry-pick.");

// Trunk T0 has been checked; its results seed the store.
runChecks("trunk T0", resultKeys(forge, T0, CHECKS));

const C_T0 = commit(forge, T0, { "packages/web/src/header.ts": editT0("packages/web/src/header.ts", "<h1>", '<h1 class="title">') }, "change C: header class");
console.log(`\nchange C touches: ${footprint(forge, T0, C_T0).join(", ")}`);

let keysC = resultKeys(forge, C_T0, CHECKS);
const crossCheckEqual = keysC.every(({ check, ids }) =>
  check.reads.every((path, j) => {
    const out = gitRaw(forge, ["rev-parse", "--verify", "--quiet", `${C_T0}:${path}`]);
    return (out.exitCode === 0 ? out.stdout.trim() : ABSENT) === ids[j];
  }),
);
console.log(`object ids from cat-file --batch-check equal git rev-parse <commit>:<path> for every read path: ${crossCheckEqual ? "yes" : "NO"}`);
record("C2", "cat-file ids equal rev-parse ids", "yes", crossCheckEqual ? "yes" : "no");

// C's first check run on T0: compare against the trunk results already in the store.
console.log("\nchange C on T0, first run (store holds trunk T0 results):");
const firstRun: string[] = [];
for (const { check, key } of keysC) {
  const outcome = resultStore.has(key) ? `reuse result of ${resultStore.get(key)}` : "run";
  if (!resultStore.has(key)) firstRun.push(check.name);
  console.log(`  ${check.name.padEnd(17)} key ${key}  ${outcome}`);
}
runChecks("C@T0", keysC);
record("C2", "C on T0, first run: must run", "web-tests,lint,e2e", firstRun.join(","));

printTime("C2 result keys, 5 checks, one change (small repo)", () => resultKeys(forge, C_T0, CHECKS));

type Landing = { name: string; edits: (trunk: string) => Edits; expectKept: string; expectRun: string };

const SCHEMA = "CREATE TABLE accounts (id INTEGER PRIMARY KEY);\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n";
const LANDINGS: Landing[] = [
  {
    name: "L1 edits packages/api/src/routes.ts",
    edits: (trunk) => ({ "packages/api/src/routes.ts": replaceOnce(readFile(forge, trunk, "packages/api/src/routes.ts"), '"/health"', '"/healthz"') }),
    expectKept: "web-tests,migrations-check",
    expectRun: "lint,e2e",
  },
  {
    name: "L2 edits packages/shared/src/util.ts",
    edits: (trunk) => ({ [UTIL]: replaceOnce(readFile(forge, trunk, UTIL), "xs.reduce((a, b) => a + b, 0)", "xs.reduce((acc, x) => acc + x, 0)") }),
    expectKept: "migrations-check",
    expectRun: "web-tests,lint,e2e",
  },
  {
    name: "L3 adds db/schema.sql",
    edits: () => ({ "db/schema.sql": SCHEMA }),
    expectKept: "api-tests,web-tests,lint",
    expectRun: "e2e",
  },
  {
    name: "L4 deletes db/schema.sql",
    edits: () => ({ "db/schema.sql": null }),
    expectKept: "api-tests,web-tests,lint",
    expectRun: "none",
  },
];

let trunk = T0;
let changeC = C_T0;
LANDINGS.forEach((landing, i) => {
  const label = landing.name.split(" ")[0];
  const L = commit(forge, trunk, landing.edits(trunk), landing.name);
  runChecks(label, resultKeys(forge, L, CHECKS)); // a change is checked on its own commit before it lands
  const nextTrunk = stackOnto(forge, trunk, L, `trunk T${i + 1}`);
  const restacked = stackOnto(forge, nextTrunk, changeC, "change C: header class");
  const keysAfter = resultKeys(forge, restacked, CHECKS);
  const outcomes = classifyRestack(`restack C: T${i} -> T${i + 1}   (landing ${landing.name})`, `C@T${i + 1}`, keysC, keysAfter);
  record("C2", `restack onto T${i + 1}: kept`, landing.expectKept, namesWith(outcomes, ["kept"]));
  record("C2", `restack onto T${i + 1}: must run`, landing.expectRun, namesWith(outcomes, ["run"]));
  trunk = nextTrunk;
  changeC = restacked;
  keysC = keysAfter;
});

// ---------------------------------------------------------------------------
// C3. Resolve once, reuse the stored resolution.

heading("C3  RESOLVE ONCE: a conflict resolved for F applies to G without a resolver");

const CONFIG = "packages/api/src/config.ts";
const configWith = (rev: string, line: string) => replaceOnce(readFile(forge, rev, CONFIG), "  timeoutMs: 30000,\n", `  timeoutMs: 30000,\n${line}`);
const E = commit(forge, T0, { [CONFIG]: configWith(T0, "  retries: 3,\n") }, "change E: add retries");
const F = commit(forge, T0, { [CONFIG]: configWith(T0, "  maxBodyBytes: 1048576,\n") }, "change F: add maxBodyBytes");
const G = commit(
  forge,
  T0,
  { [CONFIG]: configWith(T0, "  maxBodyBytes: 1048576,\n"), "packages/web/src/app.ts": editT0("packages/web/src/app.ts", '"Home"', '"Start"') },
  "change G: add maxBodyBytes and rename home",
);
const G_OTHER_TEXT = commit(forge, T0, { [CONFIG]: configWith(T0, "  maxBodyBytes: 2097152,\n") }, "change G2: add a larger maxBodyBytes");
const TE = stackOnto(forge, T0, E, "trunk TE: land E");
const H = commit(
  forge,
  TE,
  { [CONFIG]: "// Runtime configuration for the api service.\n// Values come from the deploy manifest.\n// Keep keys sorted by concern.\n// Units are part of each key name.\n// Do not read env vars here.\n" + readFile(forge, TE, CONFIG) },
  "change H: add a header comment",
);
const TEH = stackOnto(forge, TE, H, "trunk TEH: land H");
for (const [name, oid] of Object.entries({ "trunk-e": TE, "trunk-eh": TEH, "change-f": F, "change-g": G })) {
  git(forge, ["update-ref", `refs/heads/${name}`, oid]);
}
console.log("E and F each insert one line after `timeoutMs` in packages/api/src/config.ts.");
console.log("G makes the same insertion as F and also edits packages/web/src/app.ts.");
console.log("G2 inserts the same key as F with a different value (negative control).");
console.log("TE = T0 + E. TEH = TE + H, where H adds 5 comment lines at the top of config.ts.");

const fRestack = mergeTree(forge, TE, F);
console.log(`\nmerge-tree TE F: ${fRestack.clean ? "clean" : `CONFLICT in ${fRestack.conflicts.join(", ")}`}`);
record("C3", "restack F onto TE conflicts", "conflict", fRestack.clean ? "clean" : "conflict");

type Hunk = { line: number; ours: string[]; base: string[]; theirs: string[] };
type Piece = { kind: "text"; lines: string[] } | { kind: "hunk"; hunk: Hunk };

/** Splits a file with conflict markers into plain text and conflict hunks. Marker labels are dropped. */
function splitConflicts(text: string): Piece[] {
  const pieces: Piece[] = [];
  let plain: string[] = [];
  let hunk: Hunk | null = null;
  let side: "ours" | "base" | "theirs" = "ours";
  for (const [index, rawLine] of text.split("\n").entries()) {
    const line = rawLine.replace(/\r$/, "");
    if (hunk === null && !line.startsWith("<<<<<<<")) {
      plain.push(rawLine);
    } else if (hunk === null) {
      pieces.push({ kind: "text", lines: plain });
      plain = [];
      hunk = { line: index + 1, ours: [], base: [], theirs: [] };
      side = "ours";
    } else if (line.startsWith("|||||||")) {
      side = "base";
    } else if (line === "=======") {
      side = "theirs";
    } else if (line.startsWith(">>>>>>>")) {
      pieces.push({ kind: "hunk", hunk });
      hunk = null;
    } else {
      hunk[side].push(line);
    }
  }
  if (hunk) throw new Error("unterminated conflict hunk");
  pieces.push({ kind: "text", lines: plain });
  return pieces;
}

function joinPieces(pieces: Piece[], resolve: (hunk: Hunk) => string[]): string {
  return pieces.flatMap((piece) => (piece.kind === "text" ? piece.lines : resolve(piece.hunk))).join("\n");
}

/** Stands in for the resolver agent: keep both edits, the trunk side first. */
let resolverCalls = 0;
function resolverKeepBoth(hunk: Hunk): string[] {
  resolverCalls++;
  return [...hunk.ours, ...hunk.theirs];
}

/** The blob a correct resolution produces on a trunk that already holds E: E's line, then F's line. */
function expectedBlob(trunkWithE: string): string {
  const resolved = replaceOnce(readFile(forge, trunkWithE, CONFIG), "  retries: 3,\n", "  retries: 3,\n  maxBodyBytes: 1048576,\n");
  return git(forge, ["hash-object", "--stdin"], { input: resolved });
}

// --- C3a: native rerere in worktree sandboxes -------------------------------

console.log("\n-- C3a: native git rerere (rerere.enabled, rerere.autoUpdate) in worktree clones");

function cloneSandbox(name: string): string {
  const dir = join(workDir, name);
  git(workDir, ["clone", "-q", forge, dir]);
  git(dir, ["config", "rerere.enabled", "true"]);
  git(dir, ["config", "rerere.autoUpdate", "true"]);
  return dir;
}

type Pick = { exitCode: number; rerereLog: string[]; unmerged: string[] };

function cherryPick(dir: string, onto: string, change: string): Pick {
  git(dir, ["checkout", "-q", "--detach", onto]);
  const out = gitRaw(dir, ["cherry-pick", change]);
  const rerereLog = (out.stdout + out.stderr).split("\n").filter((line) => /preimage|resolution/.test(line));
  const unmerged = lines(git(dir, ["diff", "--name-only", "--diff-filter=U"]));
  return { exitCode: out.exitCode, rerereLog, unmerged };
}

function describePick(label: string, pick: Pick): void {
  console.log(`  ${label}`);
  console.log(`    cherry-pick exit ${pick.exitCode}, unmerged paths: ${pick.unmerged.length === 0 ? "none" : pick.unmerged.join(", ")}`);
  for (const line of pick.rerereLog) console.log(`    rerere: ${line}`);
}

/** Finishes a cherry-pick whose conflicts are resolved and staged; returns the blob of config.ts. */
function finishPick(dir: string): string {
  git(dir, ["cherry-pick", "--continue"]);
  return git(dir, ["rev-parse", `HEAD:${CONFIG}`]);
}

const sandboxA = cloneSandbox("sandbox-a");
const pickF = cherryPick(sandboxA, TE, F);
describePick("sandbox-a: cherry-pick F onto TE", pickF);
const conflictedFile = join(sandboxA, CONFIG);
writeFileSync(conflictedFile, joinPieces(splitConflicts(readFileSync(conflictedFile, "utf8")), resolverKeepBoth));
for (const line of lines(gitRaw(sandboxA, ["rerere"]).stderr)) console.log(`    rerere: ${line}`);
git(sandboxA, ["add", CONFIG]);
const rerereBlobF = finishPick(sandboxA);
console.log(`    resolver wrote the resolution; config.ts blob ${short(rerereBlobF)}; matches expected: ${rerereBlobF === expectedBlob(TE) ? "yes" : "NO"}`);
const rrCacheIds = readdirSync(join(sandboxA, ".git", "rr-cache")).sort();
console.log(`    rr-cache entries: ${rrCacheIds.join(", ")}`);

function autoResolved(pick: Pick): boolean {
  return pick.exitCode !== 0 && pick.unmerged.length === 0 && pick.rerereLog.some((line) => line.includes("previous resolution"));
}

const pickGSame = cherryPick(sandboxA, TE, G);
describePick("sandbox-a: cherry-pick G onto TE (same sandbox)", pickGSame);
const sameSandboxOk = autoResolved(pickGSame) && finishPick(sandboxA) === expectedBlob(TE);
record("C3", "rerere: G onto TE, same sandbox, auto-resolved", "yes", sameSandboxOk ? "yes" : "no");

const mergeTreeWithRerere = gitRaw(sandboxA, ["merge-tree", "--write-tree", "--name-only", TE, G]);
console.log(`  sandbox-a: git merge-tree --write-tree TE G with rr-cache present: exit ${mergeTreeWithRerere.exitCode} (${mergeTreeWithRerere.exitCode === 1 ? "conflict reported; rerere not applied" : "clean"})`);
record("C3", "merge-tree applies rerere", "no", mergeTreeWithRerere.exitCode === 0 ? "yes" : "no");

const sandboxB = cloneSandbox("sandbox-b");
cpSync(join(sandboxA, ".git", "rr-cache"), join(sandboxB, ".git", "rr-cache"), { recursive: true });
const pickGCopied = cherryPick(sandboxB, TE, G);
describePick("sandbox-b (fresh clone, rr-cache copied from sandbox-a): cherry-pick G onto TE", pickGCopied);
const copiedOk = autoResolved(pickGCopied) && finishPick(sandboxB) === expectedBlob(TE);
record("C3", "rerere: G onto TE, fresh clone + copied rr-cache", "yes", copiedOk ? "yes" : "no");

const pickGShifted = cherryPick(sandboxB, TEH, G);
describePick("sandbox-b: cherry-pick G onto TEH (hunk shifted down 5 lines)", pickGShifted);
const shiftedOk = autoResolved(pickGShifted) && finishPick(sandboxB) === expectedBlob(TEH);
record("C3", "rerere: G onto TEH (shifted lines), copied rr-cache", "yes", shiftedOk ? "yes" : "no");

const sandboxC = cloneSandbox("sandbox-c");
const pickGControl = cherryPick(sandboxC, TE, G);
describePick("sandbox-c (fresh clone, no rr-cache; control): cherry-pick G onto TE", pickGControl);
git(sandboxC, ["cherry-pick", "--abort"]);
record("C3", "rerere control: fresh clone without rr-cache resolves", "no", autoResolved(pickGControl) ? "yes" : "no");

// --- C3b: custom key over merge-tree output, no worktree ---------------------

console.log("\n-- C3b: custom resolution key over merge-tree output (no worktree)");
console.log("key = sha256 of [base, ours, theirs] lines of one diff3 hunk; marker labels, line numbers, and CR are dropped");

/** Resolution store: hunk key -> resolved lines. */
const resolutions = new Map<string, string[]>();

type HunkUse = { path: string; line: number; key: string; source: "store" | "resolver" };
type Restacked = { commit: string; uses: HunkUse[]; blob: string };

/** Restacks `change` onto `onto`. Each conflict hunk takes a stored resolution or calls the resolver. */
function restackWithResolutions(onto: string, change: string, message: string): Restacked {
  const merge = mergeTree(forge, onto, change, "diff3");
  const env = { GIT_INDEX_FILE: join(workDir, "resolve.index") };
  rmSync(env.GIT_INDEX_FILE, { force: true });
  git(forge, ["read-tree", merge.tree], { env });
  const uses: HunkUse[] = [];
  for (const path of merge.conflicts) {
    const pieces = splitConflicts(readFile(forge, merge.tree, path));
    if (!pieces.some((piece) => piece.kind === "hunk")) throw new Error(`${path}: conflict without text hunks is out of scope`);
    const resolved = joinPieces(pieces, (hunk) => {
      const key = sha256(JSON.stringify([hunk.base, hunk.ours, hunk.theirs])).slice(0, 16);
      const stored = resolutions.get(key);
      uses.push({ path, line: hunk.line, key, source: stored ? "store" : "resolver" });
      if (stored) return stored;
      const fresh = resolverKeepBoth(hunk);
      resolutions.set(key, fresh);
      return fresh;
    });
    const blob = git(forge, ["hash-object", "-w", "--stdin"], { input: resolved });
    git(forge, ["update-index", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const tree = git(forge, ["write-tree"], { env });
  const commitId = git(forge, ["commit-tree", tree, "-p", onto, "-m", message]);
  return { commit: commitId, uses, blob: git(forge, ["rev-parse", `${commitId}:${CONFIG}`]) };
}

function describeRestack(label: string, restacked: Restacked, expected: string): boolean {
  const matches = restacked.blob === expected;
  console.log(`  ${label}`);
  for (const use of restacked.uses) console.log(`    hunk at line ${use.line}  key ${use.key}  from ${use.source}`);
  console.log(`    resolver calls so far ${resolverCalls}; config.ts blob ${short(restacked.blob)}; matches expected: ${matches ? "yes" : "NO"}`);
  return matches;
}

resolverCalls = 0;
const customF = restackWithResolutions(TE, F, "change F restacked onto TE");
describeRestack("F onto TE", customF, expectedBlob(TE));
const customG = restackWithResolutions(TE, G, "change G restacked onto TE");
const customGOk = describeRestack("G onto TE", customG, expectedBlob(TE));
record("C3", "custom key: G onto TE, resolution source", "store", customG.uses.map((u) => u.source).join(","));
record("C3", "custom key: resolver calls after F and G", "1", String(resolverCalls));
record("C3", "custom key: G result blob equals rerere result blob", "yes", customGOk && customG.blob === rerereBlobF ? "yes" : "no");
const customShifted = restackWithResolutions(TEH, G, "change G restacked onto TEH");
describeRestack("G onto TEH (hunk shifted down 5 lines)", customShifted, expectedBlob(TEH));
record("C3", "custom key: G onto TEH (shifted), resolution source", "store", customShifted.uses.map((u) => u.source).join(","));
const customOther = restackWithResolutions(TE, G_OTHER_TEXT, "change G2 restacked onto TE");
console.log("  G2 onto TE (same place, different value; negative control)");
for (const use of customOther.uses) console.log(`    hunk at line ${use.line}  key ${use.key}  from ${use.source}`);
record("C3", "custom key: G2 (different text), resolution source", "resolver", customOther.uses.map((u) => u.source).join(","));

// ---------------------------------------------------------------------------
// C4. Cost at a realistic size.

heading("C4  COST: trunk with 20,000 files in 2,000 leaf directories");

const PACKAGES = 100;
const MODULES_PER_PACKAGE = 20;
const FILES_PER_MODULE = 10;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

function largeFileContent(path: string): string {
  const body = Array.from({ length: 24 }, (_, i) => `export function f${i}(x: number): number { return x * ${i} + ${path.length}; }`);
  return [`// ${path}`, ...body, ""].join("\n");
}

function fastImportData(text: string): string {
  return `data ${Buffer.byteLength(text)}\n${text}\n`;
}

const large = join(workDir, "large.git");
git(workDir, ["init", "-q", "--bare", "-b", "trunk", large]);
const stream: string[] = [`commit refs/heads/trunk\ncommitter Commute Probe <probe@commute.invalid> ${EPOCH}\n`, fastImportData("large trunk")];
stream.push(`M 100644 inline lint.json\n`, fastImportData('{ "rules": {} }\n'));
let fileCount = 0;
for (let p = 0; p < PACKAGES; p++) {
  for (let m = 0; m < MODULES_PER_PACKAGE; m++) {
    for (let f = 0; f < FILES_PER_MODULE; f++) {
      const path = `packages/p${pad(p, 3)}/m${pad(m, 2)}/f${f}.ts`;
      stream.push(`M 100644 inline ${path}\n`, fastImportData(largeFileContent(path)));
      fileCount++;
    }
  }
}
const importStart = performance.now();
git(large, ["fast-import", "--quiet"], { input: stream.join("") });
const importMs = performance.now() - importStart;
const LT = git(large, ["rev-parse", "refs/heads/trunk"]);
const treeCount = lines(git(large, ["ls-tree", "-r", "-d", "--name-only", LT])).length;
console.log(`large trunk ${LT}: ${fileCount + 1} files, ${treeCount} directories (built with git fast-import)`);
console.log(`TIME  ${"C4 build large trunk with fast-import (one run)".padEnd(58)} ${importMs.toFixed(1).padStart(6)} ms`);

const editLarge = (path: string, factor: string) => replaceOnce(readFile(large, LT, path), "return x * 10 +", `return x * ${factor} +`);
const FILE_X = "packages/p003/m05/f2.ts";
const FILE_Y = "packages/p071/m11/f7.ts";
const X = commit(large, LT, { [FILE_X]: editLarge(FILE_X, "1000") }, "change X");
const Y = commit(large, LT, { [FILE_Y]: editLarge(FILE_Y, "1000") }, "change Y");
const Z = commit(large, LT, { [FILE_X]: editLarge(FILE_X, "2000") }, "change Z");
const disjointMerge = mergeTree(large, X, Y);
const conflictMerge = mergeTree(large, X, Z);
console.log(`merge-tree X Y (disjoint): ${disjointMerge.clean ? "clean" : "CONFLICT"}; merge-tree X Z (same line): ${conflictMerge.clean ? "clean" : `CONFLICT in ${conflictMerge.conflicts.join(", ")}`}`);
record("C4", "large: merge-tree disjoint pair", "clean", disjointMerge.clean ? "clean" : "conflict");
record("C4", "large: merge-tree conflicting pair", "conflict", conflictMerge.clean ? "clean" : "conflict");
console.log(`diff-tree footprint of X: ${footprint(large, LT, X).join(", ")}`);

const LARGE_CHECKS: Check[] = [
  { name: "p003-tests", version: 1, reads: ["packages/p003", "packages/p000"] },
  { name: "p071-tests", version: 1, reads: ["packages/p071", "packages/p000"] },
  { name: "lint", version: 1, reads: ["lint.json", "packages"] },
  { name: "p099-tests", version: 1, reads: ["packages/p099"] },
  { name: "e2e", version: 1, reads: [""] },
];

/** The same keys, with one `git rev-parse` process per read path. */
function resultKeysPerPath(repo: string, commitId: string, checks: Check[]): string[] {
  return checks.map((check) => {
    const ids = check.reads.map((path) => {
      const out = gitRaw(repo, ["rev-parse", "--verify", "--quiet", `${commitId}:${path}`]);
      return out.exitCode === 0 ? out.stdout.trim() : ABSENT;
    });
    return sha256(JSON.stringify([check.name, check.version, check.reads, ids])).slice(0, 16);
  });
}
const perPathMatches = JSON.stringify(resultKeysPerPath(large, X, LARGE_CHECKS)) === JSON.stringify(resultKeys(large, X, LARGE_CHECKS).map((k) => k.key));
console.log(`result keys via one cat-file process equal keys via one rev-parse per path: ${perPathMatches ? "yes" : "NO"}`);

printTime("C4 baseline: git rev-parse --verify trunk (process cost)", () => git(large, ["rev-parse", "--verify", LT]));
printTime("C4 merge-tree --write-tree, disjoint pair", () => mergeTree(large, X, Y));
printTime("C4 merge-tree --write-tree, conflicting pair", () => mergeTree(large, X, Z));
printTime("C4 diff-tree -r --name-only, one change", () => footprint(large, LT, X));
printTime("C4 result keys, 5 checks (one cat-file --batch-check)", () => resultKeys(large, X, LARGE_CHECKS));
printTime("C4 result keys, 5 checks (one rev-parse per path, 8)", () => resultKeysPerPath(large, X, LARGE_CHECKS));

// ---------------------------------------------------------------------------

heading("SUMMARY");
console.log("expected = the hypothesis under test; match NO = the hypothesis does not hold");
console.log(`${"claim".padEnd(6)}${"item".padEnd(56)}${"expected".padEnd(28)}${"observed".padEnd(28)}match`);
for (const row of summary) {
  const match = row.expected === row.observed ? "yes" : "NO";
  console.log(`${row.claim.padEnd(6)}${row.item.padEnd(56)}${row.expected.padEnd(28)}${row.observed.padEnd(28)}${match}`);
}
const mismatches = summary.filter((row) => row.expected !== row.observed).length;
console.log(`\n${summary.length} items, ${mismatches} mismatches`);

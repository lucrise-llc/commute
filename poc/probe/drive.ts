// Local driver for the probe Worker. Tokens are written to files with mode
// 600 and reach git through a credential helper; nothing prints them.
//
// Environment:
//   COMMUTE_POC_DIR    a private directory; secrets/probe-key holds the probe key
//   COMMUTE_PROBE_URL  the workers.dev URL of commute-poc-probe
//
//   bun drive.ts seed
//   bun drive.ts fork <name> [--all-branches]
//   bun drive.ts push <repo> <direct|proxy> [label]
//   bun drive.ts listen <seconds>
//   bun drive.ts footprint <repo> <from> <to>
//   bun drive.ts tree <repo> <commit>
//   bun drive.ts log <repo> <ref>
//   bun drive.ts latency
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH = requiredEnv("COMMUTE_POC_DIR");
const SECRETS = join(SCRATCH, "secrets");
const WORK = join(SCRATCH, "p2-work");
const RECORDS = join(SCRATCH, "p2-records");
const PROBE_URL = requiredEnv("COMMUTE_PROBE_URL");
const PROBE_KEY = readFileSync(join(SECRETS, "probe-key"), "utf8").trim();

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "commute-probe",
  GIT_AUTHOR_EMAIL: "probe@commute.invalid",
  GIT_COMMITTER_NAME: "commute-probe",
  GIT_COMMITTER_EMAIL: "probe@commute.invalid",
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`set ${name}`);
  return value;
}

mkdirSync(WORK, { recursive: true });
mkdirSync(RECORDS, { recursive: true });

async function probe(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(PROBE_URL + path, {
    ...init,
    headers: { authorization: `Bearer ${PROBE_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function saveToken(repo: string, token: string): void {
  const file = join(SECRETS, `${repo}.token`);
  writeFileSync(file, token.split("?expires=")[0], { mode: 0o600 });
  chmodSync(file, 0o600);
}

function remoteFor(repo: string, via: "direct" | "proxy"): string {
  if (via === "proxy") return `${PROBE_URL}/git/${repo}.git`;
  return `https://ef2e81e746f2503a8ca3fa19fd88ba30.artifacts.cloudflare.net/git/commute-poc/${repo}.git`;
}

async function git(cwd: string, tokenRepo: string, args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  const tokenFile = join(SECRETS, `${tokenRepo}.token`);
  const helper = `!f() { test "$1" = get && echo username=x && echo "password=$(cat '${tokenFile}')"; }; f`;
  const child = Bun.spawn(["git", "-c", "credential.helper=", "-c", `credential.helper=${helper}`, ...args], {
    cwd,
    env: { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  return stdout.trim();
}

function record(file: string, entry: object): void {
  appendFileSync(join(RECORDS, file), JSON.stringify(entry) + "\n");
}

async function seed(): Promise<void> {
  const { token } = await probe("/token", { method: "POST", body: JSON.stringify({ repo: "trunk", scope: "write" }) });
  saveToken("trunk", token);
  const dir = join(WORK, "trunk");
  if (existsSync(dir)) throw new Error(`${dir} exists; trunk is already seeded`);
  mkdirSync(dir);
  await git(dir, "trunk", ["init", "-q", "-b", "main"]);
  for (const pkg of ["api", "web", "shared"]) {
    mkdirSync(join(dir, "packages", pkg, "src"), { recursive: true });
    for (let i = 1; i <= 10; i++) {
      writeFileSync(join(dir, "packages", pkg, "src", `module${i}.ts`), `export const ${pkg}${i} = ${i};\n`);
    }
  }
  mkdirSync(join(dir, "db", "migrations"), { recursive: true });
  writeFileSync(join(dir, "db", "migrations", "0001_init.sql"), "create table changes (id text primary key);\n");
  writeFileSync(join(dir, "package.json"), '{ "name": "commute-demo", "private": true }\n');
  writeFileSync(join(dir, "README.md"), "# Commute demo trunk\n");
  const dates = { GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z" };
  await git(dir, "trunk", ["add", "-A"]);
  await git(dir, "trunk", ["commit", "-q", "-m", "Seed the demo trunk"], dates);
  await git(dir, "trunk", ["notes", "add", "-m", "intent: seed the demo trunk\nowner: probe"], dates);
  await git(dir, "trunk", ["remote", "add", "origin", remoteFor("trunk", "direct")]);
  const startedAt = Date.now();
  await git(dir, "trunk", ["push", "-q", "origin", "main", "refs/notes/commits"]);
  const head = await git(dir, "trunk", ["rev-parse", "HEAD"]);
  console.log(JSON.stringify({ head, pushMs: Date.now() - startedAt }));
}

async function fork(name: string, allBranches: boolean): Promise<void> {
  const startedAt = Date.now();
  const result = await probe("/fork", {
    method: "POST",
    body: JSON.stringify({ from: "trunk", name, defaultBranchOnly: !allBranches }),
  });
  saveToken(name, result.token);
  const { token: _token, ...timings } = result;
  const entry = { name, allBranches, roundTripMs: Date.now() - startedAt, ...timings };
  record("forks.jsonl", entry);
  console.log(JSON.stringify(entry));
}

async function push(repo: string, via: "direct" | "proxy", label: string): Promise<void> {
  const dir = join(WORK, `${repo}-${via}`);
  if (!existsSync(dir)) {
    const cloneStartedAt = Date.now();
    await git(WORK, repo, ["clone", "-q", remoteFor(repo, via), dir]);
    record("clones.jsonl", { repo, via, cloneMs: Date.now() - cloneStartedAt });
  }
  const file = join(dir, "packages", "web", "src", `${repo}.ts`);
  appendFileSync(file, `// ${label}\n`);
  await git(dir, repo, ["add", "-A"]);
  await git(dir, repo, ["commit", "-q", "-m", `${repo}: ${label}`]);
  const head = await git(dir, repo, ["rev-parse", "HEAD"]);
  const pushStartedAt = Date.now();
  await git(dir, repo, ["push", "-q", "origin", "HEAD:main"]);
  const entry = { repo, via, label, head, pushStartedAt, pushDoneAt: Date.now() };
  record("pushes.jsonl", entry);
  console.log(JSON.stringify({ ...entry, pushMs: entry.pushDoneAt - pushStartedAt }));
}

async function listen(seconds: number): Promise<void> {
  const socket = new WebSocket(`${PROBE_URL.replace("https://", "wss://")}/ws`, {
    headers: { authorization: `Bearer ${PROBE_KEY}` },
  } as any);
  socket.addEventListener("open", () => console.log(JSON.stringify({ listening: true, at: Date.now() })));
  socket.addEventListener("message", (event) => {
    const entry = { localAt: Date.now(), event: JSON.parse(String(event.data)) };
    record("events.jsonl", entry);
    console.log(JSON.stringify(entry));
  });
  socket.addEventListener("close", (event) => console.log(JSON.stringify({ closed: event.code, at: Date.now() })));
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  socket.close();
}

// Joins each push with the first event of each kind that names its commit.
function latency(): void {
  const read = (file: string) =>
    existsSync(join(RECORDS, file))
      ? readFileSync(join(RECORDS, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
  const pushes = read("pushes.jsonl");
  const events = read("events.jsonl");
  for (const p of pushes) {
    const viaProxy = events.find((e) => e.event.kind === "proxy.pushed" && e.event.updates.some((u: any) => u.new === p.head));
    const viaQueue = events.find((e) => e.event.kind === "queue" && e.event.body?.payload?.after === p.head);
    console.log(
      JSON.stringify({
        repo: p.repo,
        via: p.via,
        label: p.label,
        head: p.head.slice(0, 10),
        pushMs: p.pushDoneAt - p.pushStartedAt,
        proxyEventAfterPushMs: viaProxy ? viaProxy.localAt - p.pushDoneAt : null,
        queueEventAfterPushMs: viaQueue ? viaQueue.localAt - p.pushDoneAt : null,
        queueEventTimestampLagMs: viaQueue ? Date.parse(viaQueue.event.body.metadata.eventTimestamp) - p.pushDoneAt : null,
      }),
    );
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "seed":
    await seed();
    break;
  case "fork":
    await fork(args[0], args.includes("--all-branches"));
    break;
  case "push":
    await push(args[0], args[1] as "direct" | "proxy", args[2] ?? new Date().toISOString());
    break;
  case "listen":
    await listen(Number(args[0]));
    break;
  case "footprint":
    console.log(JSON.stringify(await probe(`/footprint?repo=${args[0]}&from=${args[1]}&to=${args[2]}`), null, 2));
    break;
  case "tree":
    console.log(JSON.stringify(await probe(`/tree?repo=${args[0]}&commit=${args[1]}`), null, 2));
    break;
  case "log":
    console.log(JSON.stringify(await probe(`/log?repo=${args[0]}&ref=${encodeURIComponent(args[1])}`), null, 2));
    break;
  case "latency":
    latency();
    break;
  default:
    throw new Error(`unknown command ${command}`);
}

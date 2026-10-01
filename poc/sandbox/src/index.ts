// Spike probe for the Commute PoC: can a container run git against Artifacts
// remotes, compute a merge without a worktree, and run a check, and how long
// does each step take cold and warm? Not production code.
import { DurableObject } from "cloudflare:workers";

interface Secrets {
  PROBE_KEY: string;
}
type ProbeEnv = Env & Secrets;

type Step = { name: string; ms: number; exitCode: number; stdout: string; stderr: string };

const OUTPUT_CHARS_MAX = 1_500;
const IMAGE = "cloudflare/debian-trixie";
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_KEY}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    const runner = env.RUNNER.getByName(url.searchParams.get("runner") ?? "runner-1");
    if (request.method === "POST" && url.pathname === "/merge") {
      const { left, right, snapshotId } = await request.json<{ left: string; right: string; snapshotId?: string }>();
      const remotes = {
        TRUNK_URL: await authenticatedRemote(env, "trunk"),
        LEFT_URL: await authenticatedRemote(env, left),
        RIGHT_URL: await authenticatedRemote(env, right),
      };
      return Response.json(await runner.mergeProbe(remotes, snapshotId));
    }
    if (request.method === "POST" && url.pathname === "/snapshot") {
      return Response.json(await runner.snapshot());
    }
    if (request.method === "POST" && url.pathname === "/stop") {
      return Response.json(await runner.stop());
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<ProbeEnv>;

// A read token that lives 10 minutes, embedded in the remote for one command.
// Production should keep tokens out of the container (interceptOutboundHttp).
async function authenticatedRemote(env: ProbeEnv, repo: string): Promise<string> {
  using handle = await env.ARTIFACTS.get(repo);
  const info = await handle.info();
  const token = await handle.createToken("read", 600);
  const secret = token.plaintext.split("?expires=")[0];
  return `https://x:${secret}@${info.remote.slice("https://".length)}`;
}

export class Runner extends DurableObject<ProbeEnv> {
  async mergeProbe(remotes: Record<string, string>, snapshotId?: string): Promise<{ coldStart: boolean; fromSnapshot: boolean; steps: Step[] }> {
    const container = this.ctx.container;
    if (!container) throw new Error("no container is configured");
    const coldStart = !container.running;
    const steps: Step[] = [];
    const startedAt = Date.now();
    const fromSnapshot = coldStart && snapshotId !== undefined;
    if (fromSnapshot) {
      container.start({ containerSnapshot: { id: snapshotId }, entrypoint: ["sleep", "infinity"], enableInternet: true });
    } else if (coldStart) {
      container.start({ image: IMAGE, entrypoint: ["sleep", "infinity"], enableInternet: true });
    }
    if (coldStart) await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    steps.push(await this.run("first exec (includes boot when cold)", ["true"], {}, startedAt));
    steps.push(await this.run("environment", ["bash", "-lc", "git --version; node --version; nproc; free -m | head -2; df -h / | tail -1"]));

    const hasGit = steps[1].stdout.includes("git version");
    if (!hasGit) {
      steps.push(
        await this.run("install git", [
          "bash",
          "-lc",
          "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates >/dev/null && git --version",
        ]),
      );
    }

    const workdir = `/work/${Date.now()}`;
    const env = { ...remotes, GIT_TERMINAL_PROMPT: "0" };
    steps.push(await this.run("clone trunk", ["bash", "-lc", `git clone -q "$TRUNK_URL" ${workdir} && git -C ${workdir} log --oneline -1`], env));
    steps.push(
      await this.run(
        "fetch both changes",
        ["bash", "-lc", `cd ${workdir} && git fetch -q "$LEFT_URL" main:refs/changes/left && git fetch -q "$RIGHT_URL" main:refs/changes/right && git rev-parse refs/changes/left refs/changes/right`],
        env,
      ),
    );
    steps.push(
      await this.run("merge-tree left right", ["bash", "-lc", `cd ${workdir} && git merge-tree --write-tree --name-only refs/changes/left refs/changes/right; echo "exit=$?"`]),
    );
    steps.push(
      await this.run("merge-tree right left", ["bash", "-lc", `cd ${workdir} && git merge-tree --write-tree --name-only refs/changes/right refs/changes/left; echo "exit=$?"`]),
    );
    steps.push(
      await this.run("subtree hashes", ["bash", "-lc", `cd ${workdir} && for p in packages/web packages/api packages/shared db/migrations; do echo "$p $(git rev-parse refs/changes/left:$p)"; done`]),
    );
    steps.push(
      await this.run("check: node parses every web module", [
        "bash",
        "-lc",
        `cd ${workdir} && git checkout -q refs/changes/left && for f in packages/web/src/*.ts; do node --experimental-strip-types --check "$f" || exit 1; done && echo "checked $(ls packages/web/src/*.ts | wc -l) files"`,
      ]),
    );
    return { coldStart, fromSnapshot, steps };
  }

  async snapshot(): Promise<{ id: string; size: number; ms: number }> {
    const container = this.ctx.container;
    if (!container?.running) throw new Error("container is not running");
    const startedAt = Date.now();
    const handle = await container.snapshotContainer({ name: "trixie-with-git" });
    return { id: handle.id, size: handle.size, ms: Date.now() - startedAt };
  }

  async stop(): Promise<{ wasRunning: boolean }> {
    const container = this.ctx.container;
    if (!container) throw new Error("no container is configured");
    const wasRunning = container.running;
    if (wasRunning) await container.destroy();
    return { wasRunning };
  }

  private async run(name: string, cmd: string[], env: Record<string, string> = {}, startedAt = Date.now()): Promise<Step> {
    const container = this.ctx.container!;
    const process = await container.exec(cmd, { env, stderr: "pipe" });
    const output = await process.output();
    const decode = (bytes: ArrayBuffer) => scrub(new TextDecoder().decode(bytes)).slice(-OUTPUT_CHARS_MAX);
    return { name, ms: Date.now() - startedAt, exitCode: output.exitCode, stdout: decode(output.stdout), stderr: decode(output.stderr) };
  }
}

// Remotes carry a token secret; git can echo a remote in its errors.
function scrub(text: string): string {
  return text.replace(/https:\/\/x:[^@\s]+@/g, "https://x:<redacted>@");
}

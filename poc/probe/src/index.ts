// Spike probe for the Commute PoC. It measures Artifacts forks, tree reads,
// and two ways to learn about pushes: Artifacts event subscriptions (via a
// Queue) and a git proxy in front of Artifacts. Not production code.
import { DurableObject } from "cloudflare:workers";

interface Secrets {
  PROBE_KEY: string;
}
type ProbeEnv = Env & Secrets;

type RefUpdate = { old: string; new: string; ref: string };

type ProbeEvent =
  | { kind: "proxy.pushed"; repo: string; updates: RefUpdate[]; workerAt: number }
  | { kind: "queue"; body: unknown; workerAt: number };

// Bounds for the spike: a push body is buffered whole, and a footprint walk
// stops after this many tree reads.
const PUSH_BODY_BYTES_MAX = 50 * 1024 * 1024;
const TREE_READS_MAX = 2_000;

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const url = new URL(request.url);

    // Git traffic carries its own Artifacts token, which Artifacts validates.
    if (url.pathname.startsWith("/git/")) return proxyGit(request, url, env);

    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_KEY}`) {
      return new Response("unauthorized", { status: 401 });
    }

    if (url.pathname === "/ws") {
      return hub(env).fetch(request);
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const { repo, scope } = await request.json<{ repo: string; scope: "read" | "write" }>();
      using handle = await env.ARTIFACTS.get(repo);
      const info = await handle.info();
      const token = await handle.createToken(scope, 3600);
      return Response.json({ remote: info.remote, token: token.plaintext, expiresAt: token.expiresAt });
    }
    if (request.method === "POST" && url.pathname === "/fork") {
      const { from, name, defaultBranchOnly } = await request.json<{
        from: string;
        name: string;
        defaultBranchOnly: boolean;
      }>();
      const startedAt = Date.now();
      using source = await env.ARTIFACTS.get(from);
      const gotAt = Date.now();
      const forked = await source.fork(name, { defaultBranchOnly });
      const forkedAt = Date.now();
      const ready = await waitUntilReady(env, name);
      return Response.json({
        remote: forked.remote,
        token: forked.token,
        getMs: gotAt - startedAt,
        forkMs: forkedAt - gotAt,
        readyMs: ready.ms,
        readyPolls: ready.polls,
        readyErrors: ready.errors,
      });
    }
    if (url.pathname === "/log") {
      using handle = await env.ARTIFACTS.get(required(url, "repo"));
      const ref = required(url, "ref");
      return Response.json(await handle.log({ ref, limit: 20 }));
    }
    if (url.pathname === "/tree") {
      using handle = await env.ARTIFACTS.get(required(url, "repo"));
      const commit = await handle.readCommit(required(url, "commit"));
      if (commit === null) return new Response("commit not found", { status: 404 });
      return Response.json({ commit, root: await handle.readTree(commit.treeHash) });
    }
    if (url.pathname === "/footprint") {
      using handle = await env.ARTIFACTS.get(required(url, "repo"));
      const startedAt = Date.now();
      const footprint = await diffCommits(handle, required(url, "from"), required(url, "to"));
      return Response.json({ ...footprint, ms: Date.now() - startedAt });
    }
    return new Response("not found", { status: 404 });
  },

  async queue(batch: MessageBatch<unknown>, env: ProbeEnv): Promise<void> {
    for (const message of batch.messages) {
      await hub(env).publish({ kind: "queue", body: message.body, workerAt: Date.now() });
      message.ack();
    }
  },
} satisfies ExportedHandler<ProbeEnv>;

function hub(env: ProbeEnv): DurableObjectStub<Hub> {
  return env.HUB.get(env.HUB.idFromName("probe"));
}

function required(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value === "") throw new Error(`missing query parameter ${name}`);
  return value;
}

// A fork returns before the new repo may serve reads; get() throws until the
// repo is ready.
async function waitUntilReady(env: ProbeEnv, name: string): Promise<{ ms: number; polls: number; errors: string[] }> {
  const startedAt = Date.now();
  const errors: string[] = [];
  for (let polls = 1; polls <= 50; polls++) {
    try {
      using repo = await env.ARTIFACTS.get(name);
      await repo.info();
      return { ms: Date.now() - startedAt, polls, errors };
    } catch (error) {
      errors.push(String((error as { code?: string }).code ?? error));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`fork ${name} not ready after 50 polls: ${errors.at(-1)}`);
}

// Paths that differ between two commits, found by walking only the subtrees
// whose hashes differ. A changed directory that exists on one side only is
// reported as that directory, not expanded.
async function diffCommits(
  repo: ArtifactsRepo,
  fromCommit: string,
  toCommit: string,
): Promise<{ paths: string[]; treeReads: number }> {
  const from = await repo.readCommit(fromCommit);
  const to = await repo.readCommit(toCommit);
  if (from === null || to === null) throw new Error("commit not found");

  const paths: string[] = [];
  let treeReads = 0;
  const pending: Array<{ prefix: string; left: string; right: string }> = [
    { prefix: "", left: from.treeHash, right: to.treeHash },
  ];
  while (pending.length > 0) {
    const { prefix, left, right } = pending.pop()!;
    treeReads += 2;
    if (treeReads > TREE_READS_MAX) throw new Error(`footprint walk exceeded ${TREE_READS_MAX} tree reads`);
    const [leftEntries, rightEntries] = await Promise.all([repo.readTree(left), repo.readTree(right)]);
    if (leftEntries === null || rightEntries === null) throw new Error("tree not found");
    const leftByName = new Map(leftEntries.map((e) => [e.name, e]));
    const rightByName = new Map(rightEntries.map((e) => [e.name, e]));
    for (const name of new Set([...leftByName.keys(), ...rightByName.keys()])) {
      const l = leftByName.get(name);
      const r = rightByName.get(name);
      if (l?.hash === r?.hash) continue;
      const path = prefix + name;
      if (l?.type === "tree" && r?.type === "tree") {
        pending.push({ prefix: path + "/", left: l.hash, right: r.hash });
      } else {
        paths.push(path);
      }
    }
  }
  return { paths: paths.sort(), treeReads };
}

// Forwards git smart HTTP to the Artifacts remote. After a successful
// receive-pack, it publishes the ref updates that the client sent.
async function proxyGit(request: Request, url: URL, env: ProbeEnv): Promise<Response> {
  const match = url.pathname.match(/^\/git\/([A-Za-z0-9][A-Za-z0-9._-]*)\.git(\/.*)$/);
  if (match === null) return new Response("bad git path", { status: 400 });
  const [, repo, rest] = match;
  const upstream = `${env.ARTIFACTS_GIT_ORIGIN}/${repo}.git${rest}${url.search}`;

  const isPush = request.method === "POST" && rest === "/git-receive-pack";
  if (!isPush) {
    return fetch(upstream, { method: request.method, headers: request.headers, body: request.body });
  }

  // ceiling: the push body is buffered whole to read its ref commands. Debt — stream and tee it when pushes exceed PUSH_BODY_BYTES_MAX.
  const body = await request.arrayBuffer();
  if (body.byteLength > PUSH_BODY_BYTES_MAX) return new Response("push too large for probe", { status: 413 });
  const response = await fetch(upstream, { method: "POST", headers: request.headers, body });
  if (response.ok) {
    const updates = await readRefUpdates(body, request.headers.get("content-encoding"));
    await hub(env).publish({ kind: "proxy.pushed", repo, updates, workerAt: Date.now() });
  }
  return response;
}

// Reads the pkt-line command list at the start of a receive-pack request:
// "<old> <new> <ref>", the first one followed by NUL and capabilities.
async function readRefUpdates(body: ArrayBuffer, encoding: string | null): Promise<RefUpdate[]> {
  let bytes = new Uint8Array(body);
  if (encoding === "gzip") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const decoder = new TextDecoder();
  const updates: RefUpdate[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = parseInt(decoder.decode(bytes.subarray(offset, offset + 4)), 16);
    if (length === 0) break;
    const line = decoder.decode(bytes.subarray(offset + 4, offset + length)).split("\0")[0].trim();
    const [old, next, ref] = line.split(" ");
    if (ref !== undefined) updates.push({ old, new: next, ref });
    offset += length;
  }
  return updates;
}

// One per probe. Holds the WebSocket listeners and fans events out to them.
export class Hub extends DurableObject<ProbeEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async publish(event: ProbeEvent): Promise<void> {
    const message = JSON.stringify({ ...event, hubAt: Date.now() });
    for (const socket of this.ctx.getWebSockets()) socket.send(message);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") socket.send("pong");
  }
}

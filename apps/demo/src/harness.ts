#!/usr/bin/env node
// Runs the Commute demo. Alice and Bob each run 10 scripted agents on the storefront project. Each agent starts a
// change with the commute CLI, edits one file, commits and pushes with plain git, and waits for its events. The
// script approves the batches, or a person approves them in the console when --console-approvals is set.
import type { ChangeEvent } from '@commute/api-client';

import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { approveBatch, createClient, createProject, getChange, getLanding, zChangeEvent } from '@commute/api-client';

import type { Agent, Edit } from './agents.ts';

import { AGENTS, BATCHES } from './agents.ts';

const runFile = promisify(execFile);
const SEED_DIR = fileURLToPath(new URL('../seed', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const STEP_TIMEOUT_MS = 900_000;
const ID_RADIX = 36;
const NAME_WIDTH = 8;
const START_CONCURRENCY = 3;
const START_STAGGER_MS = 200;
const WAIT_TIMEOUT_SECONDS = '900';
const CHANGE_LINE = /^change\s+(c-\d+)$/m;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env['COMMUTE_URL'] ?? 'http://localhost:8787' },
    project: { type: 'string', default: `demo-${Date.now().toString(ID_RADIX)}` },
    'console-approvals': { type: 'boolean', default: false }
  }
});
const url = values.url;
const projectId = values.project;
const isScriptApproving = !values['console-approvals'];
const client = createClient({ baseUrl: url });
const work = await mkdtemp(join(tmpdir(), 'commute-demo-'));
const agentEnv = { ...process.env, COMMUTE_URL: url, COMMUTE_PROJECT: projectId, GIT_TERMINAL_PROMPT: '0' };

step(`project ${projectId} on ${url}, working in ${work}`);
await seedTrunk();
const events = await followEvents();

step('Alice and Bob start 20 agents; each agent edits, commits, and pushes as soon as it starts');
const changeIds = new Map<string, string>();
const agentRuns: Array<Promise<void>> = [];
// Three starts run at a time, sent in the order of AGENTS and a little apart. The coordinator numbers a change when its
// start arrives, so alice-2 gets a lower number than alice-5, and alice-3 a lower number than bob-2.
const starting = new Set<Promise<void>>();
for (const agent of AGENTS) {
  if (starting.size >= START_CONCURRENCY) {
    await Promise.race(starting);
  }
  // A start that fails stays in the set, so the next race or the final wait throws its error.
  const start: Promise<void> = startAgent(agent).then((changeId) => {
    changeIds.set(agent.name, changeId);
    agentRuns.push(runAgent({ agent, changeId }));
    starting.delete(start);
  });
  starting.add(start);
  await new Promise((resolve) => setTimeout(resolve, START_STAGGER_MS));
}
await Promise.all(starting);
step('all 20 agents started');
const changeIdOf = (name: string): string => {
  const changeId = changeIds.get(name);
  if (changeId === undefined) {
    throw new Error(`Agent ${name} has no change.`);
  }
  return changeId;
};

for (const [index, batch] of BATCHES.entries()) {
  const batchChangeIds = batch.agents.map(changeIdOf);
  await events.until(`batch ${index + 1} is ready`, async () => {
    const landing = (await getLanding({ client, path: { projectId }, throwOnError: true })).data;
    const ready = new Set(landing.ready.map((change) => change.changeId));
    return landing.batch === null && batchChangeIds.every((changeId) => ready.has(changeId));
  });
  if (isScriptApproving) {
    await approveBatch({
      client,
      path: { projectId },
      body: { changeIds: batchChangeIds, approver: batch.approver },
      throwOnError: true
    });
    step(`${batch.approver} approves batch ${index + 1}: ${batchChangeIds.join(', ')}`);
  } else {
    step(`waiting for ${batch.approver} to approve batch ${index + 1} in the console: ${batchChangeIds.join(', ')}`);
  }
  await events.until(`batch ${index + 1} lands`, async () =>
    batchChangeIds.every((changeId) =>
      events.all.some((event) => event.type === 'landed' && event.changeId === changeId)
    )
  );
  step(`batch ${index + 1} landed`);
}
await Promise.all(agentRuns);
events.close();
await summarize(events.all);

function step(message: string): void {
  console.log(`== ${message}`);
}

type GitParams = {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

async function git({ args, cwd, env = agentEnv }: GitParams): Promise<string> {
  const { stdout } = await runFile('git', args, { cwd, env });
  return stdout;
}

async function seedTrunk(): Promise<void> {
  const created = (await createProject({ client, body: { projectId }, throwOnError: true })).data;
  const trunk = join(work, 'trunk');
  await cp(SEED_DIR, trunk, { recursive: true });
  await git({ args: ['init', '-q', '-b', 'main'], cwd: trunk });
  await git({ args: ['add', '-A'], cwd: trunk });
  await git({
    args: [
      '-c',
      'user.name=Commute Demo',
      '-c',
      'user.email=demo@commute.invalid',
      'commit',
      '-q',
      '-m',
      'Seed the storefront'
    ],
    cwd: trunk
  });
  // The token reaches git through the environment of a one-off credential helper, never through an argument.
  const helper = '!f() { test "$1" = get && echo username=commute && echo "password=$TRUNK_TOKEN"; }; f';
  await git({
    args: ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'push', '-q', created.remote, 'main'],
    cwd: trunk,
    env: { ...agentEnv, TRUNK_TOKEN: created.token }
  });
  step('trunk seeded with the storefront');
}

async function startAgent(agent: Agent): Promise<string> {
  const { stdout } = await runFile(
    'node',
    [CLI_PATH, 'start', agent.intent, '--paths', agent.edit.path, '--as', agent.owner, '--dir', agent.name],
    { cwd: work, env: agentEnv }
  );
  const changeId = CHANGE_LINE.exec(stdout)?.[1];
  if (changeId === undefined) {
    throw new Error(`commute start for ${agent.name} printed no change: ${stdout}`);
  }
  for (const line of stdout.trimEnd().split('\n')) {
    console.log(`${agent.name.padEnd(NAME_WIDTH)} ${line}`);
  }
  return changeId;
}

type RunAgentParams = {
  agent: Agent;
  changeId: string;
};

// The agent edits its file, commits as its owner, pushes, and prints each event until its change lands.
async function runAgent({ agent, changeId }: RunAgentParams): Promise<void> {
  const dir = join(work, agent.name);
  await applyEdit({ dir, edit: agent.edit });
  await git({ args: ['add', '-A'], cwd: dir });
  await git({
    args: [
      '-c',
      `user.name=${agent.owner}`,
      '-c',
      `user.email=${agent.owner}@demo.commute.invalid`,
      'commit',
      '-q',
      '-m',
      agent.intent
    ],
    cwd: dir
  });
  await git({ args: ['push', '-q'], cwd: dir });
  console.log(`${agent.name.padEnd(NAME_WIDTH)} ${changeId} pushed`);
  for (;;) {
    const { stdout } = await runFile('node', [CLI_PATH, 'wait', '--timeout', WAIT_TIMEOUT_SECONDS], {
      cwd: dir,
      env: agentEnv
    });
    const line = stdout.trimEnd();
    console.log(`${agent.name.padEnd(NAME_WIDTH)} ${changeId} ${line}`);
    if (line.startsWith('restack')) {
      await git({ args: ['pull', '-q', '--ff-only'], cwd: dir });
    }
    if (line.startsWith('landed')) {
      return;
    }
  }
}

type ApplyEditParams = {
  dir: string;
  edit: Edit;
};

async function applyEdit({ dir, edit }: ApplyEditParams): Promise<void> {
  const file = join(dir, edit.path);
  if (edit.kind === 'write') {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, edit.text);
    return;
  }
  const text = await readFile(file, 'utf8');
  if (edit.kind === 'append') {
    await writeFile(file, `${text}${edit.text}`);
    return;
  }
  if (!text.includes(edit.find)) {
    throw new Error(`${edit.path} has no line ${JSON.stringify(edit.find)}.`);
  }
  await writeFile(file, text.replace(edit.find, edit.text));
}

type EventFollower = {
  all: ChangeEvent[];
  until: (description: string, isDone: () => Promise<boolean>) => Promise<void>;
  close: () => void;
};

// Follows the project's event stream. A wait checks its condition now and again after each event, so the script
// never polls.
async function followEvents(): Promise<EventFollower> {
  const all: ChangeEvent[] = [];
  const listeners = new Set<() => void>();
  let isClosing = false;
  let lostError: Error | null = null;
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/projects/${projectId}/events`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('The project event stream did not open.')), { once: true });
  });
  socket.send(JSON.stringify({ after: 0 }));
  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  socket.addEventListener('message', (message) => {
    all.push(zChangeEvent.parse(JSON.parse(String(message.data))));
    notify();
  });
  socket.addEventListener('close', () => {
    if (!isClosing) {
      lostError = new Error('The project event stream closed.');
      notify();
    }
  });
  const until = async (description: string, isDone: () => Promise<boolean>): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      let isChecking = false;
      let isStale = false;
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Timed out: ${description}.`));
      }, STEP_TIMEOUT_MS);
      function check(): void {
        if (lostError !== null) {
          clearTimeout(timer);
          listeners.delete(check);
          reject(lostError);
          return;
        }
        if (isChecking) {
          isStale = true;
          return;
        }
        isChecking = true;
        isDone()
          .then((isMet) => {
            isChecking = false;
            if (isMet) {
              clearTimeout(timer);
              listeners.delete(check);
              resolve();
            } else if (isStale) {
              isStale = false;
              check();
            }
          })
          .catch(reject);
      }
      listeners.add(check);
      check();
    });
  };
  const close = (): void => {
    isClosing = true;
    socket.close();
  };
  return { all, until, close };
}

// The outcomes that the demo promises, in a stable form, so two runs compare line by line.
async function summarize(all: ChangeEvent[]): Promise<void> {
  const changes = await Promise.all(
    [...changeIds.values()].map(
      async (changeId) => (await getChange({ client, path: { projectId, changeId }, throwOnError: true })).data
    )
  );
  const nameOf = new Map([...changeIds].map(([name, changeId]) => [changeId, name]));
  const pairs = new Set(
    all.flatMap((event) =>
      event.type === 'merge_checked'
        ? [
            `${[nameOf.get(event.changeId), nameOf.get(event.otherChange.changeId)].toSorted(byName).join(' + ')} ${event.outcome}`
          ]
        : []
    )
  );
  const resolved = all.flatMap((event) =>
    event.type === 'restacked' && event.resolvedPaths.length > 0
      ? [`${nameOf.get(event.changeId)} ${event.resolvedPaths.join(', ')}`]
      : []
  );
  const checks = changes.flatMap((change) => change.checks);
  const kept = checks.filter((check) => check.kept).length;
  const ran = checks.filter((check) => !check.kept).length;
  step('summary');
  console.log(`landed      ${changes.filter((change) => change.state === 'landed').length} of ${AGENTS.length}`);
  for (const pair of [...pairs].toSorted((left, right) => left.localeCompare(right))) {
    console.log(`overlap     ${pair}`);
  }
  for (const line of resolved.toSorted((left, right) => left.localeCompare(right))) {
    console.log(`resolved    ${line}`);
  }
  console.log(`checks      ${kept} kept, ${ran} ran on the final heads`);
}

function byName(left = '', right = ''): number {
  return left.localeCompare(right);
}

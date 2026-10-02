#!/usr/bin/env node
// Records the demo video. A stage page shows captions and the agents' terminal next to the console. The recorder
// runs the harness with console approvals and approves each batch in the console, as a person would.
import type { ServerResponse } from 'node:http';

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile } from 'node:fs/promises';

const CONSOLE_URL = process.env['COMMUTE_URL'] ?? 'http://localhost:8787';
const STAGE_PORT = 4_545;
const VIEWPORT = { width: 1_600, height: 900 };
const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const HARNESS_PATH = fileURLToPath(new URL('harness.ts', import.meta.url));
const STAGE_PATH = fileURLToPath(new URL('stage.html', import.meta.url));
const SECOND_MS = 1_000;
const ID_RADIX = 36;
// How long each beat stays on screen, in seconds.
const TITLE_SECONDS = 6;
const CARD_SECONDS = 14;
const PUSH_SECONDS = 20;
const BEAT_SECONDS = 12;
const PAGE_SECONDS = 10;
const FILES_SECONDS = 8;
const SUMMARY_SECONDS = 15;
const CLICK_SECONDS = 2;
const AFTER_LANDING_SECONDS = 4;
const AGENT_LINE = /^(alice-\d+|bob-\d+)\s+change\s+(c-\d+)$/;
// The harness prints its steps quickly, but a batch can take minutes to become ready.
const LINE_TIMEOUT_MS = 900_000;

const projectId = `demo-${Date.now().toString(ID_RADIX)}`;
const streams = new Set<ServerResponse>();
const lines: string[] = [];
const lineListeners = new Set<() => void>();
let harnessExitCode: number | null | undefined;
const changeIds = new Map<string, string>();

let onStreamOpen: () => void = () => undefined;
const streamOpen = new Promise<void>((resolve) => {
  onStreamOpen = resolve;
});
const stage = createServer((request, response) => {
  if (request.url === '/stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    streams.add(response);
    request.on('close', () => streams.delete(response));
    onStreamOpen();
    return;
  }
  readFile(STAGE_PATH, 'utf8')
    .then((html) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    })
    .catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
});
await new Promise<void>((resolve) => stage.listen(STAGE_PORT, resolve));

await mkdir(RECORDING_DIR, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: RECORDING_DIR, size: VIEWPORT } });
const page = await context.newPage();
await page.goto(`http://localhost:${STAGE_PORT}/`);
await streamOpen;
const frame = page.frameLocator('#console');

send('card', {
  title: 'Commute',
  items: ['Many coding agents work on one repository at the same time.', 'Changes that commute land in any order.']
});
await hold(TITLE_SECONDS);
send('card', {
  title: 'Why a new forge',
  items: [
    'Conflicts are cheap: an agent fixes a text conflict in about a minute.',
    'Waiting is expensive: a stack makes each change wait for the one ahead.',
    'A rebase throws away results: checks keyed to a commit run again.'
  ]
});
await hold(CARD_SECONDS);
send('card', { title: null, items: [] });

caption('Start', 'Alice and Bob each start 10 agents with commute start. Overlaps show up before any code is written.');
const harness = spawn('node', [HARNESS_PATH, '--project', projectId, '--console-approvals'], {
  env: { ...process.env, COMMUTE_URL: CONSOLE_URL },
  stdio: ['ignore', 'pipe', 'inherit']
});
createInterface({ input: harness.stdout }).on('line', (line) => {
  lines.push(line);
  const agent = AGENT_LINE.exec(line);
  if (agent?.[1] !== undefined && agent[2] !== undefined) {
    changeIds.set(agent[1], agent[2]);
  }
  send('line', line);
  for (const listener of lineListeners) {
    listener();
  }
});
const harnessExit = new Promise<number | null>((resolve) =>
  harness.on('exit', (code) => {
    harnessExitCode = code;
    for (const listener of lineListeners) {
      listener();
    }
    resolve(code);
  })
);

await nextLine(/^== trunk seeded/);
await show(`/p/${projectId}/changes`);
await nextLine(/^== all 20 agents started/);
caption('Push', 'Each agent pushes with plain git. Merge checks run only where two footprints meet.');
await hold(PUSH_SECONDS);
await show(`/p/${projectId}/tree/trunk/src/cart`);
caption('Code', 'The code view shows trunk, and each folder lists the changes in flight that touch it.');
await hold(BEAT_SECONDS);
await show(`/p/${projectId}/changes`);
caption('Checks', 'Each check runs once per content. Changes that did not touch a folder keep its results.');

await approveInConsole({
  batch: 1,
  text: 'Bob approves one batch with changes from both people. Two conflicting pairs wait for the change ahead.'
});
caption('Kept', 'The changes in flight move onto the new trunk. Only checks whose folders changed run again.');
await hold(PAGE_SECONDS);

const alice3 = changeIdOf('alice-3');
const bob2 = changeIdOf('bob-2');
await show(`/p/${projectId}/changes/${bob2}`);
caption(
  'Conflict',
  `Alice's ${alice3} and Bob's ${bob2} add a page at the same line. Commute resolved it at Bob's first push by choosing lines from both.`
);
await hold(BEAT_SECONDS);
await show(`/p/${projectId}/overlaps/${bob2}/${alice3}`);
await hold(PAGE_SECONDS);
await approveInConsole({ batch: 2, text: `Alice approves ${alice3} alone. Nobody touches ${bob2}.` });
await show(`/p/${projectId}/changes/${bob2}`);
caption('Resolved', `${bob2} restacks with the stored resolution. No second model call, and neither person acts.`);
await hold(PAGE_SECONDS);
await show(`/p/${projectId}/changes/${bob2}?tab=checks`);
caption('One check runs', 'Only the routes check runs again, because only src/routes.mjs changed under it.');
await hold(PAGE_SECONDS);
await show(`/p/${projectId}/changes/${bob2}?tab=files`);
await hold(FILES_SECONDS);

await approveInConsole({ batch: 3, text: 'Bob approves the next batch.' });
await approveInConsole({
  batch: 4,
  text: "Alice's gift wrap change landed after her discount, with its conflict resolved the same way."
});

caption('Agent view', 'Agents use commute start, plain git, and commute wait. No agent and no page polls.');
await show(`/p/${projectId}/tree/trunk`);
await nextLine(/^checks /);
await hold(BEAT_SECONDS);
const summary = lines.slice(lines.findIndex((line) => line === '== summary') + 1);
send('card', { title: 'One run, 20 agents, two people', items: summary });
await hold(SUMMARY_SECONDS);

await harnessExit;
const video = page.video();
await context.close();
await browser.close();
stage.close();
console.log(`video ${await video?.path()}`);

function send(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const stream of streams) {
    stream.write(message);
  }
}

function caption(title: string, text: string): void {
  send('caption', { title, text });
}

async function hold(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * SECOND_MS));
}

async function show(path: string): Promise<void> {
  await page.evaluate((url) => {
    const element = document.getElementById('console');
    if (element instanceof HTMLIFrameElement) {
      element.src = url;
    }
  }, `${CONSOLE_URL}${path}`);
  await frame.locator('main').waitFor();
}

// Resolves with the first harness line that matches. It fails when the harness exits first or the line is late.
async function nextLine(pattern: RegExp): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`No harness line matched ${pattern} in time.`)), LINE_TIMEOUT_MS);
    function finish(result: RegExpExecArray | Error): void {
      clearTimeout(timer);
      lineListeners.delete(check);
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    }
    function check(): void {
      for (const line of lines) {
        const match = pattern.exec(line);
        if (match !== null) {
          finish(match);
          return;
        }
      }
      if (harnessExitCode !== undefined) {
        finish(new Error(`The harness exited with ${String(harnessExitCode)} before a line matched ${pattern}.`));
      }
    }
    lineListeners.add(check);
    check();
  });
}

function changeIdOf(name: string): string {
  const changeId = changeIds.get(name);
  if (changeId === undefined) {
    throw new Error(`The harness did not print a change for ${name}.`);
  }
  return changeId;
}

type ApproveParams = {
  batch: number;
  text: string;
};

// Waits until the harness asks for the batch, then a person types their name, picks the batch, and approves it.
async function approveInConsole({ batch, text }: ApproveParams): Promise<void> {
  const [, approver, ids] = await nextLine(
    new RegExp(`^== waiting for (alice|bob) to approve batch ${batch} in the console: (.+)$`)
  );
  if (approver === undefined || ids === undefined) {
    throw new Error(`The approval line of batch ${batch} names no approver or changes.`);
  }
  const batchIds = new Set(ids.split(', '));
  caption('Land', text);
  await show(`/p/${projectId}/changes`);
  // fill sets the whole value at once; typing key by key loses keys while live events re-render the page.
  await frame.getByLabel('Your name', { exact: true }).fill(approver);
  for (const box of await frame.locator('input[data-change-id]').all()) {
    await box.setChecked(batchIds.has((await box.getAttribute('data-change-id')) ?? ''));
  }
  await hold(CLICK_SECONDS);
  await frame.getByRole('button', { name: /^Approve/ }).click();
  await nextLine(new RegExp(`^== batch ${batch} landed`));
  await hold(AFTER_LANDING_SECONDS);
}

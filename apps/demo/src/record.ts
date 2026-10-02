#!/usr/bin/env node
// Records a take of the walkthrough: a person uses the console, with a visible cursor, while the harness runs 20 agents
// for two people in the background. Every page after the first opens by a click on a link in the app. Each wait for
// the backend is marked fast, so the video plays it faster. `npm run compose` turns the take into the video.
import type { Locator } from 'playwright';

import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { AGENTS } from './agents.ts';
import { createHands, installCursor } from './hands.ts';
import { launchCaptureBrowser, startCapture } from './capture.ts';

const CONSOLE_URL = process.env['COMMUTE_URL'] ?? 'http://localhost:8787';
const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const TRANSCRIPTS_DIR = `${RECORDING_DIR}/transcripts`;
const HARNESS_PATH = fileURLToPath(new URL('harness.ts', import.meta.url));
const ID_RADIX = 36;
const PUSHED_LINE = /^\S+\s+c-\d+ pushed$/;
// The harness prints its steps quickly, but a batch can take minutes to become ready.
const LINE_TIMEOUT_MS = 900_000;
const CHECKS_TIMEOUT_MS = 300_000;
// Holds for reading: a caption stays on screen for about 200 words a minute.
const READING_MS_LEAD = 1_000;
const READING_MS_PER_WORD = 300;
const LOOK_MS = 1_500;
const END_MS = 3_000;
// After its restack, Bob's routes change runs the routes check again and keeps the results of the other five checks.
const KEPT_CHECKS = 5;
const ORDERS_INTENT = 'Add the orders page';

const projectId = `demo-${Date.now().toString(ID_RADIX)}`;
const lines: string[] = [];
const lineListeners = new Set<() => void>();
let harnessExitCode: number | null | undefined;
let batchesRequested = 0;

const { browser, context } = await launchCaptureBrowser();
await installCursor(context);
const page = await context.newPage();
const changesTab = page.getByRole('link', { name: /^Changes\b/ });
const codeTab = page.getByRole('link', { name: 'Code', exact: true });
const yourName = page.getByLabel('Your name', { exact: true });
const ordersRow = page.getByRole('link', { name: ORDERS_INTENT, exact: true });

const harness = spawn(
  'node',
  [HARNESS_PATH, '--project', projectId, '--console-approvals', '--transcripts', TRANSCRIPTS_DIR],
  { env: { ...process.env, COMMUTE_URL: CONSOLE_URL }, stdio: ['ignore', 'pipe', 'inherit'] }
);
createInterface({ input: harness.stdout }).on('line', (line) => {
  console.log(line);
  lines.push(line);
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
await page.goto(`${CONSOLE_URL}/p/${projectId}/changes`);
await page.getByRole('main').waitFor();
const hands = await createHands(page);
const capture = await startCapture({ page, recordingDir: RECORDING_DIR });

capture.chapter('1 · Overlaps are known at the start');
await narrate(`Alice and Bob start ${AGENTS.length} agents. Each change appears when its agent runs commute start.`);
const [alice3, bob2] = await fastUntil(async () => Promise.all([changeIdOf('alice-3'), changeIdOf('bob-2')]));
// The activity feed lists the newest events, so the overlap is shown while the agents still start.
const overlapEntry = page.getByText(`overlaps ${bob2} "`).first();
await fastUntil(async () => overlapEntry.waitFor());
await hoverWhile({ target: overlapEntry, text: 'Commute lists the overlaps before any code is pushed.' });
await fastUntil(async () => waitForLines({ pattern: PUSHED_LINE, count: AGENTS.length }));
await hands.click(codeTab);
await hands.click(page.getByRole('link', { name: 'src', exact: true }));
await hoverWhile({
  target: page.getByRole('heading', { name: 'Changes in flight here' }),
  text: 'The code view shows trunk, and the changes in flight in each folder.'
});

capture.chapter('2 · A conflict, resolved at the first push');
await hands.click(changesTab);
await hands.click(ordersRow);
await narrate(`Bob's ${bob2} and Alice's ${alice3} add a page at the same line of routes.mjs.`);
await fastUntil(async () => nextLine(new RegExp(`^bob-2\\s+${bob2} resolve `)));
await hands.click(page.getByRole('link', { name: 'View the overlap', exact: true }).last());
await hoverWhile({
  target: page.getByText(/'search',\s*'orders',|'orders',\s*'search',/).first(),
  text: 'Commute resolved the conflict by choosing lines that both changes wrote. It writes no code of its own.'
});
await narrate(`The resolution waits until ${alice3} lands. Neither person does anything.`);

capture.chapter('3 · People approve batches, and changes land in parallel');
const batch1 = await fastUntil(nextBatchRequest);
await hands.click(changesTab);
capture.say(`Bob approves the first batch: ${batch1.changeIds.size} changes from both people.`);
await chooseBatch(batch1);
await approve({
  request: batch1,
  caption: 'The batch lands at once. Changes that wait for an earlier change move onto the new trunk.'
});

capture.chapter('4 · Check results that still hold are kept');
const batch2 = await fastUntil(nextBatchRequest);
await chooseBatch(batch2);
await approve({ request: batch2, caption: `Alice lands ${alice3}.` });
await hands.click(ordersRow);
const restackLine = new RegExp(`^bob-2\\s+${bob2} restack .+ with Commute's resolution`);
await fastUntil(async () => nextLine(restackLine));
await hoverWhile({
  target: page.getByText(/with the resolution of/).first(),
  text: `${bob2} moves onto the new trunk with the stored resolution. No second model call.`
});
await hands.click(page.getByRole('link', { name: /^Checks\b/ }));
const routesRan = page.getByText(/^routes\s+ran for this content$/);
await fastUntil(async () => {
  await waitForLines({ pattern: new RegExp(`^bob-2\\s+${bob2} checks `), after: restackLine });
  await page
    .getByText('kept: a result for this content already existed', { exact: true })
    .nth(KEPT_CHECKS - 1)
    .waitFor({ timeout: CHECKS_TIMEOUT_MS });
  await routesRan.waitFor({ timeout: CHECKS_TIMEOUT_MS });
});
await hoverWhile({
  target: routesRan,
  text: 'Only the routes check runs again. The other five read files that did not change, so their results are kept.'
});
await hands.click(page.getByRole('link', { name: /^Files changed\b/ }));
await narrate('The diff keeps both pages.');

capture.chapter('5 · Everything lands');
await hands.click(changesTab);
const batch3 = await fastUntil(nextBatchRequest);
capture.say("The last two batches land the same way. Commute also resolved Alice's two pricing changes.");
await chooseBatch(batch3);
await approve({ request: batch3 });
const batch4 = await fastUntil(nextBatchRequest);
await chooseBatch(batch4);
await approve({ request: batch4 });
await fastUntil(async () => nextLine(new RegExp(`^landed\\s+${AGENTS.length} of ${AGENTS.length}$`)));
await hands.click(page.getByRole('link', { name: /^\d+ Landed$/ }));
await narrate(`${AGENTS.length} changes landed in four batches. Alice and Bob never had to coordinate.`);
await hands.click(codeTab);
await hold(END_MS);

const timelinePath = await capture.stop();
const exitCode = await harnessExit;
await context.close();
await browser.close();
if (exitCode !== 0) {
  throw new Error(`HARNESS_FAILED: the harness exited with ${String(exitCode)}.`);
}
console.log(`timeline ${timelinePath}`);
console.log(`transcripts ${TRANSCRIPTS_DIR}`);
console.log('Next: npm run compose -w @commute/demo');

function readingMs(text: string): number {
  return READING_MS_LEAD + text.split(/\s+/).length * READING_MS_PER_WORD;
}

async function hold(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function narrate(text: string): Promise<void> {
  capture.say(text);
  await hold(readingMs(text));
}

type HoverWhileParams = {
  target: Locator;
  text: string;
};

// Shows the caption and rests the cursor on what it describes for its reading time.
async function hoverWhile({ target, text }: HoverWhileParams): Promise<void> {
  capture.say(text);
  await hands.hover({ target, ms: readingMs(text) });
}

// Plays the wait faster in the video.
async function fastUntil<Result>(wait: () => Promise<Result>): Promise<Result> {
  capture.fast(true);
  const result = await wait();
  capture.fast(false);
  return result;
}

type WaitForLinesParams = {
  pattern: RegExp;
  count?: number;
  // Only lines after the first line that matches this pattern count.
  after?: RegExp;
};

// Resolves with the first count harness lines that match. It fails when the harness exits first or the lines are late.
async function waitForLines({ pattern, count = 1, after }: WaitForLinesParams): Promise<RegExpExecArray[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`HARNESS_LINE_LATE: no line matched ${pattern} in time.`)),
      LINE_TIMEOUT_MS
    );
    function finish(result: RegExpExecArray[] | Error): void {
      clearTimeout(timer);
      lineListeners.delete(check);
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    }
    function check(): void {
      const matches = linesAfter(after)
        .map((line) => pattern.exec(line))
        .filter((match) => match !== null);
      if (matches.length >= count) {
        finish(matches.slice(0, count));
        return;
      }
      if (harnessExitCode !== undefined) {
        finish(new Error(`HARNESS_EXITED: the harness exited with ${String(harnessExitCode)} before ${pattern}.`));
      }
    }
    lineListeners.add(check);
    check();
  });
}

function linesAfter(after: RegExp | undefined): string[] {
  if (after === undefined) {
    return lines;
  }
  const afterIndex = lines.findIndex((line) => after.test(line));
  return afterIndex === -1 ? [] : lines.slice(afterIndex + 1);
}

async function nextLine(pattern: RegExp): Promise<RegExpExecArray> {
  const [match] = await waitForLines({ pattern });
  if (match === undefined) {
    throw new Error(`HARNESS_LINE_MISSING: no line matched ${pattern}.`);
  }
  return match;
}

async function changeIdOf(name: string): Promise<string> {
  const [, changeId] = await nextLine(new RegExp(`^${name}\\s+change\\s+(c-\\d+)$`));
  if (changeId === undefined) {
    throw new Error(`NO_CHANGE_ID: the harness printed no change for ${name}.`);
  }
  return changeId;
}

type BatchRequest = {
  batch: number;
  approver: string;
  changeIds: Set<string>;
};

// Waits until the harness asks for the next batch. The harness asks for the batches in order.
async function nextBatchRequest(): Promise<BatchRequest> {
  const batch = batchesRequested + 1;
  const [, approver, ids] = await nextLine(
    new RegExp(`^== waiting for (alice|bob) to approve batch ${batch} in the console: (.+)$`)
  );
  if (approver === undefined || ids === undefined) {
    throw new Error(`INVALID_BATCH_LINE: the approval line of batch ${batch} names no approver or changes.`);
  }
  batchesRequested = batch;
  return { batch, approver, changeIds: new Set(ids.split(', ')) };
}

// On the Changes page, the approver types their name and sets the box of each ready change with a click.
async function chooseBatch(request: BatchRequest): Promise<void> {
  await hands.type({ target: yourName, text: request.approver });
  // The batch box loads after the page. Every ready change starts checked, so the boxes are set only once the whole
  // batch is listed.
  for (const changeId of request.changeIds) {
    await page.locator(`[data-change-id="${changeId}"]`).waitFor();
  }
  for (const box of await page.locator('[data-change-id]').all()) {
    const isInBatch = request.changeIds.has((await box.getAttribute('data-change-id')) ?? '');
    if ((await box.isChecked()) !== isInBatch) {
      await hands.click(box);
    }
  }
  await hold(LOOK_MS);
}

type ApproveParams = {
  request: BatchRequest;
  caption?: string;
};

// A change that becomes ready after the boxes are set starts checked. The exact count fails the take instead of
// approving it.
async function approve({ request, caption }: ApproveParams): Promise<void> {
  await hands.click(
    page.getByRole('button', { name: `Approve ${request.changeIds.size} as ${request.approver}`, exact: true })
  );
  if (caption !== undefined) {
    await narrate(caption);
  }
  await fastUntil(async () => nextLine(new RegExp(`^== batch ${request.batch} landed`)));
  await hold(LOOK_MS);
}

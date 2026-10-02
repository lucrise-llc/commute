#!/usr/bin/env node
// Records the demo video: the console, full screen, while the harness runs 20 agents for two people in the
// background. The recorder does only what a person does: it opens pages, types a name, and approves each batch.
// The narration goes to a subtitle file, so the picture shows only the product.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';

const CONSOLE_URL = process.env['COMMUTE_URL'] ?? 'http://localhost:8787';
const VIEWPORT = { width: 1_600, height: 900 };
const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const HARNESS_PATH = fileURLToPath(new URL('harness.ts', import.meta.url));
const SUBTITLES_PATH = `${RECORDING_DIR}/commute-demo.srt`;
const SECOND_MS = 1_000;
const ID_RADIX = 36;
const AGENT_LINE = /^(alice-\d+|bob-\d+)\s+change\s+(c-\d+)$/;
// The harness prints its steps quickly, but a batch can take minutes to become ready.
const LINE_TIMEOUT_MS = 900_000;
const CHECKS_TIMEOUT_MS = 300_000;
// How long a page stays on screen, in seconds, and how long a subtitle stays at most.
const PAGE_SECONDS = 10;
const BEAT_SECONDS = 14;
const CLICK_SECONDS = 2;
const AFTER_LANDING_SECONDS = 5;
const SUBTITLE_SECONDS_MAX = 9;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const TWO_DIGITS = 2;
const THREE_DIGITS = 3;

type Cue = {
  at: number;
  text: string;
};

const projectId = `demo-${Date.now().toString(ID_RADIX)}`;
const lines: string[] = [];
const lineListeners = new Set<() => void>();
const changeIds = new Map<string, string>();
const cues: Cue[] = [];
let harnessExitCode: number | null | undefined;

await mkdir(RECORDING_DIR, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: RECORDING_DIR, size: VIEWPORT } });
const page = await context.newPage();
const videoStart = Date.now();

const harness = spawn('node', [HARNESS_PATH, '--project', projectId, '--console-approvals'], {
  env: { ...process.env, COMMUTE_URL: CONSOLE_URL },
  stdio: ['ignore', 'pipe', 'inherit']
});
createInterface({ input: harness.stdout }).on('line', (line) => {
  console.log(line);
  lines.push(line);
  const agent = AGENT_LINE.exec(line);
  if (agent?.[1] !== undefined && agent[2] !== undefined) {
    changeIds.set(agent[1], agent[2]);
  }
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
say('Alice and Bob each start 10 coding agents on one repository. Each agent runs commute start, then plain git.');
await nextLine(/^== all 20 agents started/);
say('Commute knows the files of each change before any code is written, and merges every pair that overlaps.');
await hold(PAGE_SECONDS);
await show(`/p/${projectId}/tree/trunk/src`);
say('The code view is trunk at its last landing. Each folder lists the changes in flight that touch it.');
await hold(PAGE_SECONDS);

const alice3 = changeIdOf('alice-3');
const bob2 = changeIdOf('bob-2');
await nextLine(new RegExp(`^bob-2\\s+${bob2} resolve `));
await show(`/p/${projectId}/changes/${bob2}`);
say(`Alice's ${alice3} and Bob's ${bob2} add a page at the same line. Commute found the conflict at Bob's first push.`);
await hold(BEAT_SECONDS);
await show(`/p/${projectId}/overlaps/${bob2}/${alice3}`);
say(
  'It resolved the conflict by choosing lines that both changes wrote, with both intents in mind. It wrote no new line.'
);
await hold(BEAT_SECONDS);

await approveInConsole({
  batch: 1,
  text: 'Bob approves one batch of 16 changes from both people. The two changes that wait for an earlier one stay out.'
});
say('The batch lands in parallel. The changes still in flight move onto the new trunk.');
await hold(PAGE_SECONDS);
await approveInConsole({ batch: 2, text: `Alice lands ${alice3} on its own.` });
await show(`/p/${projectId}/changes/${bob2}`);
await nextLine(new RegExp(`^bob-2\\s+${bob2} restack .+ with Commute's resolution`));
say(`${bob2} moves onto the new trunk with the stored resolution: no second model call, and neither person acts.`);
await hold(BEAT_SECONDS);
await show(`/p/${projectId}/changes/${bob2}?tab=checks`);
// The routes check runs on the resolved content while the others keep their results.
await page.getByText('ran for this content', { exact: true }).waitFor({ timeout: CHECKS_TIMEOUT_MS });
say(
  'Only the routes check runs again. The other checks keep their results, because the folders they read did not change.'
);
await hold(PAGE_SECONDS);
await show(`/p/${projectId}/changes/${bob2}?tab=files`);
say('The diff keeps both pages.');
await hold(PAGE_SECONDS);

await approveInConsole({ batch: 3, text: 'Bob approves the next batch, with a change from each person.' });
await approveInConsole({
  batch: 4,
  text: "Alice's gift wrap change lands last. Commute resolved its conflict with her discount the same way."
});
await nextLine(/^checks /);
await show(`/p/${projectId}/changes?state=landed`);
await page
  .getByText(/ · landed · /)
  .first()
  .waitFor();
say(
  'All 20 changes landed in four batches. Commute resolved both conflicts, and Alice and Bob never messaged each other.'
);
await hold(BEAT_SECONDS);
await show(`/p/${projectId}`);
say('Commute: changes that commute land in any order.');
await hold(PAGE_SECONDS);

await harnessExit;
const video = page.video();
await context.close();
await browser.close();
await writeFile(SUBTITLES_PATH, subtitles());
console.log(`video ${await video?.path()}`);
console.log(`subtitles ${SUBTITLES_PATH}`);

function say(text: string): void {
  cues.push({ at: Date.now() - videoStart, text });
}

async function hold(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * SECOND_MS));
}

async function show(path: string): Promise<void> {
  await page.goto(`${CONSOLE_URL}${path}`);
  await page.locator('main').waitFor();
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
  await show(`/p/${projectId}/changes`);
  say(text);
  // fill sets the whole value at once; typing key by key loses keys while live events re-render the page.
  await page.getByLabel('Your name', { exact: true }).fill(approver);
  // The batch box loads after the page. Every ready change starts checked, so the boxes are set only once the whole
  // batch is listed. Each box is the element with role checkbox that carries the change ID.
  for (const changeId of batchIds) {
    await page.locator(`[data-change-id="${changeId}"]`).waitFor();
  }
  for (const box of await page.locator('[data-change-id]').all()) {
    await box.setChecked(batchIds.has((await box.getAttribute('data-change-id')) ?? ''));
  }
  await hold(CLICK_SECONDS);
  // A change that becomes ready after the boxes are set starts checked. The exact count fails the take instead of
  // approving it.
  await page.getByRole('button', { name: `Approve ${batchIds.size} as ${approver}`, exact: true }).click();
  await nextLine(new RegExp(`^== batch ${batch} landed`));
  await hold(AFTER_LANDING_SECONDS);
}

// SubRip subtitles: each cue shows until the next one starts, for at most SUBTITLE_SECONDS_MAX.
function subtitles(): string {
  return cues
    .map((cue, index) => {
      const next = cues[index + 1]?.at ?? cue.at + SUBTITLE_SECONDS_MAX * SECOND_MS;
      const end = Math.min(next, cue.at + SUBTITLE_SECONDS_MAX * SECOND_MS);
      return `${index + 1}\n${timestamp(cue.at)} --> ${timestamp(end)}\n${cue.text}\n`;
    })
    .join('\n');
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function timestamp(ms: number): string {
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / SECOND_MS);
  return `${pad(hours, TWO_DIGITS)}:${pad(minutes, TWO_DIGITS)}:${pad(seconds, TWO_DIGITS)},${pad(ms % SECOND_MS, THREE_DIGITS)}`;
}

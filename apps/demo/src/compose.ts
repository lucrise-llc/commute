#!/usr/bin/env node
// Composes the walkthrough video from a recorded take: the title and why cards, a replay of one agent's terminal, the
// console segments with a chapter card before each, and the outro cards. Run it after `npm run record`.
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';

import type { Card } from './graphics.ts';
import type { ConsoleSegment } from './segments.ts';
import type { FrameEntry, Overlay } from './clips.ts';

import { transcriptSchema } from './transcript.ts';
import { FAST_SPEED, planSegments } from './segments.ts';
import { TIMELINE_FILE, timelineSchema } from './capture.ts';
import { planReplay, renderReplay } from './terminal-replay.ts';
import { encodeFramesClip, encodeStillClip, joinClips } from './clips.ts';
import { TERMINAL_AGENT, TERMINAL_CUES, TERMINAL_INTRO, WHY_CARDS } from './story.ts';
import {
  BADGE_WIDTH,
  badgeHtml,
  captionHtml,
  cardHtml,
  renderGraphic,
  STRIP_HEIGHT,
  VIDEO_HEIGHT,
  VIDEO_WIDTH
} from './graphics.ts';

const DEFAULT_RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const TRANSCRIPTS_DIR = 'transcripts';
const WORK_DIR = 'compose';
const OUTPUT_FILE = 'commute-demo.mp4';
// GitHub accepts video attachments of up to 10 MB on this organization's plan.
const OUTPUT_BYTES_MAX = 10_000_000;
// x264 CRF of the final encode. 28 keeps the console text sharp; a take with long fast waits may need a higher one.
const DEFAULT_CRF = '28';
const CRF_MIN = 18;
const CRF_MAX = 40;
const VIDEO_MS_MAX = 600_000;
const TITLE_MS = 5_000;
const WHY_MS_MIN = 6_000;
const WHY_MS_LEAD = 1_000;
const WHY_MS_PER_WORD = 250;
const CHAPTER_MS = 3_000;
const ARCHITECTURE_MS = 8_000;
const CLOSING_MS = 5_000;
const CLIP_NAME_DIGITS = 3;
const MS_PER_SECOND = 1_000;
const BYTES_PER_MB = 1_000_000;
const SIZE_DIGITS = 2;
const VIDEO_SIZE = { width: VIDEO_WIDTH, height: VIDEO_HEIGHT };
const STRIP_SIZE = { width: VIDEO_WIDTH, height: STRIP_HEIGHT };
const STRIP_TOP = VIDEO_HEIGHT - STRIP_HEIGHT;

const { values } = parseArgs({
  options: {
    recording: { type: 'string', default: DEFAULT_RECORDING_DIR },
    agent: { type: 'string', default: TERMINAL_AGENT },
    crf: { type: 'string', default: DEFAULT_CRF }
  }
});
const crf = Number(values.crf);
if (!Number.isInteger(crf) || crf < CRF_MIN || crf > CRF_MAX) {
  throw new Error(`INVALID_CRF: --crf is a whole number from ${CRF_MIN} to ${CRF_MAX}.`);
}
const recordingDir = values.recording;
const workDir = join(recordingDir, WORK_DIR);
const output = join(recordingDir, OUTPUT_FILE);

const timeline = timelineSchema.parse(JSON.parse(await readFile(join(recordingDir, TIMELINE_FILE), 'utf8')));
const transcript = transcriptSchema.parse(
  JSON.parse(await readFile(join(recordingDir, TRANSCRIPTS_DIR, `${values.agent}.json`), 'utf8'))
);
const segments = planSegments({ timeline, recordingDir });
const replay = planReplay({ transcript, intro: TERMINAL_INTRO, cues: TERMINAL_CUES });

await rm(workDir, { recursive: true, force: true });
await mkdir(join(workDir, 'terminal'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const clips: string[] = [];
let videoMs = 0;

await addCard({ card: { kind: 'title' }, durationMs: TITLE_MS });
for (const [index, text] of WHY_CARDS.entries()) {
  await addCard({
    card: { kind: 'why', text, position: `${index + 1} / ${WHY_CARDS.length}` },
    durationMs: Math.max(WHY_MS_MIN, WHY_MS_LEAD + text.split(/\s+/).length * WHY_MS_PER_WORD)
  });
}
await addFrames({
  frames: await renderReplay({ browser, plan: replay, title: transcript.agent, framesDir: join(workDir, 'terminal') }),
  overlays: []
});
const badge = join(workDir, 'badge.png');
await renderGraphic({
  page,
  html: badgeHtml(`${FAST_SPEED}×`),
  path: badge,
  size: { width: BADGE_WIDTH, height: STRIP_HEIGHT },
  isTransparent: true
});
for (const segment of segments) {
  await addConsoleSegment(segment);
}
await addCard({ card: { kind: 'architecture' }, durationMs: ARCHITECTURE_MS });
await addCard({ card: { kind: 'closing' }, durationMs: CLOSING_MS });
await browser.close();

if (videoMs > VIDEO_MS_MAX) {
  throw new Error(`VIDEO_TOO_LONG: the video takes ${Math.round(videoMs)} ms, more than ${VIDEO_MS_MAX}.`);
}
await joinClips({ clips, listPath: join(workDir, 'clips.ffconcat'), output, crf });
const { size } = await stat(output);
const report = `${output}: ${(size / BYTES_PER_MB).toFixed(SIZE_DIGITS)} MB, ${(videoMs / MS_PER_SECOND).toFixed(1)} s, CRF ${crf}`;
if (size > OUTPUT_BYTES_MAX) {
  throw new Error(
    `VIDEO_TOO_LARGE: ${report}. GitHub accepts at most ${OUTPUT_BYTES_MAX / BYTES_PER_MB} MB; run compose again with a higher --crf.`
  );
}
console.log(`video ${report}`);

function nextClipPath(): string {
  return join(workDir, `clip-${String(clips.length).padStart(CLIP_NAME_DIGITS, '0')}`);
}

type AddCardParams = {
  card: Card;
  durationMs: number;
};

async function addCard({ card, durationMs }: AddCardParams): Promise<void> {
  const path = nextClipPath();
  await renderGraphic({ page, html: cardHtml(card), path: `${path}.png`, size: VIDEO_SIZE });
  await encodeStillClip({ image: `${path}.png`, durationMs, output: `${path}.mp4` });
  clips.push(`${path}.mp4`);
  videoMs += durationMs;
}

type AddFramesParams = {
  frames: FrameEntry[];
  overlays: Overlay[];
};

async function addFrames({ frames, overlays }: AddFramesParams): Promise<void> {
  const path = nextClipPath();
  await encodeFramesClip({ frames, overlays, listPath: `${path}.ffconcat`, output: `${path}.mp4` });
  clips.push(`${path}.mp4`);
  for (const frame of frames) {
    videoMs += frame.durationMs;
  }
}

// The chapter card, then the console over the caption strip. The speed badge shows at the right end of the strip.
async function addConsoleSegment(segment: ConsoleSegment): Promise<void> {
  if (segment.chapter !== null) {
    await addCard({ card: { kind: 'chapter', title: segment.chapter }, durationMs: CHAPTER_MS });
  }
  if (segment.frames.length === 0) {
    return;
  }
  const path = nextClipPath();
  const overlays: Overlay[] = [];
  for (const [index, caption] of segment.captions.entries()) {
    const image = `${path}-caption-${index}.png`;
    await renderGraphic({ page, html: captionHtml(caption.text), path: image, size: STRIP_SIZE });
    overlays.push({ image, left: 0, top: STRIP_TOP, windows: [caption] });
  }
  if (segment.fastWindows.length > 0) {
    overlays.push({ image: badge, left: VIDEO_WIDTH - BADGE_WIDTH, top: STRIP_TOP, windows: segment.fastWindows });
  }
  await addFrames({ frames: segment.frames, overlays });
}

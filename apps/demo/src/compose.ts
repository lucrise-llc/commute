#!/usr/bin/env node
// Composes the walkthrough video from a recorded take, animated explanation, and terminal replay.
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';

import type { Scene } from './animated-scenes.ts';
import type { ConsoleSegment } from './segments.ts';
import type { FrameEntry, Overlay } from './clips.ts';

import { transcriptSchema } from './transcript.ts';
import { FAST_SPEED, planSegments } from './segments.ts';
import { TIMELINE_FILE, timelineSchema } from './capture.ts';
import { planReplay, renderReplay } from './terminal-replay.ts';
import { CONSOLE_BAR, encodeFramesClip, joinClips } from './clips.ts';
import { CHAPTER_SCENES, CLOSING_SCENES, OPENING_SCENES, renderScenes } from './animated-scenes.ts';
import { AGENT_OUTRO_CUES, AGENT_OUTRO_INTRO, TERMINAL_AGENT, TERMINAL_CUES, TERMINAL_INTRO } from './story.ts';
import {
  BADGE_WIDTH,
  badgeHtml,
  captionHtml,
  renderGraphic,
  STRIP_HEIGHT,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  windowBarHtml
} from './graphics.ts';

const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const TRANSCRIPTS_DIR = 'transcripts';
const WORK_DIR = 'compose';
const OUTPUT_FILE = 'commute-demo.mp4';
const GITHUB_OUTPUT_FILE = 'commute-demo-github.mp4';
// GitHub accepts video attachments of up to 10 MB on this organization's plan.
const GITHUB_BYTES_MAX = 10_000_000;
const UPLOAD_BYTES_MAX = 2_000_000_000;
// x264 CRF of the final encode. 28 keeps the console text sharp; a take with long fast waits may need a higher one.
const DEFAULT_CRF = '28';
const UPLOAD_CRF = 18;
const CRF_MIN = 18;
const CRF_MAX = 40;
const GITHUB_CRF_STEP = 2;
const UPLOAD_FPS = 60;
const GITHUB_FPS = 30;
// The submission asks for a demo video of 5 to 10 minutes (PRD.md).
const VIDEO_MS_MIN = 300_000;
const VIDEO_MS_MAX = 600_000;
const CLIP_NAME_DIGITS = 3;
const MS_PER_SECOND = 1_000;
const BYTES_PER_MB = 1_000_000;
const SIZE_DIGITS = 2;
const STRIP_SIZE = { width: VIDEO_WIDTH, height: STRIP_HEIGHT };
const STRIP_TOP = VIDEO_HEIGHT - STRIP_HEIGHT;

const { values } = parseArgs({
  options: {
    crf: { type: 'string', default: DEFAULT_CRF }
  }
});
const crf = Number(values.crf);
if (!Number.isInteger(crf) || crf < CRF_MIN || crf > CRF_MAX) {
  throw new Error(`INVALID_CRF: --crf is a whole number from ${CRF_MIN} to ${CRF_MAX}.`);
}
const recordingDir = RECORDING_DIR;
const workDir = join(recordingDir, WORK_DIR);
const output = join(recordingDir, OUTPUT_FILE);
const githubOutput = join(recordingDir, GITHUB_OUTPUT_FILE);

const timeline = timelineSchema.parse(JSON.parse(await readFile(join(recordingDir, TIMELINE_FILE), 'utf8')));
const transcript = transcriptSchema.parse(
  JSON.parse(await readFile(join(recordingDir, TRANSCRIPTS_DIR, `${TERMINAL_AGENT}.json`), 'utf8'))
);
const segments = planSegments({ timeline, recordingDir });
const replay = planReplay({ transcript, intro: TERMINAL_INTRO, cues: TERMINAL_CUES });
const outroReplay = planReplay({
  transcript,
  intro: AGENT_OUTRO_INTRO,
  cues: AGENT_OUTRO_CUES,
  fromCommand: replay.lastCommand + 1
});

await rm(workDir, { recursive: true, force: true });
await mkdir(join(workDir, 'terminal'), { recursive: true });
await mkdir(join(workDir, 'terminal-outro'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const clips: string[] = [];
let videoMs = 0;

await addAnimated({ scenes: OPENING_SCENES });
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
const windowBar = join(workDir, 'window-bar.png');
await renderGraphic({
  page,
  html: windowBarHtml('Commute'),
  path: windowBar,
  size: { width: CONSOLE_BAR.width, height: CONSOLE_BAR.height }
});
for (const segment of segments) {
  await addConsoleSegment({ segment });
}
await addAnimated({ scenes: [chapterScene("What Bob's agent saw")] });
await addFrames({
  frames: await renderReplay({
    browser,
    plan: outroReplay,
    title: transcript.agent,
    framesDir: join(workDir, 'terminal-outro')
  }),
  overlays: []
});
await addAnimated({ scenes: CLOSING_SCENES });
await browser.close();

if (videoMs < VIDEO_MS_MIN || videoMs > VIDEO_MS_MAX) {
  throw new Error(
    `VIDEO_LENGTH_OUT_OF_RANGE: the video takes ${Math.round(videoMs)} ms; the submission asks for ${VIDEO_MS_MIN} to ${VIDEO_MS_MAX}.`
  );
}
const clipsListPath = join(workDir, 'clips.ffconcat');
await joinClips({ clips, listPath: clipsListPath, output, crf: UPLOAD_CRF, durationMs: videoMs, isGithub: false });
const uploadSize = (await stat(output)).size;
const uploadReport = report({ path: output, size: uploadSize, videoMs, fps: UPLOAD_FPS, crf: UPLOAD_CRF });
if (uploadSize > UPLOAD_BYTES_MAX) {
  throw new Error(
    `VIDEO_TOO_LARGE: ${uploadReport}. The upload accepts at most ${UPLOAD_BYTES_MAX / BYTES_PER_MB} MB.`
  );
}
console.log(`video ${uploadReport}`);
let githubCrf = crf;
let githubSize = 0;
while (true) {
  await joinClips({
    clips,
    listPath: clipsListPath,
    output: githubOutput,
    crf: githubCrf,
    durationMs: videoMs,
    isGithub: true
  });
  githubSize = (await stat(githubOutput)).size;
  if (githubSize <= GITHUB_BYTES_MAX || githubCrf === CRF_MAX) {
    break;
  }
  githubCrf = Math.min(CRF_MAX, githubCrf + GITHUB_CRF_STEP);
}
const githubReport = report({ path: githubOutput, size: githubSize, videoMs, fps: GITHUB_FPS, crf: githubCrf });
if (githubSize > GITHUB_BYTES_MAX) {
  throw new Error(`VIDEO_TOO_LARGE: ${githubReport}. GitHub accepts at most ${GITHUB_BYTES_MAX / BYTES_PER_MB} MB.`);
}
console.log(`video ${githubReport}`);

type ReportParams = {
  path: string;
  size: number;
  videoMs: number;
  fps: number;
  crf: number;
};

function report({ path, size, videoMs: durationMs, fps, crf: encodeCrf }: ReportParams): string {
  return `${path}: ${(size / BYTES_PER_MB).toFixed(SIZE_DIGITS)} MB, ${(durationMs / MS_PER_SECOND).toFixed(1)} s, ${fps} fps, CRF ${encodeCrf}`;
}

function nextClipPath(): string {
  return join(workDir, `clip-${String(clips.length).padStart(CLIP_NAME_DIGITS, '0')}`);
}

type AddAnimatedParams = {
  scenes: Scene[];
};

async function addAnimated({ scenes }: AddAnimatedParams): Promise<void> {
  const path = nextClipPath();
  const frames = await renderScenes({
    page,
    scenes,
    framesDir: `${path}-frames`,
    reviewDir: join(recordingDir, 'review')
  });
  await addFrames({ frames, overlays: [] });
}

function chapterScene(title: string): Scene {
  const scene = CHAPTER_SCENES[title];
  if (scene === undefined) {
    throw new Error(`UNKNOWN_CHAPTER: ${title}`);
  }
  return scene;
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

// An animated chapter precedes the console segment. The speed badge shows at the right end of the strip.
type AddConsoleSegmentParams = {
  segment: ConsoleSegment;
};

async function addConsoleSegment({ segment }: AddConsoleSegmentParams): Promise<void> {
  if (segment.chapter !== null) {
    await addAnimated({ scenes: [chapterScene(segment.chapter)] });
  }
  if (segment.frames.length === 0) {
    return;
  }
  const path = nextClipPath();
  let segmentMs = 0;
  for (const frame of segment.frames) {
    segmentMs += frame.durationMs;
  }
  const overlays: Overlay[] = [
    { image: windowBar, left: CONSOLE_BAR.left, top: CONSOLE_BAR.top, windows: [{ startMs: 0, endMs: segmentMs }] }
  ];
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

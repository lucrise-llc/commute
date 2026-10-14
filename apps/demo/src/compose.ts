#!/usr/bin/env node
// Composes the walkthrough video from a recorded take, animated explanation, the agents' sessions, and the voiceover.
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';

import type { Scene } from './animated-scenes.ts';
import type { ConsoleSegment } from './segments.ts';
import type { FrameEntry, Overlay, Window } from './clips.ts';
import type { Session, SessionsPlan } from './agent-sessions.ts';

import { AGENTS } from './agents.ts';
import { transcriptSchema } from './transcript.ts';
import { FAST_SPEED, planSegments } from './segments.ts';
import { TIMELINE_FILE, timelineSchema } from './capture.ts';
import { planSessions, renderSessions } from './agent-sessions.ts';
import { readVoiceIndex, VOICE_DIR, VOICE_LEAD_MS, voiceHoldMs } from './voice-clips.ts';
import { CHAPTER_SCENES, CLOSING_SCENES, OPENING_SCENES, renderScenes } from './animated-scenes.ts';
import {
  FRAME_MS,
  CONSOLE_BAR,
  encodeFramesClip,
  joinClips,
  buildVoiceTrack,
  LOUDNESS_TARGET,
  measureLoudness
} from './clips.ts';
import {
  AGENTS_CHAPTER,
  SESSION_AGENTS,
  SESSIONS_CUES,
  SESSIONS_INTRO,
  SESSIONS_OUTRO_CUES,
  SESSIONS_OUTRO_INTRO
} from './story.ts';
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
const VOICE_TRACK_FILE = 'voice.wav';
// The delivered audio stays within this many LU of the loudness target, and its true peak stays at or under -1 dBTP.
const LOUDNESS_TOLERANCE_LU = 1;
const TRUE_PEAK_MAX_DB = -1;

// A caption's window, in the time of the clip that shows it.
type CaptionWindow = Window & {
  text: string;
};

type VoicePlacement = {
  file: string;
  startMs: number;
};

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
const sessions: Session[] = [];
for (const name of SESSION_AGENTS) {
  const agent = AGENTS.find((candidate) => candidate.name === name);
  if (agent === undefined) {
    throw new Error(`UNKNOWN_AGENT: ${name} is not a demo agent.`);
  }
  const transcript = transcriptSchema.parse(
    JSON.parse(await readFile(join(recordingDir, TRANSCRIPTS_DIR, `${name}.json`), 'utf8'))
  );
  sessions.push({ owner: agent.owner, intent: agent.intent, edit: agent.edit, transcript });
}
const voiceIndex = await readVoiceIndex(recordingDir);
const voiceMsByText = new Map(Object.entries(voiceIndex).map(([text, clip]) => [text, clip.durationMs]));
const segments = planSegments({ timeline, recordingDir }).map((segment) => holdLastCaption(segment));
const sessionsPlan = planSessions({ sessions, intro: SESSIONS_INTRO, cues: SESSIONS_CUES, voiceMsByText });
const sessionsOutroPlan = planSessions({
  sessions,
  intro: SESSIONS_OUTRO_INTRO,
  cues: SESSIONS_OUTRO_CUES,
  voiceMsByText,
  fromHarnessMs: sessionsPlan.endHarnessMs
});
checkVoice([
  ...sceneWindows(OPENING_SCENES),
  ...sessionWindows(sessionsPlan),
  ...segments.flatMap((segment) => [
    ...(segment.chapter === null ? [] : sceneWindows([chapterScene(segment.chapter)])),
    ...segment.captions
  ]),
  ...sceneWindows([chapterScene(AGENTS_CHAPTER)]),
  ...sessionWindows(sessionsOutroPlan),
  ...sceneWindows(CLOSING_SCENES)
]);

await rm(workDir, { recursive: true, force: true });
await mkdir(join(workDir, 'sessions'), { recursive: true });
await mkdir(join(workDir, 'sessions-outro'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const clips: string[] = [];
const voicePlacements: VoicePlacement[] = [];
let videoMs = 0;

await addAnimated({ scenes: OPENING_SCENES });
await addFrames({
  frames: await renderSessions({ browser, plan: sessionsPlan, framesDir: join(workDir, 'sessions') }),
  overlays: [],
  captions: sessionWindows(sessionsPlan)
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
await addAnimated({ scenes: [chapterScene(AGENTS_CHAPTER)] });
await addFrames({
  frames: await renderSessions({ browser, plan: sessionsOutroPlan, framesDir: join(workDir, 'sessions-outro') }),
  overlays: [],
  captions: sessionWindows(sessionsOutroPlan)
});
await addAnimated({ scenes: CLOSING_SCENES });
await browser.close();

if (videoMs < VIDEO_MS_MIN || videoMs > VIDEO_MS_MAX) {
  throw new Error(
    `VIDEO_LENGTH_OUT_OF_RANGE: the video takes ${Math.round(videoMs)} ms; the submission asks for ${VIDEO_MS_MIN} to ${VIDEO_MS_MAX}.`
  );
}
const voiceTrack = join(workDir, VOICE_TRACK_FILE);
await buildVoiceTrack({ placements: voicePlacements, durationMs: videoMs, output: voiceTrack });
const clipsListPath = join(workDir, 'clips.ffconcat');
await joinClips({
  clips,
  listPath: clipsListPath,
  audio: voiceTrack,
  output,
  crf: UPLOAD_CRF,
  durationMs: videoMs,
  isGithub: false
});
await checkLoudness(output);
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
    audio: voiceTrack,
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
await checkLoudness(githubOutput);
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
  await addFrames({ frames, overlays: [], captions: sceneWindows(scenes) });
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
  captions: CaptionWindow[];
};

// Adds a clip to the video, and places the voice clip of each of its captions.
async function addFrames({ frames, overlays, captions }: AddFramesParams): Promise<void> {
  const path = nextClipPath();
  await encodeFramesClip({ frames, overlays, listPath: `${path}.ffconcat`, output: `${path}.mp4` });
  clips.push(`${path}.mp4`);
  for (const caption of captions) {
    voicePlacements.push({ file: voiceFile(caption.text), startMs: videoMs + caption.startMs + VOICE_LEAD_MS });
  }
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
  await addFrames({ frames: segment.frames, overlays, captions: segment.captions });
}

// The last caption of a console segment may need longer than the segment has left for its voice clip. The segment then
// holds its last frame until the clip ends.
function holdLastCaption(segment: ConsoleSegment): ConsoleSegment {
  const lastCaption = segment.captions.at(-1);
  const lastFrame = segment.frames.at(-1);
  const clipMs = voiceMsByText.get(lastCaption?.text ?? '');
  if (lastCaption === undefined || lastFrame === undefined || clipMs === undefined) {
    return segment;
  }
  const shortMs = voiceHoldMs(clipMs) - (lastCaption.endMs - lastCaption.startMs);
  if (shortMs <= 0) {
    return segment;
  }
  const holdMs = Math.ceil(shortMs / FRAME_MS) * FRAME_MS;
  return {
    ...segment,
    frames: [...segment.frames.slice(0, -1), { ...lastFrame, durationMs: lastFrame.durationMs + holdMs }],
    captions: [...segment.captions.slice(0, -1), { ...lastCaption, endMs: lastCaption.endMs + holdMs }]
  };
}

// The caption windows of animated scenes, one after another.
function sceneWindows(scenes: Scene[]): CaptionWindow[] {
  const windows: CaptionWindow[] = [];
  let startMs = 0;
  for (const scene of scenes) {
    for (const cue of scene.cues) {
      windows.push({ text: cue.text, startMs, endMs: startMs + cue.durationMs });
      startMs += cue.durationMs;
    }
  }
  return windows;
}

// Each caption of a sessions replay shows until the next one, and the last one until the replay ends.
function sessionWindows(plan: SessionsPlan): CaptionWindow[] {
  return plan.captions.map((caption, index) => ({
    text: caption.text,
    startMs: caption.videoMs,
    endMs: plan.captions[index + 1]?.videoMs ?? plan.frameCount * FRAME_MS
  }));
}

function voiceFile(text: string): string {
  const clip = voiceIndex[text];
  if (clip === undefined) {
    throw new Error(`VOICE_CLIP_MISSING: run npm run voice -w @commute/demo for "${text}".`);
  }
  return join(recordingDir, VOICE_DIR, clip.file);
}

// Every caption needs a clip that fits its window. All failures show at once, before the render starts.
function checkVoice(windows: CaptionWindow[]): void {
  const failures: string[] = [];
  for (const window of windows) {
    const clipMs = voiceMsByText.get(window.text);
    if (clipMs === undefined) {
      failures.push(`no clip: "${window.text}"`);
      continue;
    }
    const neededMs = voiceHoldMs(clipMs);
    const windowMs = window.endMs - window.startMs;
    if (neededMs > windowMs) {
      failures.push(`${Math.round(neededMs)} ms of voice in ${Math.round(windowMs)} ms: "${window.text}"`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`VOICE_DOES_NOT_FIT:\n${failures.join('\n')}`);
  }
}

// The delivered audio stays near the loudness target after the AAC encode.
async function checkLoudness(path: string): Promise<void> {
  const measured = await measureLoudness(path);
  const integratedOff = Math.abs(measured.input_i - LOUDNESS_TARGET.integrated);
  if (integratedOff > LOUDNESS_TOLERANCE_LU || measured.input_tp > TRUE_PEAK_MAX_DB) {
    throw new Error(`LOUDNESS_OFF_TARGET: ${path} measures ${measured.input_i} LUFS and ${measured.input_tp} dBTP.`);
  }
  console.log(`audio ${path}: ${measured.input_i} LUFS, ${measured.input_tp} dBTP`);
}

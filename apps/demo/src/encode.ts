#!/usr/bin/env node
// Encodes a recorded take for a pull request or the README. The console stays on top, and the narration shows in a
// strip below it, because a browser player ignores a subtitle track. ffmpeg needs no text renderer: Playwright draws
// each caption as an image, and ffmpeg overlays the image for the time of its cue.
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';

const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
const SUBTITLES_PATH = `${RECORDING_DIR}/commute-demo.srt`;
const CAPTIONS_DIR = `${RECORDING_DIR}/captions`;
const OUTPUT_PATH = `${RECORDING_DIR}/commute-demo.mp4`;
const VIDEO_WIDTH = 1_600;
const VIDEO_HEIGHT = 900;
const STRIP_HEIGHT = 96;
const STRIP_COLOR = '#111111';
const CUES_MAX = 50;
// GitHub accepts videos up to 10 MB as attachments on every plan.
const OUTPUT_BYTES_MAX = 10_000_000;
const QUALITY_CRF = '32';
const CUE_PATTERN = /^\d+\n(?<start>\d{2}:\d{2}:\d{2},\d{3}) --> (?<end>\d{2}:\d{2}:\d{2},\d{3})\n(?<text>.+)$/;
const TIMESTAMP_PATTERN = /^(?<hours>\d{2}):(?<minutes>\d{2}):(?<seconds>\d{2}),(?<milliseconds>\d{3})$/;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;

type Cue = {
  start: number;
  end: number;
  text: string;
};

const [videoPath] = parseArgs({ allowPositionals: true }).positionals;
if (videoPath === undefined) {
  throw new Error('Usage: npm run encode -w @commute/demo -- <recorded .webm>');
}

const cues = parseSubtitles(await readFile(SUBTITLES_PATH, 'utf8'));
await mkdir(CAPTIONS_DIR, { recursive: true });
const captionPaths = await drawCaptions(cues);

const overlays = cues.map((cue, index) => {
  const input = index === 0 ? '[padded]' : `[step${index}]`;
  const output = index === cues.length - 1 ? '[out]' : `[step${index + 1}]`;
  return `${input}[${index + 1}:v]overlay=0:${VIDEO_HEIGHT}:enable='between(t,${cue.start},${cue.end})'${output}`;
});
const filter = [
  `[0:v]pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT + STRIP_HEIGHT}:0:0:color=${STRIP_COLOR}[padded]`,
  ...overlays
].join(';');
await run({
  command: 'ffmpeg',
  args: [
    '-v',
    'error',
    '-y',
    '-i',
    videoPath,
    ...captionPaths.flatMap((path) => ['-i', path]),
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-c:v',
    'libx264',
    '-crf',
    QUALITY_CRF,
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    OUTPUT_PATH
  ]
});
const { size } = await stat(OUTPUT_PATH);
if (size > OUTPUT_BYTES_MAX) {
  throw new Error(`VIDEO_TOO_LARGE: ${OUTPUT_PATH} has ${size} bytes, more than ${OUTPUT_BYTES_MAX}.`);
}
console.log(`video ${OUTPUT_PATH} (${size} bytes)`);

function parseSubtitles(srt: string): Cue[] {
  const blocks = srt.trim().split('\n\n');
  if (blocks.length > CUES_MAX) {
    throw new Error(`TOO_MANY_CUES: ${blocks.length} cues, more than ${CUES_MAX}.`);
  }
  return blocks.map((block) => {
    const groups = CUE_PATTERN.exec(block)?.groups;
    if (groups?.['start'] === undefined || groups['end'] === undefined || groups['text'] === undefined) {
      throw new Error(`INVALID_CUE: ${block}`);
    }
    return { start: seconds(groups['start']), end: seconds(groups['end']), text: groups['text'] };
  });
}

function seconds(timestamp: string): number {
  const groups = TIMESTAMP_PATTERN.exec(timestamp)?.groups;
  if (groups === undefined) {
    throw new Error(`INVALID_TIMESTAMP: ${timestamp}`);
  }
  return (
    Number(groups['hours']) * SECONDS_PER_HOUR +
    Number(groups['minutes']) * SECONDS_PER_MINUTE +
    Number(groups['seconds']) +
    Number(groups['milliseconds']) / MS_PER_SECOND
  );
}

async function drawCaptions(captions: Cue[]): Promise<string[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VIDEO_WIDTH, height: STRIP_HEIGHT } });
  const paths: string[] = [];
  for (const [index, cue] of captions.entries()) {
    await page.setContent(captionHtml(cue.text));
    const path = `${CAPTIONS_DIR}/cue-${index + 1}.png`;
    await page.screenshot({ path });
    paths.push(path);
  }
  await browser.close();
  return paths;
}

function captionHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return `<body style="margin:0;height:${STRIP_HEIGHT}px;display:flex;align-items:center;justify-content:center;background:${STRIP_COLOR};color:#f0f0f0;font:500 26px/1.3 -apple-system,'Segoe UI',sans-serif;text-align:center;padding:0 48px;box-sizing:border-box">${escaped}</body>`;
}

type RunParams = {
  command: string;
  args: string[];
};

async function run({ command, args }: RunParams): Promise<void> {
  const child = spawn(command, args, { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (code !== 0) {
    throw new Error(`${command} exited with ${String(code)}.`);
  }
}

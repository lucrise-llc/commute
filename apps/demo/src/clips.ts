// ffmpeg steps of compose. Each part of the video becomes a lossless clip of the same size and frame rate, and the
// last step joins the clips and encodes the video once.
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

import { STRIP_BACKGROUND, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

const runFile = promisify(execFile);
const VIDEO_FPS = 30;
const MS_PER_SECOND = 1_000;
export const FRAME_MS = MS_PER_SECOND / VIDEO_FPS;
export const FADE_MS = 300;
const FADE_SECONDS = FADE_MS / MS_PER_SECOND;
const KEYFRAME_SECONDS = 10;
const DURATION_DIGITS = 6;
const FFMPEG_OUTPUT_BYTES_MAX = 10_000_000;
// Every clip is BT.709 with the limited range. Screencast frames are JPEG, which is BT.601 with the full range, and
// the cards are RGB, so each clip converts once at its end, and the joined clips agree.
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const TO_VIDEO_COLOR = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
// Lossless clips, so that the final encode is the only lossy step.
const CLIP_CODEC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...COLOR_TAGS, '-an'];

// One picture of a clip and how long it shows in the video.
export type FrameEntry = {
  file: string;
  durationMs: number;
};

// A time range of a clip, in milliseconds from the start of the clip.
export type Window = {
  startMs: number;
  endMs: number;
};

// A still image laid over a clip during its windows. left and top are in video pixels.
export type Overlay = {
  image: string;
  left: number;
  top: number;
  windows: Window[];
};

type FramesClipParams = {
  frames: FrameEntry[];
  overlays: Overlay[];
  listPath: string;
  output: string;
};

// Plays the frames for their durations at a constant frame rate. A frame narrower than the video is scaled to its
// width and placed at the top, over the strip color, so that the console sits above the caption strip. The layers
// mix in RGB.
export async function encodeFramesClip({ frames, overlays, listPath, output }: FramesClipParams): Promise<void> {
  const last = frames.at(-1);
  if (last === undefined) {
    throw new Error(`EMPTY_CLIP: ${output} has no frames.`);
  }
  // The concat demuxer ignores the duration of the last entry, so the last file is listed once more.
  const entries = frames.map((frame) => `file ${quote(frame.file)}\nduration ${seconds(frame.durationMs)}`);
  await writeFile(listPath, `ffconcat version 1.0\n${entries.join('\n')}\nfile ${quote(last.file)}\n`);
  let durationMs = 0;
  for (const frame of frames) {
    durationMs += frame.durationMs;
  }
  const base = `[0:v]scale=${VIDEO_WIDTH}:-2:flags=lanczos,format=rgb24,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:0:0:color=${STRIP_BACKGROUND},fps=${VIDEO_FPS}[layer0]`;
  const layers = overlays.map((overlay, index) => {
    const enable = overlay.windows
      .map((window) => `between(t,${seconds(window.startMs)},${seconds(window.endMs)})`)
      .join('+');
    return `[layer${index}][${index + 1}:v]overlay=${overlay.left}:${overlay.top}:format=rgb:enable='${enable}'[layer${index + 1}]`;
  });
  const finish = `[layer${overlays.length}]${fades(durationMs)},${TO_VIDEO_COLOR}[out]`;
  await ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    ...overlays.flatMap((overlay) => ['-i', overlay.image]),
    '-filter_complex',
    [base, ...layers, finish].join(';'),
    '-map',
    '[out]',
    '-t',
    seconds(durationMs),
    ...CLIP_CODEC,
    output
  ]);
}

type JoinClipsParams = {
  clips: string[];
  listPath: string;
  output: string;
  crf: number;
};

// The final encode. Screen content is flat color and text that is still most of the time: the animation tune keeps
// text edges sharp at a high CRF, and a long keyframe interval spends the bits on the frames that change.
export async function joinClips({ clips, listPath, output, crf }: JoinClipsParams): Promise<void> {
  await writeFile(listPath, `ffconcat version 1.0\n${clips.map((clip) => `file ${quote(clip)}`).join('\n')}\n`);
  await ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-tune',
    'animation',
    '-crf',
    String(crf),
    '-g',
    String(VIDEO_FPS * KEYFRAME_SECONDS),
    '-pix_fmt',
    'yuv420p',
    ...COLOR_TAGS,
    '-movflags',
    '+faststart',
    '-an',
    output
  ]);
}

function fades(durationMs: number): string {
  const fadeOutStart = Math.max(0, durationMs / MS_PER_SECOND - FADE_SECONDS);
  return `fade=t=in:st=0:d=${FADE_SECONDS},fade=t=out:st=${fadeOutStart.toFixed(DURATION_DIGITS)}:d=${FADE_SECONDS}`;
}

function seconds(ms: number): string {
  return (ms / MS_PER_SECOND).toFixed(DURATION_DIGITS);
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

async function ffmpeg(args: string[]): Promise<void> {
  await runFile('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: FFMPEG_OUTPUT_BYTES_MAX });
}

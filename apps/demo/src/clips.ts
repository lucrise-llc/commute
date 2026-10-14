// ffmpeg steps of compose. Each part of the video becomes a lossless clip of the same size and frame rate, and the
// last step joins the clips and encodes the video once.
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

import { BACKGROUND, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

const runFile = promisify(execFile);
const VIDEO_FPS = 60;
const GITHUB_FPS = 30;
const GITHUB_WIDTH = 1_280;
const GITHUB_HEIGHT = 720;
const MS_PER_SECOND = 1_000;
export const FRAME_MS = MS_PER_SECOND / VIDEO_FPS;
export const FADE_MS = 300;
const FADE_SECONDS = FADE_MS / MS_PER_SECOND;
const KEYFRAME_SECONDS = 10;
const DURATION_DIGITS = 6;
const FFMPEG_OUTPUT_BYTES_MAX = 10_000_000;
const CAPTURE_WIDTH = 1_920;
const CAPTURE_HEIGHT = 960;
const CONSOLE_WIDTH = 1_600;
const CONSOLE_HEIGHT = 800;
const CONSOLE_LEFT = 160;
const CONSOLE_TOP = 120;
// The console window's title bar, which compose lays over the window as an image.
export const CONSOLE_BAR = { left: 160, top: 72, width: 1_600, height: 48 };
const CONSOLE_BORDER_LEFT = 158;
const CONSOLE_BORDER_TOP = 70;
const CONSOLE_BORDER_WIDTH = 1_604;
const CONSOLE_BORDER_HEIGHT = 852;
const CONSOLE_BORDER_THICKNESS = 2;
const CAMERA_COMMAND_LEAD_FRAMES = 0.1;
// Every clip is BT.709 with the limited range. Screencast frames are JPEG, which is BT.601 with the full range, and
// the cards are RGB, so each clip converts once at its end, and the joined clips agree.
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const FRAME_COLOR_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
const TO_VIDEO_COLOR = `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${FRAME_COLOR_TAGS}`;
// Lossless clips, so that the final encode is the only lossy step.
const CLIP_CODEC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...COLOR_TAGS, '-an'];

// One picture of a clip and how long it shows in the video.
export type FrameEntry = {
  file: string;
  durationMs: number;
  focus?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
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

// Plays the frames for their durations at a constant frame rate. Console captures use their camera focus inside a
// dark window; scene and terminal frames fill the stage. The layers mix in RGB.
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
  const hasFocus = frames.some((frame) => frame.focus !== undefined);
  let base = `[0:v]fps=${VIDEO_FPS},scale=${VIDEO_WIDTH}:-2:flags=lanczos,format=rgb24,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:0:0:color=${BACKGROUND}[layer0]`;
  if (hasFocus) {
    const cameraPath = `${listPath}.camera`;
    await writeFile(cameraPath, cameraCommands(frames));
    base = `[0:v]fps=${VIDEO_FPS},sendcmd=f=${cameraPath},crop@camera=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:0:0:exact=1,scale=${CONSOLE_WIDTH}:${CONSOLE_HEIGHT}:flags=lanczos,format=rgb24,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:${CONSOLE_LEFT}:${CONSOLE_TOP}:color=${BACKGROUND},drawbox=x=${CONSOLE_BORDER_LEFT}:y=${CONSOLE_BORDER_TOP}:w=${CONSOLE_BORDER_WIDTH}:h=${CONSOLE_BORDER_HEIGHT}:color=0x383838:t=${CONSOLE_BORDER_THICKNESS}[layer0]`;
  }
  const layers = overlays.map((overlay, index) => {
    const enable = overlay.windows
      .map((window) => `between(t,${seconds(window.startMs)},${seconds(window.endMs)})`)
      .join('+');
    return `[layer${index}][${index + 1}:v]overlay=${overlay.left}:${overlay.top}:format=rgb:enable='${enable}'[layer${index + 1}]`;
  });
  const finish = `[layer${overlays.length}]${TO_VIDEO_COLOR}[out]`;
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
  durationMs: number;
  isGithub: boolean;
};

// The delivery encode applies the only fades in the video. The animation tune and long keyframe interval spend bits
// on the frames that change.
export async function joinClips({
  clips,
  listPath,
  output,
  crf,
  durationMs,
  isGithub
}: JoinClipsParams): Promise<void> {
  await writeFile(listPath, `ffconcat version 1.0\n${clips.map((clip) => `file ${quote(clip)}`).join('\n')}\n`);
  const fps = isGithub ? GITHUB_FPS : VIDEO_FPS;
  const resolution = isGithub ? `scale=${GITHUB_WIDTH}:${GITHUB_HEIGHT}:flags=lanczos,` : '';
  await ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-vf',
    `fps=${fps},setpts=N/(${fps}*TB),${resolution}${fades(durationMs)},format=yuv420p,${FRAME_COLOR_TAGS}`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-tune',
    'animation',
    '-crf',
    String(crf),
    '-g',
    String(fps * KEYFRAME_SECONDS),
    '-profile:v',
    'high',
    '-level:v',
    '4.2',
    '-pix_fmt',
    'yuv420p',
    ...COLOR_TAGS,
    '-movflags',
    '+faststart',
    '-tag:v',
    'avc1',
    '-an',
    output
  ]);
}

function cameraCommands(frames: FrameEntry[]): string {
  const lines: string[] = [];
  let elapsedMs = 0;
  let previous: FrameEntry['focus'];
  for (const frame of frames) {
    const focus = frame.focus;
    if (focus === undefined) {
      throw new Error(`CONSOLE_FOCUS_MISSING: ${frame.file}`);
    }
    if (
      focus.width > CAPTURE_WIDTH ||
      focus.height > CAPTURE_HEIGHT ||
      focus.left < 0 ||
      focus.top < 0 ||
      focus.left + focus.width > CAPTURE_WIDTH ||
      focus.top + focus.height > CAPTURE_HEIGHT ||
      focus.width * CONSOLE_HEIGHT !== focus.height * CONSOLE_WIDTH
    ) {
      throw new Error(`CONSOLE_FOCUS_INVALID: ${frame.file}`);
    }
    if (
      previous === undefined ||
      focus.left !== previous.left ||
      focus.top !== previous.top ||
      focus.width !== previous.width ||
      focus.height !== previous.height
    ) {
      const frameIndex = Math.round(elapsedMs / FRAME_MS);
      const atSeconds = Math.max(0, frameIndex - CAMERA_COMMAND_LEAD_FRAMES) / VIDEO_FPS;
      const at = atSeconds.toFixed(DURATION_DIGITS);
      lines.push(`${at} crop@camera w ${focus.width};`);
      lines.push(`${at} crop@camera h ${focus.height};`);
      lines.push(`${at} crop@camera x ${focus.left};`);
      lines.push(`${at} crop@camera y ${focus.top};`);
      previous = focus;
    }
    elapsedMs += frame.durationMs;
  }
  return `${lines.join('\n')}\n`;
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

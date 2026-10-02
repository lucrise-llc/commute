// Records a page as a person sees it: a CDP screencast of JPEG frames with their timestamps, and a timeline of marks
// that compose turns into captions, speed changes, and chapter cards.
import type { Browser, BrowserContext, Page } from 'playwright';

import { z } from 'zod';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { FRAME_MS } from './clips.ts';

const VIEWPORT = { width: 1_280, height: 640 };
const DEVICE_SCALE_FACTOR = 1.5;
const FRAME_WIDTH = 1_920;
const FRAME_HEIGHT = 960;
const JPEG_QUALITY = 90;
const FRAMES_DIR = 'frames';
const FRAME_NAME_DIGITS = 6;
const MS_PER_SECOND = 1_000;
const JSON_INDENT = 2;
// About 55 minutes of frames that change in every slot.
const FRAMES_MAX = 100_000;
const MARKS_MAX = 500;
const TEXT_LENGTH_MAX = 300;

export const TIMELINE_FILE = 'timeline.json';

const frameSchema = z.object({
  file: z.string().min(1),
  atMs: z.number().nonnegative()
});

const markSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('say'), atMs: z.number().nonnegative(), text: z.string().min(1).max(TEXT_LENGTH_MAX) }),
  z.object({ kind: z.literal('fast'), atMs: z.number().nonnegative(), isFast: z.boolean() }),
  z.object({
    kind: z.literal('chapter'),
    atMs: z.number().nonnegative(),
    title: z.string().min(1).max(TEXT_LENGTH_MAX)
  })
]);

// Times are milliseconds since the capture started. Frames and marks are in time order.
export const timelineSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    frames: z.array(frameSchema).min(1).max(FRAMES_MAX),
    marks: z.array(markSchema).max(MARKS_MAX)
  })
  .refine(({ frames }) => frames.every((frame, index) => index === 0 || frame.atMs >= (frames[index - 1]?.atMs ?? 0)), {
    message: 'FRAMES_OUT_OF_ORDER'
  })
  .refine(({ marks }) => marks.every((mark, index) => index === 0 || mark.atMs >= (marks[index - 1]?.atMs ?? 0)), {
    message: 'MARKS_OUT_OF_ORDER'
  });

export type Timeline = z.infer<typeof timelineSchema>;
type Frame = z.infer<typeof frameSchema>;
type Mark = z.infer<typeof markSchema>;

export type Capture = {
  // A caption cue. It shows until the next cue, for a bounded time.
  say: (text: string) => void;
  // Marks the start or the end of a wait that the video plays faster.
  fast: (isFast: boolean) => void;
  // Splices a chapter card into the video at this point. Capture time keeps running.
  chapter: (title: string) => void;
  // Stops the screencast and writes the timeline. Resolves with the path of the timeline file.
  stop: () => Promise<string>;
};

type CaptureBrowser = {
  browser: Browser;
  context: BrowserContext;
};

// The screencast sends frames at the scale of the browser window, not at the scale that Playwright emulates. The flag
// sets the window scale, so a 1280 by 640 viewport gives 1920 by 960 frames with sharp text.
export async function launchCaptureBrowser(): Promise<CaptureBrowser> {
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${DEVICE_SCALE_FACTOR}`] });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  return { browser, context };
}

type StartCaptureParams = {
  page: Page;
  recordingDir: string;
};

type PendingFrame = {
  data: string;
  atMs: number;
};

export async function startCapture({ page, recordingDir }: StartCaptureParams): Promise<Capture> {
  await rm(join(recordingDir, FRAMES_DIR), { recursive: true, force: true });
  await mkdir(join(recordingDir, FRAMES_DIR), { recursive: true });
  const session = await page.context().newCDPSession(page);
  const startedAt = Date.now();
  const frames: Frame[] = [];
  const marks: Mark[] = [];
  let pending: PendingFrame | null = null;
  let failure: Error | null = null;

  const elapsedMs = (): number => Date.now() - startedAt;
  const store = (frame: PendingFrame): void => {
    if (frames.length >= FRAMES_MAX) {
      failure ??= new Error(`CAPTURE_FRAMES_FULL: the capture stores at most ${FRAMES_MAX} frames.`);
      return;
    }
    const file = `${FRAMES_DIR}/${String(frames.length).padStart(FRAME_NAME_DIGITS, '0')}.jpg`;
    writeFileSync(join(recordingDir, file), Buffer.from(frame.data, 'base64'));
    frames.push({ file, atMs: frame.atMs });
  };
  const mark = (entry: Mark): void => {
    if (marks.length >= MARKS_MAX) {
      throw new Error(`CAPTURE_MARKS_FULL: the timeline holds at most ${MARKS_MAX} marks.`);
    }
    marks.push(entry);
  };

  session.on('Page.screencastFrame', (event) => {
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch((error: unknown) => {
      failure ??= new Error('CAPTURE_ACK_FAILED', { cause: error });
    });
    // The first frame can show a page that was drawn before the capture started.
    const atMs = Math.max(0, z.number().parse(event.metadata.timestamp) * MS_PER_SECOND - startedAt);
    // Only the last frame of each video frame's time slot is kept.
    if (pending !== null && Math.floor(pending.atMs / FRAME_MS) !== Math.floor(atMs / FRAME_MS)) {
      store(pending);
    }
    pending = { data: event.data, atMs };
  });
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: JPEG_QUALITY,
    maxWidth: FRAME_WIDTH,
    maxHeight: FRAME_HEIGHT
  });

  const stop = async (): Promise<string> => {
    const durationMs = elapsedMs();
    await session.send('Page.stopScreencast');
    await session.detach();
    if (pending !== null) {
      store(pending);
    }
    if (failure !== null) {
      throw failure;
    }
    const path = join(recordingDir, TIMELINE_FILE);
    await writeFile(path, `${JSON.stringify({ durationMs, frames, marks }, null, JSON_INDENT)}\n`);
    return path;
  };

  return {
    say: (text) => mark({ kind: 'say', atMs: elapsedMs(), text }),
    fast: (isFast) => mark({ kind: 'fast', atMs: elapsedMs(), isFast }),
    chapter: (title) => mark({ kind: 'chapter', atMs: elapsedMs(), title }),
    stop
  };
}

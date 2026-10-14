// Cuts the console capture at its chapter marks and plans each segment at a constant frame rate: which screencast
// frame shows in each video frame, when each caption shows, and when the speed badge shows. Waits marked fast play
// FAST_SPEED times faster, so every time in a plan is video time from the start of its segment.
import { join } from 'node:path';

import type { Timeline } from './capture.ts';
import type { FrameEntry, Window } from './clips.ts';
import type { FocusWindow } from './console-focus.ts';

import { FRAME_MS } from './clips.ts';
import { FOCUS_CUES, focusAt } from './console-focus.ts';

export const FAST_SPEED = 8;
const NORMAL_SPEED = 1;
// Longer than the longest reading hold in record.ts, so a caption stays while the cursor rests on what it describes.
const CAPTION_MS_MAX = 15_000;
// 15 minutes of video in one segment.
const SEGMENT_FRAMES_MAX = 54_000;

type Caption = FocusWindow;

export type ConsoleSegment = {
  // The title of the chapter card before the segment. The segment before the first chapter mark has none.
  chapter: string | null;
  // Empty when the segment is shorter than one video frame.
  frames: FrameEntry[];
  captions: Caption[];
  fastWindows: Window[];
};

// A range of capture time that plays at one speed.
type SpeedRange = Window & {
  speed: number;
};

type PlanSegmentsParams = {
  timeline: Timeline;
  recordingDir: string;
};

export function planSegments({ timeline, recordingDir }: PlanSegmentsParams): ConsoleSegment[] {
  const cueCount = timeline.marks.filter((mark) => mark.kind === 'say').length;
  if (cueCount !== FOCUS_CUES.length) {
    throw new Error(`FOCUS_CUES_MISMATCH: ${cueCount} captions but ${FOCUS_CUES.length} camera plans.`);
  }
  const ranges = speedRanges(timeline);
  const starts = [
    { startMs: 0, chapter: null },
    ...timeline.marks.flatMap((mark) => (mark.kind === 'chapter' ? [{ startMs: mark.atMs, chapter: mark.title }] : []))
  ];
  return starts.map(({ startMs, chapter }, index) => {
    const endMs = starts[index + 1]?.startMs ?? timeline.durationMs;
    const segment = { startMs, endMs, videoStartMs: videoMs({ ranges, ms: startMs }) };
    const captions = planCaptions({ timeline, ranges, segment });
    return {
      chapter,
      frames: planFrames({ timeline, recordingDir, ranges, segment, captions }),
      captions,
      fastWindows: planFastWindows({ ranges, segment })
    };
  });
}

// A segment in capture time, with the video time of its start.
type Segment = Window & {
  videoStartMs: number;
};

type PlanFramesParams = PlanSegmentsParams & {
  ranges: SpeedRange[];
  segment: Segment;
  captions: Caption[];
};

// Each video frame shows the last screencast frame at or before its capture time. Repeats merge into one entry.
function planFrames({ timeline, recordingDir, ranges, segment, captions }: PlanFramesParams): FrameEntry[] {
  const videoEndMs = videoMs({ ranges, ms: segment.endMs });
  const frameCount = Math.round((videoEndMs - segment.videoStartMs) / FRAME_MS);
  if (frameCount > SEGMENT_FRAMES_MAX) {
    throw new Error(`SEGMENT_TOO_LONG: ${frameCount} frames, more than ${SEGMENT_FRAMES_MAX}.`);
  }
  const entries: FrameEntry[] = [];
  let shown = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const atMs = captureMs({ ranges, ms: segment.videoStartMs + frame * FRAME_MS });
    while ((timeline.frames[shown + 1]?.atMs ?? Infinity) <= atMs) {
      shown += 1;
    }
    const shownFrame = timeline.frames[shown];
    if (shownFrame === undefined) {
      throw new Error('TIMELINE_WITHOUT_FRAMES: the timeline lists no frames.');
    }
    const file = join(recordingDir, shownFrame.file);
    const focus = focusAt({ windows: captions, atMs: frame * FRAME_MS });
    const last = entries.at(-1);
    if (
      last?.file === file &&
      last.focus?.left === focus.left &&
      last.focus.top === focus.top &&
      last.focus.width === focus.width &&
      last.focus.height === focus.height
    ) {
      last.durationMs += FRAME_MS;
    } else {
      entries.push({ file, durationMs: FRAME_MS, focus });
    }
  }
  return entries;
}

type PlanCaptionsParams = {
  timeline: Timeline;
  ranges: SpeedRange[];
  segment: Segment;
};

// A caption shows until the next one starts, for CAPTION_MS_MAX at most, and never past the end of its segment.
function planCaptions({ timeline, ranges, segment }: PlanCaptionsParams): Caption[] {
  const cues = timeline.marks.flatMap((mark) => (mark.kind === 'say' ? [mark] : []));
  const segmentEndMs = videoMs({ ranges, ms: segment.endMs }) - segment.videoStartMs;
  return cues.flatMap((cue, index) => {
    if (cue.atMs < segment.startMs || cue.atMs >= segment.endMs) {
      return [];
    }
    const startMs = videoMs({ ranges, ms: cue.atMs }) - segment.videoStartMs;
    const next = cues[index + 1];
    const nextStartMs = next === undefined ? Infinity : videoMs({ ranges, ms: next.atMs }) - segment.videoStartMs;
    const endMs = Math.min(startMs + CAPTION_MS_MAX, nextStartMs, segmentEndMs);
    const plan = FOCUS_CUES[index];
    if (plan === undefined) {
      throw new Error(`FOCUS_CUE_MISSING: caption ${index}.`);
    }
    return endMs > startMs ? [{ text: cue.text, startMs, endMs, rect: plan.rect }] : [];
  });
}

type PlanFastWindowsParams = {
  ranges: SpeedRange[];
  segment: Segment;
};

function planFastWindows({ ranges, segment }: PlanFastWindowsParams): Window[] {
  return ranges.flatMap((range) => {
    const startMs = Math.max(range.startMs, segment.startMs);
    const endMs = Math.min(range.endMs, segment.endMs);
    if (range.speed !== FAST_SPEED || endMs <= startMs) {
      return [];
    }
    return [
      {
        startMs: videoMs({ ranges, ms: startMs }) - segment.videoStartMs,
        endMs: videoMs({ ranges, ms: endMs }) - segment.videoStartMs
      }
    ];
  });
}

// The capture from start to end, split where a fast mark changes the speed.
function speedRanges(timeline: Timeline): SpeedRange[] {
  const ranges: SpeedRange[] = [];
  let startMs = 0;
  let speed = NORMAL_SPEED;
  for (const mark of timeline.marks) {
    if (mark.kind !== 'fast') {
      continue;
    }
    const next = mark.isFast ? FAST_SPEED : NORMAL_SPEED;
    if (next !== speed) {
      ranges.push({ startMs, endMs: mark.atMs, speed });
      startMs = mark.atMs;
      speed = next;
    }
  }
  ranges.push({ startMs, endMs: timeline.durationMs, speed });
  return ranges;
}

type TimeParams = {
  ranges: SpeedRange[];
  ms: number;
};

// Video time from the start of the capture, for a capture time.
function videoMs({ ranges, ms }: TimeParams): number {
  let total = 0;
  for (const range of ranges) {
    if (ms <= range.startMs) {
      break;
    }
    total += (Math.min(ms, range.endMs) - range.startMs) / range.speed;
  }
  return total;
}

// Capture time for a video time from the start of the capture.
function captureMs({ ranges, ms }: TimeParams): number {
  let remaining = ms;
  for (const range of ranges) {
    const length = (range.endMs - range.startMs) / range.speed;
    if (remaining <= length) {
      return range.startMs + remaining * range.speed;
    }
    remaining -= length;
  }
  return ranges.at(-1)?.endMs ?? 0;
}

// The recorded console is 1920 by 960. Each cue frames its subject within a 2:1 crop so the
// captured pixels are enlarged by no more than 1.25 times in the 1600 by 800 video window.

export type FocusRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FocusCue = {
  subject: string;
  rect: FocusRect;
};

const FULL_CONSOLE: FocusRect = { left: 0, top: 0, width: 1_920, height: 960 };

// The subjects follow the "say" marks in recording/timeline.json, in capture order.
export const FOCUS_CUES: FocusCue[] = [
  { subject: '20 agents begin', rect: FULL_CONSOLE },
  { subject: 'overlap activity', rect: { left: 640, top: 80, width: 1_280, height: 640 } },
  { subject: 'sequenced pair', rect: { left: 640, top: 100, width: 1_280, height: 640 } },
  { subject: 'trunk and changes in folders', rect: FULL_CONSOLE },
  { subject: 'c-5 and its activity', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'overlap and resolution', rect: FULL_CONSOLE },
  { subject: 'stored resolution', rect: FULL_CONSOLE },
  { subject: 'changes and checks', rect: FULL_CONSOLE },
  { subject: 'first landing batch', rect: { left: 640, top: 0, width: 1_280, height: 640 } },
  { subject: 'parallel landing', rect: FULL_CONSOLE },
  { subject: 'kept checks counter', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'approval for c-3', rect: { left: 640, top: 0, width: 1_280, height: 640 } },
  { subject: 'c-5 restack activity', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'checks on c-5', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'routes diff', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'last two batches', rect: { left: 640, top: 0, width: 1_280, height: 640 } },
  { subject: '20 landed changes', rect: { left: 0, top: 0, width: 1_600, height: 800 } },
  { subject: 'trunk routes file', rect: { left: 0, top: 0, width: 1_600, height: 800 } }
];

const CHARS_PER_SECOND = 15;
const MS_PER_SECOND = 1_000;
const READING_LEAD_MS = 300;
const CAMERA_MOVE_MS = 900;
const CAMERA_FOCUS_EXTRA_MS = 400;
const COORDINATE_MULTIPLE = 2;

export type FocusWindow = {
  startMs: number;
  endMs: number;
  text: string;
  rect: FocusRect;
};

type FocusAtParams = {
  windows: FocusWindow[];
  atMs: number;
};

// Every shot starts and ends wide, leaving navigation clicks visible between reading holds.
export function focusAt({ windows, atMs }: FocusAtParams): FocusRect {
  for (const window of windows) {
    if (atMs < window.startMs || atMs >= window.endMs) {
      continue;
    }
    const readingMs = (window.text.length / CHARS_PER_SECOND) * MS_PER_SECOND + READING_LEAD_MS;
    const focusEndMs = Math.min(window.endMs - CAMERA_MOVE_MS, window.startMs + readingMs + CAMERA_FOCUS_EXTRA_MS);
    const moveIn = progress({ atMs, startMs: window.startMs, endMs: window.startMs + CAMERA_MOVE_MS });
    if (moveIn < 1) {
      return interpolate({ from: FULL_CONSOLE, to: window.rect, progress: moveIn });
    }
    if (atMs < focusEndMs) {
      return window.rect;
    }
    const moveOut = progress({ atMs, startMs: focusEndMs, endMs: focusEndMs + CAMERA_MOVE_MS });
    return interpolate({ from: window.rect, to: FULL_CONSOLE, progress: moveOut });
  }
  return FULL_CONSOLE;
}

type ProgressParams = {
  atMs: number;
  startMs: number;
  endMs: number;
};

function progress({ atMs, startMs, endMs }: ProgressParams): number {
  const fraction = Math.max(0, Math.min(1, (atMs - startMs) / (endMs - startMs)));
  return (1 - Math.cos(Math.PI * fraction)) / COORDINATE_MULTIPLE;
}

type InterpolateParams = {
  from: FocusRect;
  to: FocusRect;
  progress: number;
};

function interpolate({ from, to, progress: eased }: InterpolateParams): FocusRect {
  const width = even(from.width + (to.width - from.width) * eased);
  const height = width / COORDINATE_MULTIPLE;
  return {
    left: clamp(Math.round(from.left + (to.left - from.left) * eased), FULL_CONSOLE.width - width),
    top: clamp(Math.round(from.top + (to.top - from.top) * eased), FULL_CONSOLE.height - height),
    width,
    height
  };
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value));
}

function even(value: number): number {
  return Math.round(value / COORDINATE_MULTIPLE) * COORDINATE_MULTIPLE;
}

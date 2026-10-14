// Replays the sessions of two coding agents side by side, on the harness clock, from their recorded transcripts. Each
// command shows as a tool call with its real output. Gaps between events play faster, and a cued event waits until
// the previous caption has had its reading time.
import type { Browser } from 'playwright';

import { join } from 'node:path';

import type { Edit } from './agents.ts';
import type { FrameEntry } from './clips.ts';
import type { Transcript } from './transcript.ts';

import { FRAME_MS } from './clips.ts';
import {
  ACCENT_COLOR,
  BACKGROUND,
  CAPTION_CSS,
  captionMarkup,
  escapeHtml,
  htmlDocument,
  MUTED_COLOR,
  STRIP_HEIGHT,
  TEXT_COLOR,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  WINDOW_BAR_CSS,
  windowBarMarkup
} from './graphics.ts';

// A gap between two events on the harness clock plays for at least GAP_MS_MIN and at most GAP_MS_MAX.
const GAP_MS_MIN = 500;
const GAP_MS_MAX = 2_000;
const READING_MS_LEAD = 1_200;
const READING_MS_PER_WORD = 280;
const END_HOLD_MS = 1_500;
const REPLAY_MS_MAX = 120_000;
const BLINK_MS = 500;
const BLINK_PHASES = 2;
const HALF = 0.5;
// The gap between the panes and the caption strip.
const PANES_BOTTOM_GAP = 16;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_DIGITS = 2;
const FRAME_NAME_DIGITS = 6;
const SCREEN_BACKGROUND = '#0a0b0d';
const PROMPT_BACKGROUND = '#16191e';
const OUTPUT_COLOR = '#b4bac4';
const DONE_COLOR = '#2dc242';
const ADDED_COLOR = '#7ee787';
const MONO = `'SF Mono', Menlo, Consolas, monospace`;
const TRAILING_NEWLINE = /\n$/;

export type Session = {
  owner: string;
  intent: string;
  edit: Edit;
  transcript: Transcript;
};

export type SessionCue = {
  agent: string;
  command: RegExp;
  // The cue applies only to a command whose output matches, when set.
  output?: RegExp;
  text: string;
};

type DiffLine = {
  text: string;
  isAdded: boolean;
};

// A step of a session, on the harness clock. The harness applies the edit between commute start and git add.
type Block =
  | {
      kind: 'bash';
      command: string;
      output: string;
      startMs: number;
      endMs: number;
    }
  | {
      kind: 'update';
      path: string;
      lines: DiffLine[];
      startMs: number;
      endMs: number;
    };

type Pane = {
  title: string;
  prompt: string;
  blocks: Block[];
};

type ClockPoint = {
  videoMs: number;
  harnessMs: number;
};

type Caption = {
  videoMs: number;
  text: string;
  block: Block | null;
};

export type SessionsPlan = {
  panes: Pane[];
  clock: ClockPoint[];
  captions: Caption[];
  frameCount: number;
  // The harness time of the last cue, where a later replay of the same sessions continues.
  endHarnessMs: number;
};

type PlanSessionsParams = {
  sessions: Session[];
  intro: string;
  cues: SessionCue[];
  fromHarnessMs?: number;
};

// The replay starts with the intro caption at fromHarnessMs and ends after the reading time of the last cue.
export function planSessions({ sessions, intro, cues, fromHarnessMs = 0 }: PlanSessionsParams): SessionsPlan {
  const panes = sessions.map((session) => paneOf(session));
  const cued = matchCues({ sessions, panes, cues, fromHarnessMs });
  const endHarnessMs = cued.at(-1)?.harnessMs ?? fromHarnessMs;
  const eventTimes = new Set<number>();
  for (const pane of panes) {
    for (const block of pane.blocks) {
      for (const harnessMs of [block.startMs, block.endMs]) {
        if (harnessMs > fromHarnessMs && harnessMs <= endHarnessMs) {
          eventTimes.add(harnessMs);
        }
      }
    }
  }
  const clock: ClockPoint[] = [{ videoMs: 0, harnessMs: fromHarnessMs }];
  const captions: Caption[] = [{ videoMs: 0, text: intro, block: null }];
  let videoMs = 0;
  let previousHarnessMs = fromHarnessMs;
  for (const harnessMs of [...eventTimes].toSorted((left, right) => left - right)) {
    videoMs += Math.min(GAP_MS_MAX, Math.max(GAP_MS_MIN, harnessMs - previousHarnessMs));
    previousHarnessMs = harnessMs;
    const cuesHere = cued.filter((cue) => cue.harnessMs === harnessMs);
    if (cuesHere.length === 0) {
      clock.push({ videoMs, harnessMs });
      continue;
    }
    for (const cue of cuesHere) {
      videoMs = Math.max(videoMs, readyMs(captions));
      clock.push({ videoMs, harnessMs });
      captions.push({ videoMs, text: cue.text, block: cue.block });
    }
  }
  const durationMs = Math.max(videoMs + END_HOLD_MS, readyMs(captions));
  if (durationMs > REPLAY_MS_MAX) {
    throw new Error(`REPLAY_TOO_LONG: the replay takes ${Math.round(durationMs)} ms, more than ${REPLAY_MS_MAX}.`);
  }
  return { panes, clock, captions, frameCount: Math.ceil(durationMs / FRAME_MS), endHarnessMs };
}

function paneOf({ owner, intent, edit, transcript }: Session): Pane {
  const blocks: Block[] = [];
  for (const command of transcript.commands) {
    const previous = blocks.at(-1);
    if (command.command === 'git add -A' && previous !== undefined) {
      const editMs = (previous.endMs + command.atMs) * HALF;
      blocks.push({ kind: 'update', path: edit.path, lines: diffLines(edit), startMs: editMs, endMs: editMs });
    }
    blocks.push({
      kind: 'bash',
      command: command.command,
      output: command.output.trimEnd(),
      startMs: command.atMs,
      endMs: command.atMs + command.durationMs
    });
  }
  const name = owner.charAt(0).toUpperCase() + owner.slice(1);
  return { title: `${name}'s agent · ${transcript.changeId}`, prompt: intent, blocks };
}

// The lines the edit writes. A replace edit keeps the lines it found, and every other line is added.
function diffLines(edit: Edit): DiffLine[] {
  const lines = edit.text.replace(TRAILING_NEWLINE, '').split('\n');
  if (edit.kind !== 'replace') {
    return lines.map((text) => ({ text, isAdded: true }));
  }
  const kept = new Set(edit.find.split('\n'));
  return lines.map((text) => ({ text, isAdded: !kept.has(text) }));
}

type MatchCuesParams = {
  sessions: Session[];
  panes: Pane[];
  cues: SessionCue[];
  fromHarnessMs: number;
};

type CuedBlock = {
  text: string;
  block: Block;
  harnessMs: number;
};

// Each cue matches the first matching command of its agent that ends after fromHarnessMs and after that agent's
// previous cue, and shows when the command's output appears. The cues must follow the harness clock.
function matchCues({ sessions, panes, cues, fromHarnessMs }: MatchCuesParams): CuedBlock[] {
  const cursors = new Map<string, number>();
  const cued: CuedBlock[] = [];
  for (const cue of cues) {
    const paneIndex = sessions.findIndex((session) => session.transcript.agent === cue.agent);
    const pane = panes[paneIndex];
    if (pane === undefined) {
      throw new Error(`SESSION_CUE_UNKNOWN_AGENT: no session replays ${cue.agent}.`);
    }
    const fromIndex = cursors.get(cue.agent) ?? 0;
    const index = pane.blocks.findIndex(
      (block, position) =>
        position >= fromIndex &&
        block.endMs > fromHarnessMs &&
        block.kind === 'bash' &&
        cue.command.test(block.command) &&
        (cue.output?.test(block.output) ?? true)
    );
    const block = pane.blocks[index];
    if (block === undefined) {
      throw new Error(
        `SESSION_CUE_UNMATCHED: no command of ${cue.agent} from #${fromIndex} matches ${cue.command} with output ${cue.output ?? '(any)'}.`
      );
    }
    const previous = cued.at(-1);
    if (previous !== undefined && block.endMs < previous.harnessMs) {
      throw new Error(`SESSION_CUES_OUT_OF_ORDER: the cue "${cue.text}" shows before the cue before it.`);
    }
    cursors.set(cue.agent, index + 1);
    cued.push({ text: cue.text, block, harnessMs: block.endMs });
  }
  return cued;
}

// The video time when the last caption has had its reading time.
function readyMs(captions: Caption[]): number {
  const last = captions.at(-1);
  if (last === undefined) {
    return 0;
  }
  return last.videoMs + READING_MS_LEAD + last.text.split(/\s+/).length * READING_MS_PER_WORD;
}

type RenderSessionsParams = {
  browser: Browser;
  plan: SessionsPlan;
  framesDir: string;
};

// Screenshots each frame whose markup changes. A frame with the same markup extends the previous screenshot.
export async function renderSessions({ browser, plan, framesDir }: RenderSessionsParams): Promise<FrameEntry[]> {
  const page = await browser.newPage({ viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } });
  await page.setContent(sessionsHtml());
  const entries: FrameEntry[] = [];
  let shownMarkup = '';
  for (let frame = 0; frame < plan.frameCount; frame += 1) {
    const markup = stageMarkup({ plan, videoMs: frame * FRAME_MS });
    const last = entries.at(-1);
    if (markup === shownMarkup && last !== undefined) {
      last.durationMs += FRAME_MS;
      continue;
    }
    const isFitting = await page.evaluate(async (html) => {
      const stage = document.getElementById('stage');
      if (stage === null) {
        return false;
      }
      stage.innerHTML = html;
      for (const element of document.querySelectorAll('.screen')) {
        element.scrollTop = element.scrollHeight;
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const caption = document.getElementById('caption');
      return caption !== null && caption.scrollHeight <= caption.clientHeight;
    }, markup);
    if (!isFitting) {
      throw new Error(`GRAPHIC_TEXT_OVERFLOWS: the caption at frame ${frame} of the sessions does not fit its box.`);
    }
    const file = join(framesDir, `${String(entries.length).padStart(FRAME_NAME_DIGITS, '0')}.png`);
    await page.screenshot({ path: file });
    entries.push({ file, durationMs: FRAME_MS });
    shownMarkup = markup;
  }
  await page.close();
  return entries;
}

type StageMarkupParams = {
  plan: SessionsPlan;
  videoMs: number;
};

function stageMarkup({ plan, videoMs }: StageMarkupParams): string {
  const harnessMs = harnessAt({ clock: plan.clock, videoMs });
  let caption: Caption | null = null;
  for (const candidate of plan.captions) {
    if (candidate.videoMs <= videoMs) {
      caption = candidate;
    }
  }
  const isBlinkOn = Math.floor(videoMs / BLINK_MS) % BLINK_PHASES === 0;
  const panes = plan.panes.map((pane) => paneMarkup({ pane, harnessMs, cuedBlock: caption?.block ?? null, isBlinkOn }));
  return `<div class="panes">${panes.join('')}</div>
    <div class="caption-area"><div class="caption" id="caption">${captionMarkup(caption?.text ?? '')}</div></div>`;
}

type HarnessAtParams = {
  clock: ClockPoint[];
  videoMs: number;
};

// The harness time at a video time. Between two clock points, the harness clock runs at a constant rate.
function harnessAt({ clock, videoMs }: HarnessAtParams): number {
  let harnessMs = clock[0]?.harnessMs ?? 0;
  for (const [index, point] of clock.entries()) {
    const next = clock[index + 1];
    if (next === undefined || videoMs < point.videoMs) {
      break;
    }
    if (videoMs >= next.videoMs) {
      harnessMs = next.harnessMs;
      continue;
    }
    const progress = (videoMs - point.videoMs) / (next.videoMs - point.videoMs);
    return point.harnessMs + progress * (next.harnessMs - point.harnessMs);
  }
  return harnessMs;
}

type PaneMarkupParams = {
  pane: Pane;
  harnessMs: number;
  cuedBlock: Block | null;
  isBlinkOn: boolean;
};

function paneMarkup({ pane, harnessMs, cuedBlock, isBlinkOn }: PaneMarkupParams): string {
  const rows = [`<div class="prompt"><span class="mark">&gt;</span><span>${escapeHtml(pane.prompt)}</span></div>`];
  for (const block of pane.blocks) {
    if (block.startMs > harnessMs) {
      break;
    }
    const isDone = block.endMs <= harnessMs;
    let dot = 'dot';
    if (!isDone) {
      dot = isBlinkOn ? 'dot run' : 'dot off';
    }
    if (block.kind === 'update') {
      rows.push(
        `<div class="call"><span class="${dot}"></span><span><b>Update</b>(${escapeHtml(block.path)})</span></div>`
      );
      rows.push(result({ lines: updateLines(block), isCued: block === cuedBlock }));
      continue;
    }
    rows.push(
      `<div class="call"><span class="${dot}"></span><span><b>Bash</b>(${escapeHtml(block.command)})</span></div>`
    );
    if (!isDone) {
      rows.push(result({ lines: [`Running… ${elapsed(harnessMs - block.startMs)}`], isCued: false }));
    } else if (block.output !== '') {
      rows.push(
        result({ lines: block.output.split('\n').map((line) => escapeHtml(line)), isCued: block === cuedBlock })
      );
    }
  }
  return `<div class="window">${windowBarMarkup(pane.title)}<div class="screen">${rows.join('')}</div></div>`;
}

type UpdateBlock = Extract<Block, { kind: 'update' }>;

function updateLines({ path, lines }: UpdateBlock): string[] {
  let addedCount = 0;
  for (const line of lines) {
    if (line.isAdded) {
      addedCount += 1;
    }
  }
  const noun = addedCount === 1 ? 'addition' : 'additions';
  const diff = lines.map((line) => {
    if (line.isAdded) {
      return `<span class="added">+ ${escapeHtml(line.text)}</span>`;
    }
    return `  ${escapeHtml(line.text)}`;
  });
  return [`Updated ${escapeHtml(path)} with ${addedCount} ${noun}`, ...diff];
}

type ResultParams = {
  lines: string[];
  isCued: boolean;
};

function result({ lines, isCued }: ResultParams): string {
  const body = lines.map((line) => `<div>${line}</div>`).join('');
  return `<div class="result"><span class="elbow">⎿</span><div class="out${isCued ? ' cued' : ''}">${body}</div></div>`;
}

function elapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}m ${String(seconds % SECONDS_PER_MINUTE).padStart(SECONDS_DIGITS, '0')}s`;
}

function sessionsHtml(): string {
  return htmlDocument({
    css: `* { box-sizing: border-box; margin: 0; }
      body { width: ${VIDEO_WIDTH}px; height: ${VIDEO_HEIGHT}px; background: ${BACKGROUND}; overflow: hidden;
        -webkit-font-smoothing: antialiased; }
      .panes { position: absolute; left: 32px; right: 32px; top: 40px; bottom: ${STRIP_HEIGHT + PANES_BOTTOM_GAP}px; display: grid;
        grid-template-columns: 1fr 1fr; gap: 24px; }
      .window { display: flex; flex-direction: column; min-height: 0; background: ${SCREEN_BACKGROUND};
        border: 1px solid #262a31; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45); }
      ${WINDOW_BAR_CSS}
      .screen { flex: 1; min-height: 0; overflow: hidden; padding: 18px 24px 22px; color: ${TEXT_COLOR};
        font: 22px/1.5 ${MONO};
        mask-image: linear-gradient(transparent, #000 48px); }
      .prompt { display: grid; grid-template-columns: 2ch 1fr; padding: 8px 12px; margin-bottom: 6px;
        border-radius: 8px; background: ${PROMPT_BACKGROUND}; }
      .prompt .mark { color: ${MUTED_COLOR}; }
      .call { display: grid; grid-template-columns: 2ch 1fr; margin-top: 12px; white-space: pre-wrap;
        overflow-wrap: anywhere; }
      .call b { font-weight: 700; }
      .dot { width: 0.6em; height: 0.6em; margin-top: 0.45em; border-radius: 50%; background: ${DONE_COLOR}; }
      .dot.run { background: ${MUTED_COLOR}; }
      .dot.off { background: transparent; }
      .result { display: grid; grid-template-columns: 2ch 3ch 1fr; color: ${OUTPUT_COLOR}; white-space: pre-wrap;
        overflow-wrap: anywhere; }
      .result .elbow { grid-column: 2; color: ${MUTED_COLOR}; }
      .result .out { grid-column: 3; border-radius: 6px; }
      .result .out.cued { margin: 0 -8px; padding: 0 8px; color: ${TEXT_COLOR};
        background: color-mix(in srgb, ${ACCENT_COLOR} 18%, transparent); }
      .added { color: ${ADDED_COLOR}; }
      .caption-area { position: absolute; left: 0; right: 0; bottom: 0; height: ${STRIP_HEIGHT}px; display: flex;
        align-items: center; justify-content: center; padding: 0 240px; background: ${BACKGROUND}; }
      ${CAPTION_CSS}`,
    body: '<div id="stage"></div>'
  });
}

// Replays an agent's terminal transcript with xterm in a browser page. A replay clock steps one video frame at a time,
// and each frame that changes is a screenshot, so typing is smooth. Commands type at a human pace, output appears at
// once, and long waits are cut.
import type { Browser } from 'playwright';

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FrameEntry } from './clips.ts';
import type { TerminalCue } from './story.ts';
import type { Transcript } from './transcript.ts';

import { FRAME_MS } from './clips.ts';
import {
  ACCENT_COLOR,
  BACKGROUND,
  CAPTION_CSS,
  captionMarkup,
  escapeHtml,
  FONT_FAMILY,
  htmlDocument,
  MUTED_COLOR,
  TEXT_COLOR,
  VIDEO_HEIGHT,
  VIDEO_WIDTH
} from './graphics.ts';

const XTERM_SCRIPT_PATH = fileURLToPath(import.meta.resolve('@xterm/xterm/lib/xterm.js'));
const XTERM_CSS_PATH = fileURLToPath(import.meta.resolve('@xterm/xterm/css/xterm.css'));
const TERMINAL_OPTIONS = {
  cols: 104,
  rows: 24,
  fontSize: 24,
  lineHeight: 1.2,
  fontFamily: `'SF Mono', Menlo, Consolas, monospace`,
  cursorBlink: false,
  cursorStyle: 'block',
  convertEol: true,
  disableStdin: true,
  theme: { background: '#0a0b0d', foreground: TEXT_COLOR, cursor: ACCENT_COLOR, cursorAccent: '#0a0b0d' }
};
const PROMPT_DIR = '~/storefront';
const OUTPUT_COLOR = '#b4bac4';
// Key delays vary from 34 to 74 ms in a fixed pattern, so that typing does not look mechanical.
const KEY_MS = 34;
const KEY_SPREAD_MS = 40;
const KEY_STRIDE_MS = 23;
const ENTER_MS = 350;
const RUN_MS_MIN = 250;
// A command that ran longer, such as a commute wait, shows for this long.
const RUN_MS_MAX = 1_400;
const AFTER_OUTPUT_MS = 700;
const READING_MS_PER_WORD = 280;
const READING_MS_LEAD = 1_200;
const REPLAY_MS_MAX = 75_000;
const FRAME_NAME_DIGITS = 6;
const HEX_RADIX = 16;
const RGB_CHANNELS = 3;
const HEX_PAIR = /[\da-f]{2}/gi;
const ANSI_RESET = '\u001B[0m';

// What changes in one video frame: text to write to the terminal, and the markup of a new caption.
type ReplayStep = {
  write: string;
  caption: string | null;
};

type TimedStep = Partial<ReplayStep> & {
  atMs: number;
};

export type ReplayPlan = {
  steps: Map<number, ReplayStep>;
  frameCount: number;
  // The index of the last command in the replay, so that a later replay can continue after it.
  lastCommand: number;
};

type PlanReplayParams = {
  transcript: Transcript;
  intro: string;
  cues: TerminalCue[];
  fromCommand?: number;
};

// The replay starts with the intro caption at the command fromCommand and ends after the command of the last cue. A
// cue shows for its reading time before the next cue may replace it, so the typing waits for the reader.
export function planReplay({ transcript, intro, cues, fromCommand = 0 }: PlanReplayParams): ReplayPlan {
  const cueTexts = matchCues({ transcript, cues, fromCommand });
  const lastCommand = Math.max(...cueTexts.keys());
  const commands = transcript.commands.slice(fromCommand, lastCommand + 1);
  const steps = new Map<number, ReplayStep>();
  const add = ({ atMs, write = '', caption: text = null }: TimedStep): void => {
    const frame = Math.round(atMs / FRAME_MS);
    const current = steps.get(frame) ?? { write: '', caption: null };
    steps.set(frame, { write: current.write + write, caption: text ?? current.caption });
  };
  const characters = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let clockMs = 0;
  let caption = { text: intro, atMs: 0 };
  add({ atMs: 0, caption: captionMarkup(intro), write: prompt(commands[0]?.dir ?? '.') });
  for (const [index, command] of commands.entries()) {
    const cueText = cueTexts.get(fromCommand + index);
    if (cueText !== undefined) {
      clockMs = Math.max(clockMs, caption.atMs + readingMs(caption.text));
      caption = { text: cueText, atMs: clockMs };
      add({ atMs: clockMs, caption: captionMarkup(cueText) });
    }
    for (const [position, { segment }] of [...characters.segment(command.command)].entries()) {
      clockMs += KEY_MS + ((position * KEY_STRIDE_MS) % KEY_SPREAD_MS);
      add({ atMs: clockMs, write: segment });
    }
    clockMs += ENTER_MS;
    add({ atMs: clockMs, write: '\n' });
    clockMs += Math.min(RUN_MS_MAX, Math.max(RUN_MS_MIN, command.durationMs));
    const output = command.output.trimEnd();
    add({ atMs: clockMs, write: output === '' ? '' : `${color(OUTPUT_COLOR)}${output}${ANSI_RESET}\n` });
    clockMs += AFTER_OUTPUT_MS;
    add({ atMs: clockMs, write: prompt(commands[index + 1]?.dir ?? command.dir) });
  }
  const durationMs = Math.max(clockMs, caption.atMs + readingMs(caption.text));
  if (durationMs > REPLAY_MS_MAX) {
    throw new Error(`REPLAY_TOO_LONG: the replay takes ${Math.round(durationMs)} ms, more than ${REPLAY_MS_MAX}.`);
  }
  return { steps, frameCount: Math.ceil(durationMs / FRAME_MS), lastCommand };
}

type MatchCuesParams = {
  transcript: Transcript;
  cues: TerminalCue[];
  fromCommand: number;
};

// Maps the index of each cued command to its caption. The cues match commands in order.
function matchCues({ transcript, cues, fromCommand }: MatchCuesParams): Map<number, string> {
  const matched = new Map<number, string>();
  let fromIndex = fromCommand;
  for (const cue of cues) {
    const index = transcript.commands.findIndex(
      (command, position) =>
        position >= fromIndex && cue.command.test(command.command) && (cue.output?.test(command.output) ?? true)
    );
    if (index === -1) {
      throw new Error(
        `TERMINAL_CUE_UNMATCHED: no command of ${transcript.agent} from #${fromIndex} matches ${cue.command} with output ${cue.output ?? '(any)'}.`
      );
    }
    matched.set(index, cue.text);
    fromIndex = index + 1;
  }
  if (matched.size === 0) {
    throw new Error('TERMINAL_CUES_EMPTY: the replay needs at least one cue to know where it ends.');
  }
  return matched;
}

type RenderReplayParams = {
  browser: Browser;
  plan: ReplayPlan;
  title: string;
  framesDir: string;
};

// Screenshots each frame that changes. A frame without a change extends the previous screenshot.
export async function renderReplay({ browser, plan, title, framesDir }: RenderReplayParams): Promise<FrameEntry[]> {
  const page = await browser.newPage({ viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } });
  await page.setContent(replayHtml(title));
  await page.addStyleTag({ path: XTERM_CSS_PATH });
  await page.addScriptTag({ path: XTERM_SCRIPT_PATH });
  await page.addScriptTag({ content: driverScript() });
  const entries: FrameEntry[] = [];
  for (let frame = 0; frame < plan.frameCount; frame += 1) {
    const step = plan.steps.get(frame);
    const last = entries.at(-1);
    if (step === undefined && last !== undefined) {
      last.durationMs += FRAME_MS;
      continue;
    }
    const isFitting = await page.evaluate(`replayStep(${JSON.stringify(step ?? { write: '', caption: null })})`);
    if (isFitting !== true) {
      throw new Error(`GRAPHIC_TEXT_OVERFLOWS: the caption at frame ${frame} of the replay does not fit its box.`);
    }
    const file = join(framesDir, `${String(entries.length).padStart(FRAME_NAME_DIGITS, '0')}.png`);
    await page.screenshot({ path: file });
    entries.push({ file, durationMs: FRAME_MS });
  }
  await page.close();
  return entries;
}

// The page's own script. Each step writes to the terminal, sets the caption, waits until the terminal has drawn the
// text, and reports whether the caption fits its box. The terminal has focus, because xterm draws its cursor only then.
function driverScript(): string {
  return `
    const terminal = new Terminal(${JSON.stringify(TERMINAL_OPTIONS)});
    terminal.open(document.getElementById('terminal'));
    terminal.focus();
    const caption = document.getElementById('caption');
    window.replayStep = async (step) => {
      if (step.caption !== null) {
        caption.innerHTML = step.caption;
      }
      if (step.write !== '') {
        await new Promise((resolve) => terminal.write(step.write, resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return caption.scrollHeight <= caption.clientHeight;
    };`;
}

function replayHtml(title: string): string {
  return htmlDocument({
    css: `* { box-sizing: border-box; margin: 0; }
      body { width: ${VIDEO_WIDTH}px; height: ${VIDEO_HEIGHT}px; background: ${BACKGROUND}; display: flex;
        flex-direction: column; align-items: center; -webkit-font-smoothing: antialiased; }
      .window { margin-top: 64px; background: ${TERMINAL_OPTIONS.theme.background}; border: 1px solid #262a31;
        border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45); }
      .bar { position: relative; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 20px;
        background: #17191d; border-bottom: 1px solid #23262c; }
      .bar i { width: 14px; height: 14px; border-radius: 50%; background: #3a3e46; }
      .bar span { position: absolute; left: 0; right: 0; text-align: center; color: ${MUTED_COLOR};
        font: 500 20px ${FONT_FAMILY}; }
      .screen { padding: 24px 28px; }
      .caption-area { flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 240px; }
      ${CAPTION_CSS}`,
    body: `<div class="window">
        <div class="bar"><i></i><i></i><i></i><span>${escapeHtml(title)}</span></div>
        <div class="screen"><div id="terminal"></div></div>
      </div>
      <div class="caption-area"><div class="caption" id="caption"></div></div>`
  });
}

function prompt(dir: string): string {
  const path = dir === '.' ? PROMPT_DIR : `${PROMPT_DIR}/${dir}`;
  return `${color(ACCENT_COLOR)}${path}${ANSI_RESET} ${color(MUTED_COLOR)}$${ANSI_RESET} `;
}

// An ANSI escape for a 24-bit foreground color, from a #rrggbb color.
function color(hex: string): string {
  const channels = [...hex.matchAll(HEX_PAIR)].map(([pair]) => Number.parseInt(pair, HEX_RADIX));
  if (channels.length !== RGB_CHANNELS) {
    throw new Error(`INVALID_COLOR: ${hex} is not a #rrggbb color.`);
  }
  return `\u001B[38;2;${channels.join(';')}m`;
}

function readingMs(text: string): number {
  return READING_MS_LEAD + text.split(/\s+/).length * READING_MS_PER_WORD;
}

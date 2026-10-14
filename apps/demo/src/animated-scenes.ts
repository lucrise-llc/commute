import type { Page } from 'playwright';

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import type { FrameEntry } from './clips.ts';

import { FADE_MS, FRAME_MS } from './clips.ts';
import { captionMarkup, escapeHtml, htmlDocument, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

const BACKGROUND = '#101010';
const BLUE = '#1868bc';
// The console's brand color, the Kumo token `--color-kumo-brand`.
const BRAND_BLUE = 'oklch(57.72% 0.2324 260)';
const GREEN = '#2dc242';
const GREEN_BRIGHT = '#75e980';
const BOX_FILL = '#122116';
const HATCH_COLOR = '#1c4a27';
const ORANGE = '#df3d17';
const WHITE = '#f4fcf3';
const GREY = '#5e5e5e';
const MONO = 'Menlo,Consolas,monospace';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
const CAPTION_HEIGHT = 120;
const ART_HEIGHT = VIDEO_HEIGHT - CAPTION_HEIGHT;
const FRAME_DIGITS = 6;
const SHEET_COLUMNS = 2;
const SHEET_SAMPLE_COUNT = 6;
const READING_CHARS_PER_SECOND = 15;
const READING_LEAD_MS = 300;
const MS_PER_SECOND = 1_000;
const COORD_DIGITS = 1;
const OPACITY_DIGITS = 3;
const HALF = 0.5;
const CUBIC = 3;
const DOUBLE = 2;
const SEED = { multiplier: 12.9898, salt: 78.233, scale: 43_758.5453 };
const STYLE = {
  boxStroke: 3,
  pulseStroke: 3,
  boxInset: 8,
  boxDash: '10 8',
  hatchSize: 12,
  hatchStroke: 2,
  hatchAngle: 35,
  connectorStroke: 2,
  connectorDash: '8 10',
  packetRadius: 8,
  hollowStroke: 3,
  labelSize: 24,
  valueSize: 22,
  lineOffset: 16,
  codeSize: 26,
  ringRadius: 16,
  ringStroke: 3,
  ringStartDegrees: -90,
  barHeight: 6,
  tagSize: 20,
  packetLabelLift: 30
};
const TIMING = {
  pulseMs: 320,
  fadeMs: 450,
  enterMs: 550,
  drawMs: 700,
  landMs: 300
};
// The stage every explainer scene shares: the agents on the left, trunk on the right, and the flow between them.
const AGENTS = {
  left: 120,
  top: 160,
  columns: 9,
  rows: 15,
  gapX: 40,
  gapY: 44,
  iconSize: 24,
  edgeX: 480,
  waveStaggerMs: 22,
  dotMs: 300,
  morphDelayMs: 350,
  morphMs: 600,
  risePx: 10,
  driftPx: 2,
  driftPeriodMs: 2_400,
  driftRowPhase: 0.7,
  dotRadius: 3,
  iconStroke: 2,
  capLeft: 7,
  capWidth: 10,
  bodyTop: 13,
  bodyWidth: 11,
  bodyRight: 13,
  dimOpacity: 0.35
};
const TRUNK = {
  left: 1_624,
  top: 160,
  width: 176,
  height: 640,
  lineOffset: 24,
  landingDepth: 14
};
const TRUNK_CENTER = { left: TRUNK.left + TRUNK.width * HALF, top: TRUNK.top + TRUNK.height * HALF };
const LANE_LABELS = ['src/routes.mjs', 'src/cart', 'src/catalog', 'src/search', 'docs'];
const LANES = {
  boxCenterX: 700,
  boxWidth: 270,
  boxHeight: 72
};
const LANE_BOX_LEFT = LANES.boxCenterX - LANES.boxWidth * HALF;
const LANE_BOX_RIGHT = LANES.boxCenterX + LANES.boxWidth * HALF;
const LOGO = {
  radiusShare: 0.2,
  markInsetShare: 0.2,
  markShare: 0.6
};
const CHECK_TICK = {
  short: 0.35,
  long: 0.75
};
const MARK = {
  viewBox: 16,
  stroke: 1.5,
  path: 'M2 5h5l4 6h3M2 11h5l4-6h3'
};

const STAGE_HTML = htmlDocument({
  css: `*{box-sizing:border-box}html,body{margin:0;width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px;background:${BACKGROUND}}
    #art{width:${VIDEO_WIDTH}px;height:${ART_HEIGHT}px;overflow:hidden}svg{display:block}
    #caption{height:${CAPTION_HEIGHT}px;background:${BACKGROUND};color:#f1f2f4;display:flex;align-items:center;
    justify-content:center;padding:0 240px;text-align:center;text-wrap:balance;font:500 36px/1.35 -apple-system,
    BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased}
    .caption-text{max-width:1440px;max-height:100px}
    #caption span.nowrap{white-space:nowrap}`,
  body: '<div id="art"></div><div id="caption"></div>'
});

type CaptionCue = {
  text: string;
  durationMs: number;
};

export type Scene = {
  id: string;
  visual: string;
  cues: CaptionCue[];
};

export const OPENING_SCENES: Scene[] = [
  {
    id: 'opening-fleet',
    visual: 'fleet',
    cues: [{ text: 'Teams run many coding agents on one repository at the same time.', durationMs: 5_500 }]
  },
  {
    id: 'opening-queue',
    visual: 'queue',
    cues: [
      { text: 'A merge queue lands one change at a time. Every change waits for the line ahead.', durationMs: 6_900 }
    ]
  },
  {
    id: 'opening-rerun',
    visual: 'rerun',
    cues: [{ text: 'Each landing moves trunk. Checks for every change behind it run again.', durationMs: 6_300 }]
  },
  {
    id: 'opening-conflict',
    visual: 'late-conflict',
    cues: [{ text: 'Two open changes may learn they conflict only after one lands.', durationMs: 5_500 }]
  },
  {
    id: 'opening-lanes',
    visual: 'lanes',
    cues: [
      {
        text: 'Commute gives each area of code its own lane. Independent changes land in parallel, in any order.',
        durationMs: 8_200
      }
    ]
  },
  {
    id: 'opening-dependency',
    visual: 'dependency',
    cues: [{ text: 'A change waits only for a change it conflicts with.', durationMs: 4_500 }]
  },
  {
    id: 'opening-name',
    visual: 'brand',
    cues: [{ text: 'Commute. Many coding agents, one repository.', durationMs: 5_100 }]
  }
];

export const CHAPTER_SCENES: Record<string, Scene> = {
  'Overlaps are known at the start': {
    id: 'chapter-overlaps',
    visual: 'overlaps',
    cues: [
      {
        text: 'Each change declares its files. Only changes sharing a file get a real merge check.',
        durationMs: 7_100
      },
      { text: 'A clean merge stays parallel; a conflict gives the pair an order.', durationMs: 5_800 }
    ]
  },
  'A conflict, resolved at the first push': {
    id: 'chapter-resolution',
    visual: 'resolution',
    cues: [
      { text: "Both changes insert after 'cart', in src/routes.mjs.", durationMs: 5_000 },
      {
        text: 'Workers AI reads both intents and selects existing line IDs. It cannot write a line.',
        durationMs: 8_000
      },
      { text: 'The resolution is stored and applies when c-3 lands.', durationMs: 4_900 }
    ]
  },
  'People approve batches, and changes land in parallel': {
    id: 'chapter-batches',
    visual: 'batch',
    cues: [
      { text: 'Ready changes that commute form one landing batch.', durationMs: 4_700 },
      { text: 'One approval lands the whole batch, in any order.', durationMs: 4_600 }
    ]
  },
  'Check results that still hold are kept': {
    id: 'chapter-checks',
    visual: 'checks',
    cues: [
      { text: 'Git hashes each folder. Check results are saved under the folder hashes they read.', durationMs: 6_700 },
      { text: 'When trunk moves, only checks for changed folders run again.', durationMs: 5_000 }
    ]
  },
  'Everything lands': {
    id: 'chapter-everything',
    visual: 'everything',
    cues: [{ text: 'Everything lands: 20 changes in four batches.', durationMs: 4_800 }]
  },
  'What the agents saw': {
    id: 'chapter-agent',
    visual: 'agent',
    cues: [{ text: 'What the agents saw: Commute commands and plain git.', durationMs: 5_100 }]
  }
};

export const CLOSING_SCENES: Scene[] = [
  {
    id: 'closing-cloudflare',
    visual: 'architecture',
    cues: [
      {
        text: 'Workers serve the API, console, and git remote. Artifacts holds trunk and a repository per change.',
        durationMs: 8_900
      },
      {
        text: 'A Durable Object coordinates each project. Containers run merges and checks. Workers AI resolves conflicts.',
        durationMs: 9_800
      }
    ]
  },
  {
    id: 'closing-name',
    visual: 'end',
    cues: [{ text: 'Commute. Changes that commute land in any order.', durationMs: 5_000 }]
  }
];

type RenderScenesParams = {
  page: Page;
  scenes: Scene[];
  framesDir: string;
  reviewDir: string;
};

export async function renderScenes({ page, scenes, framesDir, reviewDir }: RenderScenesParams): Promise<FrameEntry[]> {
  await mkdir(framesDir, { recursive: true });
  await mkdir(reviewDir, { recursive: true });
  await page.setViewportSize({ width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
  await page.setContent(STAGE_HTML);
  const frames: FrameEntry[] = [];
  let sequenceStartMs = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const durationMs = sceneDurationMs(scene);
    for (const [cueIndex, cue] of scene.cues.entries()) {
      const hasOpeningFade = sceneIndex === 0 && cueIndex === 0;
      const hasClosingFade = sceneIndex === scenes.length - 1 && cueIndex === scene.cues.length - 1;
      let fadeMs = 0;
      if (hasOpeningFade) {
        fadeMs += FADE_MS;
      }
      if (hasClosingFade) {
        fadeMs += FADE_MS;
      }
      const minimumMs = (cue.text.length / READING_CHARS_PER_SECOND) * MS_PER_SECOND + READING_LEAD_MS + fadeMs;
      if (cue.durationMs < minimumMs) {
        throw new Error(`CAPTION_TOO_FAST: ${scene.id}: ${cue.text}`);
      }
    }
    const frameCount = Math.round(durationMs / FRAME_MS);
    const samples: string[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const timeMs = frameIndex * FRAME_MS;
      const caption = captionAt({ cues: scene.cues, timeMs });
      const art = sceneArt({ visual: scene.visual, timeMs, sequenceTimeMs: sequenceStartMs + timeMs });
      await page.evaluate(
        ({ artMarkup, captionMarkupValue }) => {
          const artElement = document.getElementById('art');
          const captionElement = document.getElementById('caption');
          if (artElement === null || captionElement === null) {
            throw new Error('SCENE_STAGE_MISSING');
          }
          artElement.innerHTML = artMarkup;
          captionElement.innerHTML = `<div class="caption-text">${captionMarkupValue}</div>`;
          const captionText = captionElement.querySelector('.caption-text');
          if (captionText === null || captionText.scrollHeight > captionText.clientHeight) {
            throw new Error('SCENE_CAPTION_OVERFLOWS');
          }
        },
        { artMarkup: art, captionMarkupValue: captionMarkup(caption) }
      );
      const file = join(framesDir, `${scene.id}-${String(frameIndex).padStart(FRAME_DIGITS, '0')}.png`);
      await page.screenshot({ path: file });
      frames.push({ file, durationMs: FRAME_MS });
      for (let sampleIndex = 0; sampleIndex < SHEET_SAMPLE_COUNT; sampleIndex += 1) {
        if (frameIndex === Math.round(((frameCount - 1) * sampleIndex) / (SHEET_SAMPLE_COUNT - 1))) {
          samples.push(file);
        }
      }
    }
    await contactSheet({ page, samples, path: join(reviewDir, `${scene.id}.png`) });
    sequenceStartMs += durationMs;
  }
  return frames;
}

type CaptionAtParams = {
  cues: CaptionCue[];
  timeMs: number;
};

function captionAt({ cues, timeMs }: CaptionAtParams): string {
  let cueEndMs = 0;
  for (const cue of cues) {
    cueEndMs += cue.durationMs;
    if (timeMs < cueEndMs) {
      return cue.text;
    }
  }
  throw new Error('CAPTION_TIME_OUT_OF_RANGE');
}

type ContactSheetParams = {
  page: Page;
  samples: string[];
  path: string;
};

async function contactSheet({ page, samples, path }: ContactSheetParams): Promise<void> {
  const images = await Promise.all(
    samples.map(async (sample) => `data:image/png;base64,${(await readFile(sample)).toString('base64')}`)
  );
  await page.setViewportSize({ width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
  await page.setContent(
    htmlDocument({
      css: `*{box-sizing:border-box}body{margin:0;background:${BACKGROUND};display:grid;grid-template-columns:repeat(${SHEET_COLUMNS},1fr);gap:4px}img{width:100%;height:auto}`,
      body: images.map((source) => `<img src="${source}">`).join('')
    })
  );
  await page.screenshot({ path, fullPage: true });
  await page.setContent(STAGE_HTML);
}

type Point = {
  left: number;
  top: number;
};

type SceneArtParams = {
  visual: string;
  timeMs: number;
  sequenceTimeMs: number;
};

const SVG_DEFS = `<defs><pattern id="hatch" width="${STYLE.hatchSize}" height="${STYLE.hatchSize}" patternUnits="userSpaceOnUse" patternTransform="rotate(${STYLE.hatchAngle})"><path d="M0 0V${STYLE.hatchSize}" stroke="${HATCH_COLOR}" stroke-width="${STYLE.hatchStroke}"/></pattern></defs>`;

function sceneArt({ visual, timeMs, sequenceTimeMs }: SceneArtParams): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${ART_HEIGHT}">${SVG_DEFS}<rect width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" fill="${BACKGROUND}"/>${sceneBody({ visual, timeMs, sequenceTimeMs })}</svg>`;
}

function sceneBody({ visual, timeMs, sequenceTimeMs }: SceneArtParams): string {
  switch (visual) {
    case 'fleet':
    case 'queue':
    case 'rerun':
    case 'late-conflict':
    case 'lanes':
    case 'dependency':
    case 'brand':
      return opening(sequenceTimeMs);
    case 'overlaps':
      return overlaps(timeMs);
    case 'resolution':
      return resolution(timeMs);
    case 'batch':
      return batch(timeMs);
    case 'checks':
      return checks(timeMs);
    case 'everything':
      return everything(timeMs);
    case 'agent':
      return agentCommands(timeMs);
    case 'architecture':
      return architecture(timeMs);
    case 'end':
      return endCard(timeMs);
    default:
      throw new Error(`UNKNOWN_SCENE: ${visual}`);
  }
}

function sceneDurationMs(scene: Scene): number {
  let durationMs = 0;
  for (const cue of scene.cues) {
    durationMs += cue.durationMs;
  }
  return durationMs;
}

type SceneStartParams = {
  scenes: Scene[];
  visual: string;
};

function sceneStartMs({ scenes, visual }: SceneStartParams): number {
  let startMs = 0;
  for (const scene of scenes) {
    if (scene.visual === visual) {
      return startMs;
    }
    startMs += sceneDurationMs(scene);
  }
  throw new Error(`UNKNOWN_SCENE: ${visual}`);
}

// Motion: pure functions of time.

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

type WindowParams = {
  timeMs: number;
  startMs: number;
  durationMs: number;
};

function progressIn({ timeMs, startMs, durationMs }: WindowParams): number {
  return clamp01((timeMs - startMs) / durationMs);
}

function smooth(progress: number): number {
  const clamped = clamp01(progress);
  return clamped * clamped * (CUBIC - DOUBLE * clamped);
}

function easeOut(progress: number): number {
  return 1 - (1 - clamp01(progress)) ** CUBIC;
}

type MixParams = {
  from: number;
  to: number;
  progress: number;
};

function mix({ from, to, progress }: MixParams): number {
  return from + (to - from) * progress;
}

type PulseParams = {
  timeMs: number;
  eventsMs: number[];
};

// A box brightens for a moment after each event, such as a packet that arrives.
function pulseAfter({ timeMs, eventsMs }: PulseParams): number {
  let pulse = 0;
  for (const eventMs of eventsMs) {
    const elapsedMs = timeMs - eventMs;
    if (elapsedMs >= 0 && elapsedMs < TIMING.pulseMs) {
      pulse = Math.max(pulse, 1 - elapsedMs / TIMING.pulseMs);
    }
  }
  return pulse;
}

type SeededParams = {
  index: number;
  salt: number;
};

function seeded({ index, salt }: SeededParams): number {
  const value = Math.sin(index * SEED.multiplier + salt * SEED.salt) * SEED.scale;
  return value - Math.floor(value);
}

// Paths.

function distance(points: [Point, Point]): number {
  const [from, to] = points;
  return Math.hypot(to.left - from.left, to.top - from.top);
}

type PathProgressParams = {
  points: Point[];
  progress: number;
};

function pathLength(points: Point[]): number {
  let length = 0;
  let previous: Point | null = null;
  for (const current of points) {
    if (previous !== null) {
      length += distance([previous, current]);
    }
    previous = current;
  }
  return length;
}

// The points of a path up to the given share of its length, with the last one cut to that share.
function partialPoints({ points, progress }: PathProgressParams): Point[] {
  let remaining = pathLength(points) * clamp01(progress);
  const visible: Point[] = [];
  let previous: Point | null = null;
  for (const current of points) {
    if (previous === null) {
      visible.push(current);
      previous = current;
      continue;
    }
    const length = distance([previous, current]);
    if (remaining <= length) {
      const share = length === 0 ? 0 : remaining / length;
      visible.push({
        left: mix({ from: previous.left, to: current.left, progress: share }),
        top: mix({ from: previous.top, to: current.top, progress: share })
      });
      return visible;
    }
    remaining -= length;
    visible.push(current);
    previous = current;
  }
  return visible;
}

function pointAlong({ points, progress }: PathProgressParams): Point {
  const visible = partialPoints({ points, progress });
  const last = visible.at(-1);
  if (last === undefined) {
    throw new Error('EMPTY_PATH');
  }
  return last;
}

// Drawing.

function fmt(value: number): string {
  return value.toFixed(COORD_DIGITS);
}

function alpha(value: number): string {
  return clamp01(value).toFixed(OPACITY_DIGITS);
}

function pathData(points: Point[]): string {
  return points.map((current, index) => `${index === 0 ? 'M' : 'L'}${fmt(current.left)} ${fmt(current.top)}`).join('');
}

type TextParams = {
  at: Point;
  value: string;
  size?: number;
  color?: string;
  opacity?: number;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
  weight?: number;
};

function text({
  at,
  value,
  size = STYLE.labelSize,
  color = WHITE,
  opacity = 1,
  anchor = 'middle',
  family = MONO,
  weight = 400
}: TextParams): string {
  if (opacity <= 0 || value === '') {
    return '';
  }
  return `<text x="${fmt(at.left)}" y="${fmt(at.top)}" text-anchor="${anchor}" dominant-baseline="central" fill="${color}" opacity="${alpha(opacity)}" font-size="${size}" font-weight="${weight}" font-family="${family}">${escapeHtml(value)}</text>`;
}

type ConnectorParams = {
  points: Point[];
  progress?: number;
  opacity?: number;
};

function connector({ points, progress = 1, opacity = 1 }: ConnectorParams): string {
  if (progress <= 0 || opacity <= 0) {
    return '';
  }
  return `<path d="${pathData(partialPoints({ points, progress }))}" fill="none" stroke="${GREY}" stroke-width="${STYLE.connectorStroke}" stroke-dasharray="${STYLE.connectorDash}" opacity="${alpha(opacity)}"/>`;
}

type DotParams = {
  at: Point;
  opacity?: number;
  isHollow?: boolean;
};

function dot({ at, opacity = 1, isHollow = false }: DotParams): string {
  if (opacity <= 0) {
    return '';
  }
  if (isHollow) {
    return `<circle cx="${fmt(at.left)}" cy="${fmt(at.top)}" r="${STYLE.packetRadius}" fill="${BACKGROUND}" stroke="${ORANGE}" stroke-width="${STYLE.hollowStroke}" opacity="${alpha(opacity)}"/>`;
  }
  return `<circle cx="${fmt(at.left)}" cy="${fmt(at.top)}" r="${STYLE.packetRadius}" fill="${ORANGE}" opacity="${alpha(opacity)}"/>`;
}

type LabeledDotParams = {
  at: Point;
  label: string;
  opacity: number;
};

function labeledDot({ at, label, opacity }: LabeledDotParams): string {
  return (
    dot({ at, opacity }) +
    text({ at: { left: at.left, top: at.top - STYLE.packetLabelLift }, value: label, size: STYLE.valueSize, opacity })
  );
}

type RingParams = {
  at: Point;
  progress: number;
  color: string;
  opacity: number;
};

// The progress of a check, drawn as an arc around its change.
function ring({ at, progress, color, opacity }: RingParams): string {
  if (opacity <= 0 || progress <= 0) {
    return '';
  }
  const circumference = DOUBLE * Math.PI * STYLE.ringRadius;
  return `<circle cx="${fmt(at.left)}" cy="${fmt(at.top)}" r="${STYLE.ringRadius}" fill="none" stroke="${color}" stroke-width="${STYLE.ringStroke}" stroke-dasharray="${fmt(circumference * clamp01(progress))} ${fmt(circumference)}" transform="rotate(${STYLE.ringStartDegrees} ${fmt(at.left)} ${fmt(at.top)})" opacity="${alpha(opacity)}"/>`;
}

type BoxParams = {
  center: Point;
  width: number;
  height: number;
  label?: string;
  value?: string;
  pulse?: number;
  alarm?: number;
  opacity?: number;
  lineOffset?: number;
};

function box({
  center,
  width,
  height,
  label = '',
  value = '',
  pulse = 0,
  alarm = 0,
  opacity = 1,
  lineOffset = STYLE.lineOffset
}: BoxParams): string {
  if (opacity <= 0) {
    return '';
  }
  return `<g opacity="${alpha(opacity)}">${boxFrame({ center, width, height, pulse, alarm })}${boxText({ center, label, value, lineOffset })}</g>`;
}

type BoxFrameParams = {
  center: Point;
  width: number;
  height: number;
  pulse: number;
  alarm: number;
};

function boxFrame({ center, width, height, pulse, alarm }: BoxFrameParams): string {
  const left = center.left - width * HALF;
  const top = center.top - height * HALF;
  let stroke = GREEN;
  if (alarm > 0) {
    stroke = ORANGE;
  } else if (pulse > 0) {
    stroke = GREEN_BRIGHT;
  }
  const strokeWidth = STYLE.boxStroke + Math.max(pulse, alarm) * STYLE.pulseStroke;
  const inset = STYLE.boxInset;
  return `<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(width)}" height="${fmt(height)}" fill="${BOX_FILL}" stroke="${stroke}" stroke-width="${fmt(strokeWidth)}"/><rect x="${fmt(left + inset)}" y="${fmt(top + inset)}" width="${fmt(width - inset * DOUBLE)}" height="${fmt(height - inset * DOUBLE)}" fill="url(#hatch)" stroke="${stroke}" stroke-width="${STYLE.boxStroke}" stroke-dasharray="${STYLE.boxDash}"/>`;
}

type BoxTextParams = {
  center: Point;
  label: string;
  value: string;
  lineOffset: number;
};

function boxText({ center, label, value, lineOffset }: BoxTextParams): string {
  if (value === '') {
    return text({ at: center, value: label });
  }
  return (
    text({ at: { left: center.left, top: center.top - lineOffset }, value: label }) +
    text({ at: { left: center.left, top: center.top + lineOffset }, value, size: STYLE.valueSize })
  );
}

function laneY(index: number): number {
  return TRUNK.top + ((index + HALF) * TRUNK.height) / LANE_LABELS.length;
}

type TrunkParams = {
  label?: string;
  value?: string;
  pulse?: number;
  opacity?: number;
};

function trunk({ label = 'TRUNK', value = '', pulse = 0, opacity = 1 }: TrunkParams): string {
  return box({
    center: TRUNK_CENTER,
    width: TRUNK.width,
    height: TRUNK.height,
    label,
    value,
    pulse,
    opacity,
    lineOffset: TRUNK.lineOffset
  });
}

type GridCell = {
  column: number;
  row: number;
};

function agentOrigin({ column, row }: GridCell): Point {
  return { left: AGENTS.left + column * AGENTS.gapX, top: AGENTS.top + row * AGENTS.gapY };
}

function agentCenter(cell: GridCell): Point {
  const origin = agentOrigin(cell);
  return { left: origin.left + AGENTS.iconSize * HALF, top: origin.top + AGENTS.iconSize * HALF };
}

type AgentIconParams = {
  origin: Point;
  opacity: number;
  scale?: number;
};

function agentIcon({ origin, opacity, scale = 1 }: AgentIconParams): string {
  if (opacity <= 0) {
    return '';
  }
  return `<g transform="translate(${fmt(origin.left)} ${fmt(origin.top)}) scale(${fmt(scale)})" fill="none" stroke="${BLUE}" stroke-width="${AGENTS.iconStroke}" opacity="${alpha(opacity)}"><rect x="${AGENTS.capLeft}" width="${AGENTS.capWidth}" height="${AGENTS.capWidth}" rx="1" vector-effect="non-scaling-stroke"/><rect y="${AGENTS.bodyTop}" width="${AGENTS.bodyWidth}" height="${AGENTS.capWidth}" rx="1" vector-effect="non-scaling-stroke"/><rect x="${AGENTS.bodyRight}" y="${AGENTS.bodyTop}" width="${AGENTS.bodyWidth}" height="${AGENTS.capWidth}" rx="1" vector-effect="non-scaling-stroke"/></g>`;
}

type AgentsParams = {
  timeMs: number;
  entryStartMs: number | null;
  opacity: number;
};

// The agents, a grid of icons. On entry each one shows as a dot first, then turns into an icon, in a diagonal wave.
function agents({ timeMs, entryStartMs, opacity }: AgentsParams): string {
  if (opacity <= 0) {
    return '';
  }
  const pieces: string[] = [];
  for (let row = 0; row < AGENTS.rows; row += 1) {
    const drift = Math.sin(timeMs / AGENTS.driftPeriodMs + row * AGENTS.driftRowPhase) * AGENTS.driftPx;
    for (let column = 0; column < AGENTS.columns; column += 1) {
      const origin = agentOrigin({ column, row });
      let dotOpacity = 0;
      let iconOpacity = 1;
      let rise = 0;
      if (entryStartMs !== null) {
        const waveMs = entryStartMs + (column + row) * AGENTS.waveStaggerMs;
        const appear = progressIn({ timeMs, startMs: waveMs, durationMs: AGENTS.dotMs });
        const morph = smooth(progressIn({ timeMs, startMs: waveMs + AGENTS.morphDelayMs, durationMs: AGENTS.morphMs }));
        dotOpacity = appear * (1 - morph);
        iconOpacity = morph;
        rise = (1 - morph) * AGENTS.risePx;
      }
      if (dotOpacity > 0) {
        const center = agentCenter({ column, row });
        pieces.push(
          `<circle cx="${fmt(center.left)}" cy="${fmt(center.top)}" r="${AGENTS.dotRadius}" fill="${BLUE}" opacity="${alpha(dotOpacity)}"/>`
        );
      }
      pieces.push(agentIcon({ origin: { left: origin.left + drift, top: origin.top + rise }, opacity: iconOpacity }));
    }
  }
  return `<g opacity="${alpha(opacity)}">${pieces.join('')}</g>`;
}

type LogoParams = {
  center: Point;
  size: number;
  opacity: number;
};

// The console's mark on the brand tile.
function logo({ center, size, opacity }: LogoParams): string {
  if (opacity <= 0) {
    return '';
  }
  const left = center.left - size * HALF;
  const top = center.top - size * HALF;
  const radius = size * LOGO.radiusShare;
  return `<g transform="translate(${fmt(left)} ${fmt(top)})" opacity="${alpha(opacity)}"><rect width="${size}" height="${size}" rx="${fmt(radius)}" fill="${BRAND_BLUE}"/><g transform="translate(${fmt(size * LOGO.markInsetShare)} ${fmt(size * LOGO.markInsetShare)}) scale(${fmt((size * LOGO.markShare) / MARK.viewBox)})"><path d="${MARK.path}" fill="none" stroke="${WHITE}" stroke-width="${MARK.stroke}" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
}

type Flight = {
  points: Point[];
  launchMs: number;
  arriveMs: number;
  label: string;
};

// A change in flight along its path. It ends inside the box it flies to, which hides it.
type FlightDotParams = {
  flight: Flight;
  timeMs: number;
};

function flightDot({ flight, timeMs }: FlightDotParams): string {
  if (timeMs < flight.launchMs || timeMs > flight.arriveMs + TIMING.landMs) {
    return '';
  }
  const progress = smooth(
    progressIn({ timeMs, startMs: flight.launchMs, durationMs: flight.arriveMs - flight.launchMs })
  );
  const at = pointAlong({ points: flight.points, progress });
  const opacity = 1 - progressIn({ timeMs, startMs: flight.arriveMs, durationMs: TIMING.landMs });
  if (flight.label === '') {
    return dot({ at, opacity });
  }
  return labeledDot({ at, label: flight.label, opacity });
}

function arrivals(flights: Flight[]): number[] {
  return flights.map((flight) => flight.arriveMs);
}

type LandedCountParams = {
  flights: Flight[];
  timeMs: number;
};

function landedCount({ flights, timeMs }: LandedCountParams): number {
  let landed = 0;
  for (const flight of flights) {
    if (flight.arriveMs <= timeMs) {
      landed += 1;
    }
  }
  return landed;
}

function intoTrunk(top: number): Point {
  return { left: TRUNK.left + TRUNK.landingDepth, top };
}

// The opening is one scene on world time: a merge queue forms, its checks reset at each landing, a conflict shows
// late, and then the queue splits into one lane per area of code.
const OPENING = {
  trunkEnterMs: 700,
  fleetFirstLaunchMs: 1_500,
  fleetLaunchEveryMs: 110,
  fleetFlightMs: 1_600,
  fleetJitterMs: 120,
  fleetTrunkMarginPx: 40,
  queueBoxDelayMs: 100,
  firstArrivalMs: 900,
  arrivalEveryMs: 430,
  arrivalJitterMs: 120,
  feedMs: 600,
  enterMs: 650,
  firstLandingMs: 1_700,
  landEveryMs: 1_400,
  shiftMs: 380,
  headX: 1_580,
  slotGap: 56,
  capacity: 14,
  changesMax: 64,
  checkMs: 1_250,
  conflictLeadMs: 1_200,
  conflictAfterLandingMs: 1_000,
  conflictBehind: 2,
  dropMs: 450,
  dropPx: 76,
  labelDelayMs: 300,
  splitMs: 800,
  releaseDelayMs: 150,
  releaseLaunchMs: 1_000,
  releaseStaggerMs: 110,
  releaseRanks: 5,
  releasePxPerMs: 0.8,
  laneFlowDelayMs: 900,
  laneFlightMs: 1_900,
  lanePeriodMinMs: 650,
  lanePeriodSpreadMs: 500,
  laneFlightsMax: 32,
  dependencyC3LaunchMs: 400,
  dependencyC3FlightMs: 1_700,
  dependencyC5AppearMs: 200,
  dependencyC5WaitX: 900,
  dependencyC5DelayMs: 200,
  dependencyC5FlightMs: 1_400,
  brandFadeMs: 600,
  brandEnterDelayMs: 450,
  tileSize: 112,
  tileOffsetY: -84,
  nameOffsetY: 64,
  nameSize: 96,
  nameWeight: 650
};
const OPENING_AT = {
  queue: sceneStartMs({ scenes: OPENING_SCENES, visual: 'queue' }),
  rerun: sceneStartMs({ scenes: OPENING_SCENES, visual: 'rerun' }),
  conflict: sceneStartMs({ scenes: OPENING_SCENES, visual: 'late-conflict' }),
  lanes: sceneStartMs({ scenes: OPENING_SCENES, visual: 'lanes' }),
  dependency: sceneStartMs({ scenes: OPENING_SCENES, visual: 'dependency' }),
  brand: sceneStartMs({ scenes: OPENING_SCENES, visual: 'brand' })
};
const STAGE_CENTER = { left: (AGENTS.edgeX + TRUNK.left) * HALF, top: TRUNK_CENTER.top };
const NEVER = Number.POSITIVE_INFINITY;
const NO_DROP = -1;
const FLEET_SALT = { row: 1, target: 2, jitter: 3 };
const QUEUE_SALT = { arrival: 4, release: 5 };
const LANE_SALT = { period: 6, offset: 7 };

type QueuedChange = {
  lane: number;
  arriveMs: number;
  landMs: number;
  dropMs: number;
};

function departureMs(change: QueuedChange): number {
  return Math.min(change.landMs, change.dropMs);
}

// The merge queue: changes join at the tail, one lands from the head at a time, and a full line makes the next wait.
function planQueue(dropIndex: number): QueuedChange[] {
  const changes: QueuedChange[] = [];
  let previousLandMs = OPENING_AT.queue + OPENING.firstLandingMs - OPENING.landEveryMs;
  for (let index = 0; index < OPENING.changesMax; index += 1) {
    const jitterMs = (seeded({ index, salt: QUEUE_SALT.arrival }) - HALF) * OPENING.arrivalJitterMs;
    let arriveMs = OPENING_AT.queue + OPENING.firstArrivalMs + index * OPENING.arrivalEveryMs + jitterMs;
    if (index >= OPENING.capacity) {
      const blocker = changes[index - OPENING.capacity];
      if (blocker === undefined) {
        throw new Error('QUEUE_BLOCKER_MISSING');
      }
      arriveMs = Math.max(arriveMs, departureMs(blocker));
    }
    if (arriveMs >= OPENING_AT.lanes) {
      return changes;
    }
    let landMs = NEVER;
    let dropMs = NEVER;
    if (index === dropIndex) {
      const conflicting = changes[index - OPENING.conflictBehind];
      if (conflicting === undefined) {
        throw new Error('QUEUE_CONFLICT_MISSING');
      }
      dropMs = conflicting.landMs + OPENING.conflictAfterLandingMs;
    } else {
      landMs = Math.max(previousLandMs + OPENING.landEveryMs, arriveMs + OPENING.enterMs);
      if (landMs >= OPENING_AT.lanes) {
        landMs = NEVER;
      } else {
        previousLandMs = landMs;
      }
    }
    changes.push({ lane: index % LANE_LABELS.length, arriveMs, landMs, dropMs });
  }
  throw new Error('QUEUE_PLAN_UNBOUNDED');
}

type FirstLandingParams = {
  changes: QueuedChange[];
  timeMs: number;
};

function firstLandingAfter({ changes, timeMs }: FirstLandingParams): number {
  for (const [index, change] of changes.entries()) {
    if (change.landMs >= timeMs && change.landMs !== NEVER) {
      return index;
    }
  }
  throw new Error('QUEUE_CONFLICT_NOT_PLANNED');
}

// c-3 is the first change to land once the conflict scene has started; c-5 waits two places behind it.
const C3_INDEX = firstLandingAfter({
  changes: planQueue(NO_DROP),
  timeMs: OPENING_AT.conflict + OPENING.conflictLeadMs
});
const C5_INDEX = C3_INDEX + OPENING.conflictBehind;
const QUEUE = planQueue(C5_INDEX);

function queueLabel(index: number): string {
  if (index === C3_INDEX) {
    return 'c-3';
  }
  if (index === C5_INDEX) {
    return 'c-5';
  }
  return '';
}

function slotLeft(slot: number): number {
  return OPENING.headX - slot * OPENING.slotGap;
}

// Where a waiting change sits on the line. It slides forward one place each time a change ahead of it leaves.
type LineLeftParams = {
  index: number;
  timeMs: number;
};

function lineLeft({ index, timeMs }: LineLeftParams): number {
  const change = QUEUE[index];
  if (change === undefined) {
    throw new Error('QUEUE_CHANGE_MISSING');
  }
  let ahead = 0;
  let lastLeaveMs = -NEVER;
  for (const other of QUEUE.slice(0, index)) {
    const leaveMs = departureMs(other);
    if (leaveMs > timeMs) {
      ahead += 1;
    } else {
      lastLeaveMs = Math.max(lastLeaveMs, leaveMs);
    }
  }
  let left = slotLeft(ahead);
  const shift = progressIn({ timeMs, startMs: lastLeaveMs, durationMs: OPENING.shiftMs });
  if (shift < 1) {
    left = mix({ from: slotLeft(ahead + 1), to: left, progress: smooth(shift) });
  }
  const entry = progressIn({ timeMs, startMs: change.arriveMs, durationMs: OPENING.enterMs });
  if (entry < 1) {
    left = mix({ from: LANE_BOX_RIGHT, to: left, progress: easeOut(entry) });
  }
  return left;
}

function planFleet(): Flight[] {
  const flights: Flight[] = [];
  for (let index = 0; index < OPENING.changesMax; index += 1) {
    const jitterMs = (seeded({ index, salt: FLEET_SALT.jitter }) - HALF) * OPENING.fleetJitterMs;
    const launchMs = OPENING.fleetFirstLaunchMs + index * OPENING.fleetLaunchEveryMs + jitterMs;
    if (launchMs + OPENING.fleetFlightMs > OPENING_AT.queue) {
      return flights;
    }
    const row = Math.floor(seeded({ index, salt: FLEET_SALT.row }) * AGENTS.rows);
    const targetSpan = TRUNK.height - OPENING.fleetTrunkMarginPx * DOUBLE;
    const targetY = TRUNK.top + OPENING.fleetTrunkMarginPx + seeded({ index, salt: FLEET_SALT.target }) * targetSpan;
    const startY = agentCenter({ column: 0, row }).top;
    flights.push({
      points: [{ left: AGENTS.edgeX, top: startY }, intoTrunk(targetY)],
      launchMs,
      arriveMs: launchMs + OPENING.fleetFlightMs,
      label: ''
    });
  }
  throw new Error('FLEET_PLAN_UNBOUNDED');
}

function lanePath(lane: number): Point[] {
  return [{ left: AGENTS.edgeX, top: laneY(lane) }, intoTrunk(laneY(lane))];
}

// After the split each lane lands its changes on its own rhythm, so they land in any order.
function planLaneFlow(): Flight[] {
  const flights: Flight[] = [];
  const firstLaunchMs = OPENING_AT.lanes + OPENING.laneFlowDelayMs;
  for (const lane of LANE_LABELS.keys()) {
    const periodMs =
      OPENING.lanePeriodMinMs + seeded({ index: lane, salt: LANE_SALT.period }) * OPENING.lanePeriodSpreadMs;
    const offsetMs = seeded({ index: lane, salt: LANE_SALT.offset }) * periodMs;
    for (let index = 0; index < OPENING.laneFlightsMax; index += 1) {
      const launchMs = firstLaunchMs + offsetMs + index * periodMs;
      if (launchMs >= OPENING_AT.brand) {
        break;
      }
      const isRoutesLane = lane === 0;
      const crossesDependency = launchMs + OPENING.laneFlightMs > OPENING_AT.dependency && launchMs < OPENING_AT.brand;
      if (isRoutesLane && crossesDependency) {
        continue;
      }
      flights.push({ points: lanePath(lane), launchMs, arriveMs: launchMs + OPENING.laneFlightMs, label: '' });
    }
  }
  return flights;
}

type Release = {
  index: number;
  fromX: number;
  lane: number;
  launchMs: number;
  arriveMs: number;
};

// The changes still waiting when the queue splits move to their lanes and land in parallel.
function planRelease(): Release[] {
  const releases: Release[] = [];
  for (const [index, change] of QUEUE.entries()) {
    if (departureMs(change) <= OPENING_AT.lanes) {
      continue;
    }
    const fromX = lineLeft({ index, timeMs: OPENING_AT.lanes });
    const rank = Math.floor(seeded({ index, salt: QUEUE_SALT.release }) * OPENING.releaseRanks);
    const launchMs = OPENING_AT.lanes + OPENING.releaseLaunchMs + rank * OPENING.releaseStaggerMs;
    const flightMs = (TRUNK.left - fromX) / OPENING.releasePxPerMs;
    releases.push({ index, fromX, lane: change.lane, launchMs, arriveMs: launchMs + flightMs });
  }
  return releases;
}

const FLEET = planFleet();
const LANE_FLOW = planLaneFlow();
const RELEASE = planRelease();
const DEPENDENCY_C3: Flight = {
  points: lanePath(0),
  launchMs: OPENING_AT.dependency + OPENING.dependencyC3LaunchMs,
  arriveMs: OPENING_AT.dependency + OPENING.dependencyC3LaunchMs + OPENING.dependencyC3FlightMs,
  label: 'c-3'
};
const DEPENDENCY_C5: Flight = {
  points: [{ left: OPENING.dependencyC5WaitX, top: laneY(0) }, intoTrunk(laneY(0))],
  launchMs: DEPENDENCY_C3.arriveMs + OPENING.dependencyC5DelayMs,
  arriveMs: DEPENDENCY_C3.arriveMs + OPENING.dependencyC5DelayMs + OPENING.dependencyC5FlightMs,
  label: 'c-5'
};
const OPENING_ARRIVALS = [
  ...arrivals(FLEET),
  ...QUEUE.map((change) => change.landMs).filter((landMs) => landMs !== NEVER),
  ...RELEASE.map((release) => release.arriveMs),
  ...arrivals(LANE_FLOW),
  DEPENDENCY_C3.arriveMs,
  DEPENDENCY_C5.arriveMs
];

function opening(timeMs: number): string {
  const brandFade = 1 - smooth(progressIn({ timeMs, startMs: OPENING_AT.brand, durationMs: OPENING.brandFadeMs }));
  const flow = [
    queueStructure({ timeMs, layer: 'lines' }),
    ...FLEET.map((flight) => flightDot({ flight, timeMs })),
    queuePackets(timeMs),
    releasePackets(timeMs),
    ...LANE_FLOW.map((flight) => flightDot({ flight, timeMs })),
    dependencyPackets(timeMs),
    queueStructure({ timeMs, layer: 'boxes' })
  ];
  const trunkOpacity = smooth(progressIn({ timeMs, startMs: OPENING.trunkEnterMs, durationMs: TIMING.drawMs }));
  return [
    `<g opacity="${alpha(brandFade)}">${flow.join('')}</g>`,
    trunk({ pulse: pulseAfter({ timeMs, eventsMs: OPENING_ARRIVALS }), opacity: trunkOpacity }),
    agents({ timeMs, entryStartMs: 0, opacity: 1 }),
    openingBrand(timeMs)
  ].join('');
}

// The merge queue box and its lines. When the lanes start, the one box splits into five lane boxes.
type QueueStructureParams = {
  timeMs: number;
  layer: 'lines' | 'boxes';
};

function queueStructure({ timeMs, layer }: QueueStructureParams): string {
  const startMs = OPENING_AT.queue + OPENING.queueBoxDelayMs;
  const appear = smooth(progressIn({ timeMs, startMs, durationMs: TIMING.enterMs }));
  if (appear <= 0) {
    return '';
  }
  const split = smooth(progressIn({ timeMs, startMs: OPENING_AT.lanes, durationMs: OPENING.splitMs }));
  const pieces: string[] = [];
  for (const [lane, label] of LANE_LABELS.entries()) {
    const top = mix({ from: STAGE_CENTER.top, to: laneY(lane), progress: split });
    if (layer === 'lines') {
      const draw = progressIn({ timeMs, startMs, durationMs: TIMING.drawMs });
      pieces.push(
        connector({
          points: [
            { left: AGENTS.edgeX, top: laneY(lane) },
            { left: LANE_BOX_LEFT, top }
          ],
          progress: draw
        }),
        connector({
          points: [
            { left: LANE_BOX_RIGHT, top },
            { left: TRUNK.left, top }
          ],
          progress: draw
        })
      );
      continue;
    }
    if (split <= 0 && lane > 0) {
      continue;
    }
    const center = { left: LANES.boxCenterX, top };
    const crossfade = progressIn({ timeMs, startMs: OPENING_AT.lanes, durationMs: OPENING.splitMs });
    pieces.push(
      `<g opacity="${alpha(appear)}">${boxFrame({ center, width: LANES.boxWidth, height: LANES.boxHeight, pulse: 0, alarm: 0 })}${text({ at: center, value: 'MERGE QUEUE', opacity: 1 - crossfade * DOUBLE })}${text({ at: center, value: label, opacity: crossfade * DOUBLE - 1 })}</g>`
    );
  }
  return pieces.join('');
}

function queuePackets(timeMs: number): string {
  if (timeMs >= OPENING_AT.lanes + TIMING.fadeMs) {
    return '';
  }
  let lastLandingMs = -NEVER;
  for (const change of QUEUE) {
    if (change.landMs <= timeMs) {
      lastLandingMs = Math.max(lastLandingMs, change.landMs);
    }
  }
  const ringOpacity =
    progressIn({ timeMs, startMs: OPENING_AT.rerun, durationMs: TIMING.fadeMs }) *
    (1 - progressIn({ timeMs, startMs: OPENING_AT.lanes, durationMs: TIMING.landMs }));
  const labelOpacity = progressIn({
    timeMs,
    startMs: OPENING_AT.conflict + OPENING.labelDelayMs,
    durationMs: TIMING.fadeMs
  });
  const pieces: string[] = [];
  for (const [index, change] of QUEUE.entries()) {
    const feedStartMs = change.arriveMs - OPENING.feedMs;
    if (timeMs < feedStartMs) {
      continue;
    }
    const label = queueLabel(index);
    if (timeMs < change.arriveMs) {
      const progress = smooth(progressIn({ timeMs, startMs: feedStartMs, durationMs: OPENING.feedMs }));
      const feed = [
        { left: AGENTS.edgeX, top: laneY(change.lane) },
        { left: LANE_BOX_LEFT, top: STAGE_CENTER.top }
      ];
      pieces.push(dot({ at: pointAlong({ points: feed, progress }) }));
      continue;
    }
    if (timeMs >= change.dropMs) {
      const dropped = {
        left: lineLeft({ index, timeMs: change.dropMs }),
        top:
          STAGE_CENTER.top +
          OPENING.dropPx * easeOut(progressIn({ timeMs, startMs: change.dropMs, durationMs: OPENING.dropMs }))
      };
      const opacity = 1 - progressIn({ timeMs, startMs: OPENING_AT.lanes, durationMs: TIMING.fadeMs });
      pieces.push(
        dot({ at: dropped, opacity, isHollow: true }),
        ring({ at: dropped, progress: 1, color: ORANGE, opacity }),
        text({
          at: { left: dropped.left, top: dropped.top + OPENING.slotGap * HALF + STYLE.packetLabelLift * HALF },
          value: label,
          size: STYLE.valueSize,
          opacity: Math.min(opacity, labelOpacity)
        })
      );
      continue;
    }
    if (timeMs >= OPENING_AT.lanes && departureMs(change) > OPENING_AT.lanes) {
      continue;
    }
    if (timeMs >= change.landMs) {
      const landing = progressIn({ timeMs, startMs: change.landMs, durationMs: TIMING.landMs });
      const at = {
        left: mix({ from: OPENING.headX, to: TRUNK.left + TRUNK.landingDepth, progress: landing }),
        top: STAGE_CENTER.top
      };
      pieces.push(labeledDot({ at, label: labelOpacity > 0 ? label : '', opacity: 1 - landing }));
      continue;
    }
    const at = { left: lineLeft({ index, timeMs }), top: STAGE_CENTER.top };
    const checkStartMs = Math.max(lastLandingMs, change.arriveMs + OPENING.enterMs);
    pieces.push(
      dot({ at }),
      ring({ at, progress: (timeMs - checkStartMs) / OPENING.checkMs, color: GREEN_BRIGHT, opacity: ringOpacity }),
      text({
        at: { left: at.left, top: at.top - STYLE.packetLabelLift },
        value: label,
        size: STYLE.valueSize,
        opacity: labelOpacity
      })
    );
  }
  return pieces.join('');
}

function releasePackets(timeMs: number): string {
  if (timeMs < OPENING_AT.lanes) {
    return '';
  }
  const move = smooth(
    progressIn({ timeMs, startMs: OPENING_AT.lanes + OPENING.releaseDelayMs, durationMs: OPENING.splitMs })
  );
  const pieces: string[] = [];
  for (const release of RELEASE) {
    if (timeMs > release.arriveMs + TIMING.landMs) {
      continue;
    }
    const top = mix({ from: STAGE_CENTER.top, to: laneY(release.lane), progress: move });
    const flight = smooth(
      progressIn({ timeMs, startMs: release.launchMs, durationMs: release.arriveMs - release.launchMs })
    );
    const left = mix({ from: release.fromX, to: TRUNK.left + TRUNK.landingDepth, progress: flight });
    const opacity = 1 - progressIn({ timeMs, startMs: release.arriveMs, durationMs: TIMING.landMs });
    pieces.push(dot({ at: { left, top }, opacity }));
  }
  return pieces.join('');
}

// c-5 shares src/routes.mjs with c-3, so it waits for c-3 alone. The other lanes keep landing.
function dependencyPackets(timeMs: number): string {
  if (timeMs < OPENING_AT.dependency) {
    return '';
  }
  const pieces = [flightDot({ flight: DEPENDENCY_C3, timeMs })];
  const appearMs = OPENING_AT.dependency + OPENING.dependencyC5AppearMs;
  if (timeMs >= appearMs && timeMs < DEPENDENCY_C5.launchMs) {
    const entry = easeOut(progressIn({ timeMs, startMs: appearMs, durationMs: OPENING.enterMs }));
    const waiting = {
      left: mix({ from: LANE_BOX_RIGHT, to: OPENING.dependencyC5WaitX, progress: entry }),
      top: laneY(0)
    };
    const c3 = pointAlong({
      points: DEPENDENCY_C3.points,
      progress: smooth(
        progressIn({ timeMs, startMs: DEPENDENCY_C3.launchMs, durationMs: OPENING.dependencyC3FlightMs })
      )
    });
    if (timeMs < DEPENDENCY_C3.arriveMs && c3.left > waiting.left) {
      pieces.push(connector({ points: [waiting, c3], opacity: entry }));
    }
    pieces.push(labeledDot({ at: waiting, label: 'c-5', opacity: entry }));
  }
  pieces.push(flightDot({ flight: DEPENDENCY_C5, timeMs }));
  return pieces.join('');
}

function openingBrand(timeMs: number): string {
  const opacity = smooth(
    progressIn({ timeMs, startMs: OPENING_AT.brand + OPENING.brandEnterDelayMs, durationMs: TIMING.drawMs })
  );
  if (opacity <= 0) {
    return '';
  }
  return (
    logo({
      center: { left: STAGE_CENTER.left, top: STAGE_CENTER.top + OPENING.tileOffsetY },
      size: OPENING.tileSize,
      opacity
    }) +
    text({
      at: { left: STAGE_CENTER.left, top: STAGE_CENTER.top + OPENING.nameOffsetY },
      value: 'Commute',
      size: OPENING.nameSize,
      family: SANS,
      weight: OPENING.nameWeight,
      opacity
    })
  );
}

// Overlaps: changes declare their files, only a shared file gets a merge check, and its result sets the order.
const OVERLAPS = {
  changeWidth: 200,
  changeHeight: 64,
  fileX: 1_180,
  fileWidth: 380,
  fileHeight: 84,
  changesMs: 200,
  staggerMs: 140,
  declareMs: 900,
  filesMs: 1_000,
  checkPacketMs: 2_600,
  checkFlightMs: 900,
  checkMs: 3_500,
  checkDurationMs: 2_400,
  orderedDelayMs: 300,
  launchMs: 7_200,
  flightMs: 1_300,
  secondLaunchDelayMs: 200,
  parallelSpreadPx: 22,
  aloneDelayMs: 150
};
const OVERLAP_FILES = [
  { path: 'src/routes.mjs', outcome: 'ordered' },
  { path: 'src/i18n/en.json', outcome: 'parallel' },
  { path: 'src/catalog/hoodie.mjs', outcome: 'alone' }
] as const;
// Real changes of the run. Each one sits on its own row, in this order.
const OVERLAP_CHANGES = [
  { id: 'c-3', path: 'src/routes.mjs' },
  { id: 'c-5', path: 'src/routes.mjs' },
  { id: 'c-9', path: 'src/i18n/en.json' },
  { id: 'c-12', path: 'src/i18n/en.json' },
  { id: 'c-7', path: 'src/catalog/hoodie.mjs' }
] as const;

type OverlapFile = (typeof OVERLAP_FILES)[number];
type OverlapChange = (typeof OVERLAP_CHANGES)[number];

// A file sits level with the middle of the changes that declare it.
function overlapFileY(file: OverlapFile): number {
  let sum = 0;
  let count = 0;
  for (const [row, change] of OVERLAP_CHANGES.entries()) {
    if (change.path === file.path) {
      sum += laneY(row);
      count += 1;
    }
  }
  return sum / count;
}

function overlapFileOf(change: OverlapChange): OverlapFile {
  for (const file of OVERLAP_FILES) {
    if (file.path === change.path) {
      return file;
    }
  }
  throw new Error(`OVERLAP_FILE_MISSING: ${change.path}`);
}

function overlapResultMs(file: OverlapFile): number {
  const doneMs = OVERLAPS.checkMs + OVERLAPS.checkDurationMs;
  if (file.outcome === 'ordered') {
    return doneMs + OVERLAPS.orderedDelayMs;
  }
  return doneMs;
}

function overlapValue({ file, timeMs }: OverlapValueParams): string {
  if (file.outcome === 'alone' || timeMs < OVERLAPS.checkMs) {
    return '';
  }
  if (timeMs < overlapResultMs(file)) {
    return 'merge check';
  }
  if (file.outcome === 'ordered') {
    return 'c-3 → c-5';
  }
  return 'clean';
}

type OverlapValueParams = {
  file: OverlapFile;
  timeMs: number;
};

// After the checks, the clean pair lands side by side, c-5 lands after c-3, and c-7 needed no check at all.
function planOverlapFlights(): Flight[] {
  const flights: Flight[] = [];
  const fileRight = OVERLAPS.fileX + OVERLAPS.fileWidth * HALF;
  let orderedArriveMs = 0;
  for (const change of OVERLAP_CHANGES) {
    const file = overlapFileOf(change);
    let launchMs = OVERLAPS.launchMs;
    let top = overlapFileY(file);
    if (file.outcome === 'ordered' && orderedArriveMs > 0) {
      launchMs = orderedArriveMs + OVERLAPS.secondLaunchDelayMs;
    }
    if (file.outcome === 'parallel' && change.id === 'c-9') {
      top -= OVERLAPS.parallelSpreadPx;
    } else if (file.outcome === 'parallel') {
      top += OVERLAPS.parallelSpreadPx;
    }
    if (file.outcome === 'alone') {
      launchMs += OVERLAPS.aloneDelayMs;
    }
    const flight = {
      points: [{ left: fileRight, top }, intoTrunk(top)],
      launchMs,
      arriveMs: launchMs + OVERLAPS.flightMs,
      label: change.id
    };
    if (file.outcome === 'ordered' && orderedArriveMs === 0) {
      orderedArriveMs = flight.arriveMs;
    }
    flights.push(flight);
  }
  return flights;
}

const OVERLAP_FLIGHTS = planOverlapFlights();

function overlaps(timeMs: number): string {
  const lines: string[] = [];
  const packets: string[] = [];
  const boxes: string[] = [];
  const changeRight = LANES.boxCenterX + OVERLAPS.changeWidth * HALF;
  const fileLeft = OVERLAPS.fileX - OVERLAPS.fileWidth * HALF;
  for (const [row, change] of OVERLAP_CHANGES.entries()) {
    const file = overlapFileOf(change);
    const top = laneY(row);
    const declared = [
      { left: changeRight, top },
      { left: fileLeft, top: overlapFileY(file) }
    ];
    boxes.push(
      box({
        center: { left: LANES.boxCenterX, top },
        width: OVERLAPS.changeWidth,
        height: OVERLAPS.changeHeight,
        label: change.id,
        opacity: smooth(
          progressIn({ timeMs, startMs: OVERLAPS.changesMs + row * OVERLAPS.staggerMs, durationMs: TIMING.enterMs })
        )
      })
    );
    lines.push(
      connector({
        points: declared,
        progress: progressIn({
          timeMs,
          startMs: OVERLAPS.declareMs + row * OVERLAPS.staggerMs,
          durationMs: TIMING.drawMs
        })
      })
    );
    if (file.outcome !== 'alone') {
      packets.push(
        flightDot({
          flight: {
            points: declared,
            launchMs: OVERLAPS.checkPacketMs,
            arriveMs: OVERLAPS.checkPacketMs + OVERLAPS.checkFlightMs,
            label: ''
          },
          timeMs
        })
      );
    }
    const flight = OVERLAP_FLIGHTS[row];
    if (flight === undefined) {
      throw new Error('OVERLAP_FLIGHT_MISSING');
    }
    lines.push(
      connector({
        points: flight.points,
        progress: progressIn({ timeMs, startMs: overlapResultMs(file), durationMs: TIMING.drawMs })
      })
    );
    packets.push(flightDot({ flight, timeMs }));
  }
  for (const [index, file] of OVERLAP_FILES.entries()) {
    const center = { left: OVERLAPS.fileX, top: overlapFileY(file) };
    const resultMs = overlapResultMs(file);
    let alarm = 0;
    let pulse = 0;
    if (file.outcome === 'ordered') {
      alarm = pulseAfter({ timeMs, eventsMs: [resultMs] });
    } else if (file.outcome === 'parallel') {
      pulse = pulseAfter({ timeMs, eventsMs: [resultMs] });
    }
    boxes.push(
      box({
        center,
        width: OVERLAPS.fileWidth,
        height: OVERLAPS.fileHeight,
        label: file.path,
        value: overlapValue({ file, timeMs }),
        pulse,
        alarm,
        opacity: smooth(
          progressIn({ timeMs, startMs: OVERLAPS.filesMs + index * OVERLAPS.staggerMs, durationMs: TIMING.enterMs })
        )
      })
    );
    if (file.outcome !== 'alone' && timeMs >= OVERLAPS.checkMs && timeMs < resultMs) {
      const progress = progressIn({ timeMs, startMs: OVERLAPS.checkMs, durationMs: resultMs - OVERLAPS.checkMs });
      boxes.push(checkBar({ center, width: OVERLAPS.fileWidth, height: OVERLAPS.fileHeight, progress }));
    }
  }
  return [
    agents({ timeMs, entryStartMs: null, opacity: AGENTS.dimOpacity }),
    ...lines,
    ...packets,
    ...boxes,
    trunk({ pulse: pulseAfter({ timeMs, eventsMs: arrivals(OVERLAP_FLIGHTS) }) })
  ].join('');
}

type CheckBarParams = {
  center: Point;
  width: number;
  height: number;
  progress: number;
};

// A check that runs, drawn as the bottom edge of its box filling from left to right.
function checkBar({ center, width, height, progress }: CheckBarParams): string {
  const left = center.left - width * HALF;
  const top = center.top + height * HALF - STYLE.barHeight * HALF;
  const length = width * clamp01(progress);
  return `<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(length)}" height="${STYLE.barHeight}" fill="${GREEN_BRIGHT}"/>`;
}

// Resolution: the model sees both changes as line IDs and answers with IDs, so it can only pick lines.
const RESOLUTION = {
  panelWidth: 340,
  panelHeight: 220,
  leftX: 700,
  rightX: 1_420,
  panelY: 290,
  headerOffsetY: -76,
  firstLineOffsetY: -30,
  lineGap: 42,
  codeIndent: 76,
  tagIndent: 40,
  gutterIndent: 18,
  gutterWidth: 4,
  gutterHeight: 30,
  modelY: 520,
  modelWidth: 300,
  modelHeight: 96,
  resultY: 730,
  resultHeight: 240,
  resultHeaderOffsetY: -92,
  resultFirstLineOffsetY: -50,
  panelsMs: 200,
  linesMs: 600,
  lineStaggerMs: 160,
  insertMs: 1_700,
  tagsMs: 5_000,
  modelMs: 5_300,
  idsLaunchMs: 6_000,
  idsFlightMs: 1_000,
  thinkMs: 7_000,
  thinkPeriodMs: 450,
  answerMs: 8_500,
  resultMs: 11_000,
  baseLinesMs: 11_100,
  searchMoveMs: 11_500,
  ordersMoveMs: 12_100,
  moveMs: 800,
  c3LaunchMs: 13_000,
  c3FlightMs: 1_100,
  appliedDelayMs: 100,
  c5FlightMs: 900,
  topPathY: 110,
  modelInletOffset: 60
};
const BASE_LINES = ["'home',", "'cart',"];
const RESOLUTION_SIDES = [
  { id: 'c-3', left: RESOLUTION.leftX, line: "'search',", tag: 't1', moveMs: RESOLUTION.searchMoveMs },
  { id: 'c-5', left: RESOLUTION.rightX, line: "'orders',", tag: 'o1', moveMs: RESOLUTION.ordersMoveMs }
] as const;
const RESOLUTION_C3: Flight = {
  points: [
    { left: RESOLUTION.leftX, top: RESOLUTION.panelY - RESOLUTION.panelHeight * HALF },
    { left: RESOLUTION.leftX, top: RESOLUTION.topPathY },
    { left: TRUNK_CENTER.left, top: RESOLUTION.topPathY },
    { left: TRUNK_CENTER.left, top: TRUNK.top + TRUNK.landingDepth }
  ],
  launchMs: RESOLUTION.c3LaunchMs,
  arriveMs: RESOLUTION.c3LaunchMs + RESOLUTION.c3FlightMs,
  label: 'c-3'
};
const RESOLUTION_APPLIED_MS = RESOLUTION_C3.arriveMs + RESOLUTION.appliedDelayMs;
const RESOLUTION_C5: Flight = {
  points: [
    { left: STAGE_CENTER.left + RESOLUTION.panelWidth * HALF, top: RESOLUTION.resultY },
    intoTrunk(RESOLUTION.resultY)
  ],
  launchMs: RESOLUTION_APPLIED_MS,
  arriveMs: RESOLUTION_APPLIED_MS + RESOLUTION.c5FlightMs,
  label: 'c-5'
};

function codeLineY(index: number): number {
  return RESOLUTION.panelY + RESOLUTION.firstLineOffsetY + index * RESOLUTION.lineGap;
}

function resultLineY(index: number): number {
  return RESOLUTION.resultY + RESOLUTION.resultFirstLineOffsetY + index * RESOLUTION.lineGap;
}

function resolution(timeMs: number): string {
  const lines: string[] = [];
  const packets: string[] = [];
  const panels: string[] = [];
  const texts: string[] = [];
  const modelCenter = { left: STAGE_CENTER.left, top: RESOLUTION.modelY };
  const modelTop = RESOLUTION.modelY - RESOLUTION.modelHeight * HALF;
  const resultLeft = STAGE_CENTER.left - RESOLUTION.panelWidth * HALF;
  const insertIndex = BASE_LINES.length;
  for (const [sideIndex, side] of RESOLUTION_SIDES.entries()) {
    const panelLeft = side.left - RESOLUTION.panelWidth * HALF;
    const panelOpacity = smooth(
      progressIn({
        timeMs,
        startMs: RESOLUTION.panelsMs + sideIndex * RESOLUTION.lineStaggerMs,
        durationMs: TIMING.enterMs
      })
    );
    panels.push(
      box({
        center: { left: side.left, top: RESOLUTION.panelY },
        width: RESOLUTION.panelWidth,
        height: RESOLUTION.panelHeight,
        pulse: side.id === 'c-3' ? pulseAfter({ timeMs, eventsMs: [RESOLUTION_C3.launchMs] }) : 0,
        opacity: panelOpacity
      }),
      text({
        at: { left: side.left, top: RESOLUTION.panelY + RESOLUTION.headerOffsetY },
        value: side.id,
        opacity: panelOpacity
      })
    );
    for (const [lineIndex, value] of [...BASE_LINES, side.line].entries()) {
      const opacity = progressIn({
        timeMs,
        startMs: RESOLUTION.linesMs + lineIndex * RESOLUTION.lineStaggerMs,
        durationMs: TIMING.enterMs
      });
      texts.push(
        text({
          at: { left: panelLeft + RESOLUTION.codeIndent, top: codeLineY(lineIndex) },
          value,
          size: STYLE.codeSize,
          anchor: 'start',
          opacity
        })
      );
    }
    const insertY = codeLineY(insertIndex);
    const gutter = progressIn({ timeMs, startMs: RESOLUTION.insertMs, durationMs: TIMING.enterMs });
    if (gutter > 0) {
      texts.push(
        `<rect x="${fmt(panelLeft + RESOLUTION.gutterIndent)}" y="${fmt(insertY - RESOLUTION.gutterHeight * HALF)}" width="${RESOLUTION.gutterWidth}" height="${RESOLUTION.gutterHeight}" fill="${ORANGE}" opacity="${alpha(gutter)}"/>`
      );
    }
    const tagAt = { left: panelLeft + RESOLUTION.tagIndent, top: insertY };
    texts.push(
      text({
        at: tagAt,
        value: side.tag,
        size: STYLE.tagSize,
        color: ORANGE,
        opacity: progressIn({ timeMs, startMs: RESOLUTION.tagsMs, durationMs: TIMING.enterMs })
      })
    );
    const inletX = modelCenter.left + (sideIndex === 0 ? -RESOLUTION.modelInletOffset : RESOLUTION.modelInletOffset);
    const outletX = sideIndex === 0 ? panelLeft + RESOLUTION.panelWidth : panelLeft;
    const idPath = [
      { left: outletX, top: insertY },
      { left: inletX, top: modelTop }
    ];
    lines.push(
      connector({
        points: idPath,
        progress: progressIn({ timeMs, startMs: RESOLUTION.modelMs, durationMs: TIMING.drawMs })
      })
    );
    const idFlight: Flight = {
      points: idPath,
      launchMs: RESOLUTION.idsLaunchMs,
      arriveMs: RESOLUTION.idsLaunchMs + RESOLUTION.idsFlightMs,
      label: side.tag
    };
    packets.push(flightDot({ flight: idFlight, timeMs }));
    const move = smooth(progressIn({ timeMs, startMs: side.moveMs, durationMs: RESOLUTION.moveMs }));
    if (move > 0) {
      // The line drops beside the result, then slides in, so it never crosses the result's header.
      const targetTop = resultLineY(insertIndex + sideIndex);
      const path = [
        { left: panelLeft + RESOLUTION.codeIndent, top: insertY },
        { left: panelLeft + RESOLUTION.codeIndent, top: targetTop },
        { left: resultLeft + RESOLUTION.codeIndent, top: targetTop }
      ];
      texts.push(
        text({
          at: pointAlong({ points: path, progress: move }),
          value: side.line,
          size: STYLE.codeSize,
          anchor: 'start'
        })
      );
    }
  }
  const thinking =
    timeMs >= RESOLUTION.thinkMs && timeMs < RESOLUTION.answerMs
      ? HALF + HALF * Math.sin(((timeMs - RESOLUTION.thinkMs) / RESOLUTION.thinkPeriodMs) * Math.PI)
      : 0;
  panels.push(
    box({
      center: modelCenter,
      width: RESOLUTION.modelWidth,
      height: RESOLUTION.modelHeight,
      label: 'WORKERS AI',
      value: timeMs >= RESOLUTION.answerMs ? '[ t1, o1 ]' : '',
      pulse: Math.max(thinking, pulseAfter({ timeMs, eventsMs: [RESOLUTION.answerMs] })),
      opacity: smooth(progressIn({ timeMs, startMs: RESOLUTION.modelMs, durationMs: TIMING.enterMs }))
    })
  );
  const resultOpacity = smooth(progressIn({ timeMs, startMs: RESOLUTION.resultMs, durationMs: TIMING.enterMs }));
  panels.push(
    box({
      center: { left: STAGE_CENTER.left, top: RESOLUTION.resultY },
      width: RESOLUTION.panelWidth,
      height: RESOLUTION.resultHeight,
      pulse: pulseAfter({ timeMs, eventsMs: [RESOLUTION_APPLIED_MS] }),
      opacity: resultOpacity
    }),
    text({
      at: { left: STAGE_CENTER.left, top: RESOLUTION.resultY + RESOLUTION.resultHeaderOffsetY },
      value: 'src/routes.mjs',
      opacity: resultOpacity
    })
  );
  for (const [lineIndex, value] of BASE_LINES.entries()) {
    texts.push(
      text({
        at: { left: resultLeft + RESOLUTION.codeIndent, top: resultLineY(lineIndex) },
        value,
        size: STYLE.codeSize,
        anchor: 'start',
        opacity: progressIn({ timeMs, startMs: RESOLUTION.baseLinesMs, durationMs: TIMING.enterMs })
      })
    );
  }
  lines.push(
    connector({
      points: RESOLUTION_C3.points,
      progress: progressIn({ timeMs, startMs: RESOLUTION_C3.launchMs - TIMING.drawMs, durationMs: TIMING.drawMs })
    }),
    connector({
      points: RESOLUTION_C5.points,
      progress: progressIn({ timeMs, startMs: RESOLUTION_C5.launchMs - TIMING.drawMs, durationMs: TIMING.drawMs })
    })
  );
  packets.push(flightDot({ flight: RESOLUTION_C3, timeMs }), flightDot({ flight: RESOLUTION_C5, timeMs }));
  return [
    agents({ timeMs, entryStartMs: null, opacity: AGENTS.dimOpacity }),
    ...lines,
    ...panels,
    ...texts,
    ...packets,
    trunk({ pulse: pulseAfter({ timeMs, eventsMs: [RESOLUTION_C3.arriveMs, RESOLUTION_C5.arriveMs] }) })
  ].join('');
}

// Batches: changes that commute gather into one batch, and one approval lands all of them at once.
const BATCH = {
  size: 320,
  labelOffsetY: -122,
  slotGap: 52,
  slotOffsetY: 22,
  slotColumns: 4,
  gatherMs: 400,
  gatherStaggerMs: 140,
  gatherFlightMs: 1_000,
  approveMs: 4_500,
  checkRadius: 22,
  checkInset: 40,
  checkStroke: 4,
  launchMs: 5_000,
  launchStaggerMs: 70,
  flightMs: 1_000,
  shuffleStride: 7,
  columnStride: 4,
  rowStride: 7,
  rowOffset: 2,
  spreadTop: 200,
  spreadGap: 36
};
const BATCH_TOTAL = 16;
const CHANGE_TOTAL = 20;

function batchSlot(index: number): Point {
  const column = index % BATCH.slotColumns;
  const row = Math.floor(index / BATCH.slotColumns);
  const middle = (BATCH.slotColumns - 1) * HALF;
  return {
    left: STAGE_CENTER.left + (column - middle) * BATCH.slotGap,
    top: STAGE_CENTER.top + BATCH.slotOffsetY + (row - middle) * BATCH.slotGap
  };
}

type BatchPlan = {
  gathers: Flight[];
  landings: Flight[];
};

function planBatch(): BatchPlan {
  const gathers: Flight[] = [];
  const landings: Flight[] = [];
  for (let index = 0; index < BATCH_TOTAL; index += 1) {
    const cell = {
      column: (index * BATCH.columnStride) % AGENTS.columns,
      row: (index * BATCH.rowStride + BATCH.rowOffset) % AGENTS.rows
    };
    const gatherMs = BATCH.gatherMs + index * BATCH.gatherStaggerMs;
    gathers.push({
      points: [agentCenter(cell), batchSlot(index)],
      launchMs: gatherMs,
      arriveMs: gatherMs + BATCH.gatherFlightMs,
      label: ''
    });
    const rank = (index * BATCH.shuffleStride) % BATCH_TOTAL;
    const launchMs = BATCH.launchMs + rank * BATCH.launchStaggerMs;
    landings.push({
      points: [batchSlot(index), intoTrunk(BATCH.spreadTop + rank * BATCH.spreadGap)],
      launchMs,
      arriveMs: launchMs + BATCH.flightMs,
      label: ''
    });
  }
  return { gathers, landings };
}

const BATCH_PLAN = planBatch();

function batch(timeMs: number): string {
  const packets: string[] = [];
  for (const [index, gather] of BATCH_PLAN.gathers.entries()) {
    const landing = BATCH_PLAN.landings[index];
    if (landing === undefined) {
      throw new Error('BATCH_LANDING_MISSING');
    }
    if (timeMs < gather.arriveMs) {
      packets.push(flightDot({ flight: { ...gather, arriveMs: gather.arriveMs + TIMING.landMs }, timeMs }));
    } else if (timeMs < landing.launchMs) {
      packets.push(dot({ at: batchSlot(index) }));
    } else {
      packets.push(flightDot({ flight: landing, timeMs }));
    }
  }
  const boxOpacity = smooth(progressIn({ timeMs, startMs: 0, durationMs: TIMING.enterMs }));
  const approval = smooth(progressIn({ timeMs, startMs: BATCH.approveMs, durationMs: TIMING.enterMs }));
  const checkCenter = {
    left: STAGE_CENTER.left + BATCH.size * HALF - BATCH.checkInset,
    top: STAGE_CENTER.top - BATCH.size * HALF + BATCH.checkInset
  };
  const landed = landedCount({ flights: BATCH_PLAN.landings, timeMs });
  return [
    agents({ timeMs, entryStartMs: null, opacity: 1 }),
    box({
      center: STAGE_CENTER,
      width: BATCH.size,
      height: BATCH.size,
      pulse: pulseAfter({ timeMs, eventsMs: [BATCH.approveMs] }),
      opacity: boxOpacity
    }),
    text({
      at: { left: STAGE_CENTER.left, top: STAGE_CENTER.top + BATCH.labelOffsetY },
      value: 'BATCH 1',
      opacity: boxOpacity
    }),
    approvalMark({ center: checkCenter, opacity: approval }),
    ...packets,
    trunk({
      value: `${landed} / ${BATCH_TOTAL}`,
      pulse: pulseAfter({ timeMs, eventsMs: arrivals(BATCH_PLAN.landings) })
    })
  ].join('');
}

type ApprovalMarkParams = {
  center: Point;
  opacity: number;
};

function approvalMark({ center, opacity }: ApprovalMarkParams): string {
  if (opacity <= 0) {
    return '';
  }
  const radius = BATCH.checkRadius;
  const tick = `M${fmt(center.left - radius * HALF)} ${fmt(center.top)}l${fmt(radius * CHECK_TICK.short)} ${fmt(radius * CHECK_TICK.short)}l${fmt(radius * CHECK_TICK.long)} ${fmt(-radius * CHECK_TICK.long)}`;
  return `<g opacity="${alpha(opacity)}"><circle cx="${fmt(center.left)}" cy="${fmt(center.top)}" r="${radius}" fill="${BACKGROUND}" stroke="${GREEN_BRIGHT}" stroke-width="${BATCH.checkStroke}"/><path d="${tick}" fill="none" stroke="${GREEN_BRIGHT}" stroke-width="${BATCH.checkStroke}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// Checks: each check result is saved under the hashes of the folders it reads. A landing changes one hash, so only
// that check runs again.
const CHECKS = {
  folderX: 760,
  folderWidth: 400,
  checkX: 1_300,
  checkWidth: 300,
  rowHeight: 64,
  firstRowY: 216,
  rowGap: 96,
  textInset: 26,
  rowsMs: 200,
  rowStaggerMs: 110,
  hashesMs: 1_400,
  hashStaggerMs: 120,
  hashTypeMs: 360,
  linesMs: 2_300,
  checksMs: 2_500,
  savePacketMs: 3_100,
  saveFlightMs: 800,
  saveStaggerMs: 90,
  landingLaunchMs: 6_900,
  landingFlightMs: 1_200,
  landingPathY: 780,
  hashFlipMs: 8_300,
  flipMs: 400,
  rerunMs: 8_700,
  rerunDurationMs: 1_500,
  keptMs: 8_700,
  staleOpacity: 0.3
};
const CHECK_ROWS = [
  { folder: 'src/routes.mjs', check: 'routes', hash: '7c7959', changedHash: 'c51183' },
  { folder: 'src/cart', check: 'cart', hash: 'd7e7df', changedHash: null },
  { folder: 'src/catalog', check: 'catalog', hash: '74c53e', changedHash: null },
  { folder: 'src/search', check: 'search', hash: '60c7e5', changedHash: null },
  { folder: 'src/i18n', check: 'i18n', hash: 'de5fa5', changedHash: null },
  { folder: 'docs', check: 'docs', hash: '4d2c05', changedHash: null }
];
const CHECKS_LANDING: Flight = {
  points: [{ left: AGENTS.edgeX, top: CHECKS.landingPathY }, intoTrunk(CHECKS.landingPathY)],
  launchMs: CHECKS.landingLaunchMs,
  arriveMs: CHECKS.landingLaunchMs + CHECKS.landingFlightMs,
  label: 'c-3'
};

function checks(timeMs: number): string {
  const lines: string[] = [];
  const packets: string[] = [];
  const boxes: string[] = [];
  const folderLeft = CHECKS.folderX - CHECKS.folderWidth * HALF;
  const folderRight = CHECKS.folderX + CHECKS.folderWidth * HALF;
  const checkLeft = CHECKS.checkX - CHECKS.checkWidth * HALF;
  const checkRight = CHECKS.checkX + CHECKS.checkWidth * HALF;
  for (const [index, row] of CHECK_ROWS.entries()) {
    const top = CHECKS.firstRowY + index * CHECKS.rowGap;
    const rowOpacity = smooth(
      progressIn({ timeMs, startMs: CHECKS.rowsMs + index * CHECKS.rowStaggerMs, durationMs: TIMING.enterMs })
    );
    const hashStartMs = CHECKS.hashesMs + index * CHECKS.hashStaggerMs;
    const typed = Math.round(
      row.hash.length * progressIn({ timeMs, startMs: hashStartMs, durationMs: CHECKS.hashTypeMs })
    );
    // The old hash fades out and the new one fades in, so the change reads as one flip.
    const flip = progressIn({ timeMs, startMs: CHECKS.hashFlipMs, durationMs: CHECKS.flipMs });
    let hash = row.hash.slice(0, typed);
    let hashOpacity = rowOpacity;
    if (row.changedHash !== null && flip > 0) {
      hashOpacity = Math.abs(1 - flip * DOUBLE);
      if (flip >= HALF) {
        hash = row.changedHash;
      }
    }
    boxes.push(
      `<g opacity="${alpha(rowOpacity)}">${boxFrame({ center: { left: CHECKS.folderX, top }, width: CHECKS.folderWidth, height: CHECKS.rowHeight, pulse: row.changedHash === null ? 0 : pulseAfter({ timeMs, eventsMs: [CHECKS.hashFlipMs + CHECKS.flipMs] }), alarm: 0 })}</g>`,
      text({
        at: { left: folderLeft + CHECKS.textInset, top },
        value: row.folder,
        anchor: 'start',
        opacity: rowOpacity
      }),
      text({
        at: { left: folderRight - CHECKS.textInset, top },
        value: hash,
        anchor: 'end',
        opacity: hashOpacity
      })
    );
    const linkPath = [
      { left: folderRight, top },
      { left: checkLeft, top }
    ];
    lines.push(
      connector({
        points: linkPath,
        progress: progressIn({
          timeMs,
          startMs: CHECKS.linesMs + index * CHECKS.rowStaggerMs,
          durationMs: TIMING.drawMs
        })
      })
    );
    const saveLaunchMs = CHECKS.savePacketMs + index * CHECKS.saveStaggerMs;
    const savedMs = saveLaunchMs + CHECKS.saveFlightMs;
    packets.push(
      flightDot({ flight: { points: linkPath, launchMs: saveLaunchMs, arriveMs: savedMs, label: '' }, timeMs })
    );
    const isRerun = row.changedHash !== null && timeMs >= CHECKS.rerunMs;
    const rerunDoneMs = CHECKS.rerunMs + CHECKS.rerunDurationMs;
    let stored = timeMs >= savedMs ? `✓ ${row.hash}` : '';
    let storedOpacity = 1;
    let pulse = pulseAfter({ timeMs, eventsMs: [savedMs] });
    if (row.changedHash === null) {
      pulse = Math.max(pulse, pulseAfter({ timeMs, eventsMs: [CHECKS.keptMs] }));
    } else if (isRerun && timeMs < rerunDoneMs) {
      storedOpacity = CHECKS.staleOpacity;
    } else if (isRerun) {
      stored = `✓ ${row.changedHash}`;
      pulse = pulseAfter({ timeMs, eventsMs: [rerunDoneMs] });
    }
    const checkOpacity = smooth(
      progressIn({ timeMs, startMs: CHECKS.checksMs + index * CHECKS.rowStaggerMs, durationMs: TIMING.enterMs })
    );
    const checkCenter = { left: CHECKS.checkX, top };
    boxes.push(
      `<g opacity="${alpha(checkOpacity)}">${boxFrame({ center: checkCenter, width: CHECKS.checkWidth, height: CHECKS.rowHeight, pulse, alarm: 0 })}</g>`,
      text({
        at: { left: checkLeft + CHECKS.textInset, top },
        value: row.check,
        anchor: 'start',
        opacity: checkOpacity
      }),
      text({
        at: { left: checkRight - CHECKS.textInset, top },
        value: stored,
        anchor: 'end',
        size: STYLE.valueSize,
        opacity: checkOpacity * storedOpacity
      })
    );
    if (isRerun && timeMs < rerunDoneMs) {
      boxes.push(
        checkBar({
          center: checkCenter,
          width: CHECKS.checkWidth,
          height: CHECKS.rowHeight,
          progress: progressIn({ timeMs, startMs: CHECKS.rerunMs, durationMs: CHECKS.rerunDurationMs })
        })
      );
    }
  }
  lines.push(
    connector({
      points: CHECKS_LANDING.points,
      progress: progressIn({ timeMs, startMs: CHECKS.landingLaunchMs - TIMING.drawMs, durationMs: TIMING.drawMs })
    })
  );
  packets.push(flightDot({ flight: CHECKS_LANDING, timeMs }));
  return [
    agents({ timeMs, entryStartMs: null, opacity: AGENTS.dimOpacity }),
    ...lines,
    ...packets,
    ...boxes,
    trunk({ pulse: pulseAfter({ timeMs, eventsMs: [CHECKS_LANDING.arriveMs] }) })
  ].join('');
}

// Everything lands: four batches, twenty changes.
const EVERYTHING = {
  firstWaveMs: 300,
  waveGapMs: 800,
  waveSize: 5,
  launchStaggerMs: 60,
  flightMs: 1_100,
  columnStride: 5,
  rowStride: 3,
  spreadTop: 190,
  spreadGap: 30
};

function planEverything(): Flight[] {
  const flights: Flight[] = [];
  for (let index = 0; index < CHANGE_TOTAL; index += 1) {
    const wave = Math.floor(index / EVERYTHING.waveSize);
    const launchMs =
      EVERYTHING.firstWaveMs + wave * EVERYTHING.waveGapMs + (index % EVERYTHING.waveSize) * EVERYTHING.launchStaggerMs;
    const cell = {
      column: (index * EVERYTHING.columnStride) % AGENTS.columns,
      row: (index * EVERYTHING.rowStride + 1) % AGENTS.rows
    };
    flights.push({
      points: [agentCenter(cell), intoTrunk(EVERYTHING.spreadTop + index * EVERYTHING.spreadGap)],
      launchMs,
      arriveMs: launchMs + EVERYTHING.flightMs,
      label: ''
    });
  }
  return flights;
}

const EVERYTHING_FLIGHTS = planEverything();

function everything(timeMs: number): string {
  const landed = landedCount({ flights: EVERYTHING_FLIGHTS, timeMs });
  return [
    agents({ timeMs, entryStartMs: null, opacity: 1 }),
    ...EVERYTHING_FLIGHTS.map((flight) => flightDot({ flight, timeMs })),
    trunk({
      value: `${landed} / ${CHANGE_TOTAL}`,
      pulse: pulseAfter({ timeMs, eventsMs: arrivals(EVERYTHING_FLIGHTS) })
    })
  ].join('');
}

// What the agents saw: Alice's and Bob's agents step forward, and each change passes through the three commands its
// agent runs.
const AGENT_SCENE = {
  scale: 3,
  targetX: 600,
  laneOffset: 150,
  laneStaggerMs: 350,
  moveMs: 200,
  moveDurationMs: 800,
  firstBoxX: 880,
  boxGap: 280,
  boxWidth: 240,
  boxHeight: 72,
  boxesMs: 900,
  boxStaggerMs: 450,
  linesMs: 1_100,
  launchMs: 2_500,
  flightMs: 1_900,
  iconGap: 16,
  nameGap: 30
};
const AGENT_COMMANDS = ['commute start', 'git push', 'commute wait'];
// Alice's agent takes the upper lane and Bob's agent the lower one, as in the side-by-side sessions that follow.
const AGENT_LANES = [
  { cell: { column: 2, row: 4 }, side: -1, name: "Alice's agent" },
  { cell: { column: 6, row: 10 }, side: 1, name: "Bob's agent" }
];

function agentCommands(timeMs: number): string {
  const move = smooth(progressIn({ timeMs, startMs: AGENT_SCENE.moveMs, durationMs: AGENT_SCENE.moveDurationMs }));
  const bigSize = AGENTS.iconSize * AGENT_SCENE.scale;
  const scale = mix({ from: 1, to: AGENT_SCENE.scale, progress: move });
  const appear = (startMs: number): number => smooth(progressIn({ timeMs, startMs, durationMs: TIMING.enterMs }));
  const parts = [
    agents({ timeMs, entryStartMs: null, opacity: mix({ from: 1, to: AGENTS.dimOpacity, progress: move }) })
  ];
  const arrivalsMs: number[] = [];
  for (const [laneIndex, lane] of AGENT_LANES.entries()) {
    const laneMs = laneIndex * AGENT_SCENE.laneStaggerMs;
    const top = STAGE_CENTER.top + lane.side * AGENT_SCENE.laneOffset;
    const from = agentOrigin(lane.cell);
    const to = { left: AGENT_SCENE.targetX - bigSize * HALF, top: top - bigSize * HALF };
    const origin = {
      left: mix({ from: from.left, to: to.left, progress: move }),
      top: mix({ from: from.top, to: to.top, progress: move })
    };
    const route: Point[] = [{ left: AGENT_SCENE.targetX + bigSize * HALF + AGENT_SCENE.iconGap, top }];
    const boxes: string[] = [];
    for (const [index, command] of AGENT_COMMANDS.entries()) {
      const center = { left: AGENT_SCENE.firstBoxX + index * AGENT_SCENE.boxGap, top };
      route.push(center);
      boxes.push(
        box({
          center,
          width: AGENT_SCENE.boxWidth,
          height: AGENT_SCENE.boxHeight,
          label: command,
          opacity: appear(AGENT_SCENE.boxesMs + laneMs + index * AGENT_SCENE.boxStaggerMs)
        })
      );
    }
    route.push(intoTrunk(top));
    const launchMs = AGENT_SCENE.launchMs + laneMs;
    const flight: Flight = { points: route, launchMs, arriveMs: launchMs + AGENT_SCENE.flightMs, label: '' };
    arrivalsMs.push(flight.arriveMs);
    parts.push(
      connector({
        points: route,
        progress: progressIn({ timeMs, startMs: AGENT_SCENE.linesMs + laneMs, durationMs: TIMING.drawMs })
      }),
      flightDot({ flight, timeMs }),
      ...boxes,
      agentIcon({ origin, opacity: 1, scale }),
      text({
        at: { left: AGENT_SCENE.targetX, top: top + bigSize * HALF + AGENT_SCENE.nameGap },
        value: lane.name,
        opacity: appear(AGENT_SCENE.moveMs + AGENT_SCENE.moveDurationMs)
      })
    );
  }
  parts.push(trunk({ pulse: pulseAfter({ timeMs, eventsMs: arrivalsMs }) }));
  return parts.join('');
}

// How Commute runs on Cloudflare. Trunk turns into Artifacts, which holds trunk and one repository per change.
const ARCH = {
  boxHeight: 72,
  workers: { left: 700, top: STAGE_CENTER.top, width: 240 },
  durableObject: { left: 1_040, top: STAGE_CENTER.top, width: 280 },
  workersAi: { left: 1_400, top: 300, width: 240 },
  containers: { left: 1_400, top: 660, width: 240 },
  elbowX: 1_240,
  bottomY: 780,
  labelY: 210,
  chipWidth: 112,
  chipHeight: 40,
  chipTop: 270,
  chipGap: 54,
  chipSize: 20,
  chipStroke: 2,
  relabelMs: 300,
  chipsMs: 1_200,
  chipStaggerMs: 180,
  workersMs: 700,
  workersLinesMs: 1_300,
  flowMs: 2_400,
  doMs: 7_700,
  aiMs: 8_500,
  containersMs: 9_300,
  secondFlowMs: 10_200,
  flowPeriodMs: 1_700,
  flowFlightMs: 1_500,
  flowsMax: 12,
  routeOffsetMs: 550
};
const ARTIFACT_CHIPS = ['trunk', 'c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7'];
const ARCH_PATHS = {
  agentsToWorkers: [
    { left: AGENTS.edgeX, top: STAGE_CENTER.top },
    { left: ARCH.workers.left - ARCH.workers.width * HALF, top: STAGE_CENTER.top }
  ],
  workersToArtifacts: [
    { left: ARCH.workers.left, top: STAGE_CENTER.top + ARCH.boxHeight * HALF },
    { left: ARCH.workers.left, top: ARCH.bottomY },
    { left: TRUNK.left, top: ARCH.bottomY }
  ],
  workersToDo: [
    { left: ARCH.workers.left + ARCH.workers.width * HALF, top: STAGE_CENTER.top },
    { left: ARCH.durableObject.left - ARCH.durableObject.width * HALF, top: STAGE_CENTER.top }
  ],
  doToAi: [
    { left: ARCH.durableObject.left + ARCH.durableObject.width * HALF, top: STAGE_CENTER.top },
    { left: ARCH.elbowX, top: STAGE_CENTER.top },
    { left: ARCH.elbowX, top: ARCH.workersAi.top },
    { left: ARCH.workersAi.left - ARCH.workersAi.width * HALF, top: ARCH.workersAi.top }
  ],
  doToContainers: [
    { left: ARCH.durableObject.left + ARCH.durableObject.width * HALF, top: STAGE_CENTER.top },
    { left: ARCH.elbowX, top: STAGE_CENTER.top },
    { left: ARCH.elbowX, top: ARCH.containers.top },
    { left: ARCH.containers.left - ARCH.containers.width * HALF, top: ARCH.containers.top }
  ],
  containersToArtifacts: [
    { left: ARCH.containers.left + ARCH.containers.width * HALF, top: ARCH.containers.top },
    { left: TRUNK.left, top: ARCH.containers.top }
  ]
};
// Changes travel these routes. Each route passes behind the boxes on its way.
const ARCH_ROUTES = [
  {
    startMs: ARCH.flowMs,
    points: [
      { left: AGENTS.edgeX, top: STAGE_CENTER.top },
      { left: ARCH.workers.left, top: STAGE_CENTER.top },
      { left: ARCH.workers.left, top: ARCH.bottomY },
      intoTrunk(ARCH.bottomY)
    ]
  },
  {
    startMs: ARCH.secondFlowMs,
    points: [
      { left: ARCH.workers.left, top: STAGE_CENTER.top },
      { left: ARCH.elbowX, top: STAGE_CENTER.top },
      { left: ARCH.elbowX, top: ARCH.containers.top },
      intoTrunk(ARCH.containers.top)
    ]
  },
  {
    startMs: ARCH.secondFlowMs + ARCH.routeOffsetMs,
    points: [
      { left: ARCH.durableObject.left, top: STAGE_CENTER.top },
      { left: ARCH.elbowX, top: STAGE_CENTER.top },
      { left: ARCH.elbowX, top: ARCH.workersAi.top },
      { left: ARCH.workersAi.left, top: ARCH.workersAi.top }
    ]
  }
];

function planArchitecture(): Flight[] {
  const flights: Flight[] = [];
  for (const route of ARCH_ROUTES) {
    for (let index = 0; index < ARCH.flowsMax; index += 1) {
      const launchMs = route.startMs + index * ARCH.flowPeriodMs;
      flights.push({ points: route.points, launchMs, arriveMs: launchMs + ARCH.flowFlightMs, label: '' });
    }
  }
  return flights;
}

const ARCH_FLIGHTS = planArchitecture();

type ArchNodeParams = {
  center: Point;
  width: number;
  label: string;
  startMs: number;
};

function architecture(timeMs: number): string {
  const appear = (startMs: number): number => smooth(progressIn({ timeMs, startMs, durationMs: TIMING.enterMs }));
  const draw = (startMs: number): number => progressIn({ timeMs, startMs, durationMs: TIMING.drawMs });
  const relabel = progressIn({ timeMs, startMs: ARCH.relabelMs, durationMs: TIMING.enterMs });
  const chips = ARTIFACT_CHIPS.map((chip, index) => {
    const opacity = appear(ARCH.chipsMs + index * ARCH.chipStaggerMs);
    const center = { left: TRUNK_CENTER.left, top: ARCH.chipTop + index * ARCH.chipGap };
    return `<g opacity="${alpha(opacity)}"><rect x="${fmt(center.left - ARCH.chipWidth * HALF)}" y="${fmt(center.top - ARCH.chipHeight * HALF)}" width="${ARCH.chipWidth}" height="${ARCH.chipHeight}" fill="${BOX_FILL}" stroke="${GREEN}" stroke-width="${ARCH.chipStroke}"/></g>${text({ at: center, value: chip, size: ARCH.chipSize, opacity })}`;
  });
  const node = ({ center, width, label, startMs }: ArchNodeParams): string =>
    box({ center, width, height: ARCH.boxHeight, label, opacity: appear(startMs) });
  return [
    agents({ timeMs, entryStartMs: null, opacity: 1 }),
    connector({ points: ARCH_PATHS.agentsToWorkers, progress: draw(ARCH.workersLinesMs) }),
    connector({ points: ARCH_PATHS.workersToArtifacts, progress: draw(ARCH.workersLinesMs) }),
    connector({ points: ARCH_PATHS.workersToDo, progress: draw(ARCH.doMs) }),
    connector({ points: ARCH_PATHS.doToAi, progress: draw(ARCH.aiMs) }),
    connector({ points: ARCH_PATHS.doToContainers, progress: draw(ARCH.containersMs) }),
    connector({ points: ARCH_PATHS.containersToArtifacts, progress: draw(ARCH.containersMs) }),
    ...ARCH_FLIGHTS.map((flight) => flightDot({ flight, timeMs })),
    node({ center: ARCH.workers, width: ARCH.workers.width, label: 'WORKERS', startMs: ARCH.workersMs }),
    node({ center: ARCH.durableObject, width: ARCH.durableObject.width, label: 'DURABLE OBJECT', startMs: ARCH.doMs }),
    node({ center: ARCH.workersAi, width: ARCH.workersAi.width, label: 'WORKERS AI', startMs: ARCH.aiMs }),
    node({ center: ARCH.containers, width: ARCH.containers.width, label: 'CONTAINERS', startMs: ARCH.containersMs }),
    trunk({ label: '', pulse: pulseAfter({ timeMs, eventsMs: arrivals(ARCH_FLIGHTS) }) }),
    text({ at: TRUNK_CENTER, value: 'TRUNK', opacity: 1 - relabel }),
    text({ at: { left: TRUNK_CENTER.left, top: ARCH.labelY }, value: 'ARTIFACTS', opacity: relabel }),
    ...chips
  ].join('');
}

// The end card: the architecture clears, and the mark, the name, and the repository stay.
const END = {
  clearMs: 700,
  enterDelayMs: 500,
  tileY: 330,
  tileSize: 120,
  nameY: 476,
  nameSize: 112,
  nameWeight: 650,
  urlY: 590,
  urlSize: 36,
  risePx: 16
};
const ARCH_DURATION_MS = sceneStartMs({ scenes: CLOSING_SCENES, visual: 'end' });

function endCard(timeMs: number): string {
  const clear = 1 - smooth(progressIn({ timeMs, startMs: 0, durationMs: END.clearMs }));
  const enter = smooth(progressIn({ timeMs, startMs: END.enterDelayMs, durationMs: TIMING.drawMs }));
  const rise = (1 - enter) * END.risePx;
  return [
    `<g opacity="${alpha(clear)}">${architecture(ARCH_DURATION_MS + timeMs)}</g>`,
    logo({ center: { left: VIDEO_WIDTH * HALF, top: END.tileY + rise }, size: END.tileSize, opacity: enter }),
    text({
      at: { left: VIDEO_WIDTH * HALF, top: END.nameY + rise },
      value: 'Commute',
      size: END.nameSize,
      family: SANS,
      weight: END.nameWeight,
      opacity: enter
    }),
    text({
      at: { left: VIDEO_WIDTH * HALF, top: END.urlY + rise },
      value: 'github.com/lucrise-llc/commute',
      size: END.urlSize,
      opacity: enter
    })
  ].join('');
}

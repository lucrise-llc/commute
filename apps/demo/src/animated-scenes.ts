import type { Page } from 'playwright';

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import type { FrameEntry } from './clips.ts';

import { FADE_MS, FRAME_MS } from './clips.ts';
import { captionMarkup, htmlDocument, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

const BACKGROUND = '#101010';
const BLUE = '#1868bc';
const GREEN = '#2dc242';
const ORANGE = '#df3d17';
const WHITE = '#f4fcf3';
const GREY = '#5e5e5e';
const CAPTION_HEIGHT = 120;
const ART_HEIGHT = VIDEO_HEIGHT - CAPTION_HEIGHT;
const FRAME_DIGITS = 6;
const SHEET_COLUMNS = 2;
const SHEET_SAMPLE_COUNT = 6;
const READING_CHARS_PER_SECOND = 15;
const READING_LEAD_MS = 300;
const MS_PER_SECOND = 1_000;
const GRID_COLUMNS = 25;
const GRID_ROWS = 9;
const GRID_GAP_X = 57;
const GRID_GAP_Y = 60;
const GRID_START_X = 265;
const GRID_START_Y = 195;
const MOTION = {
  enterMs: 650,
  enterLeadMs: 180,
  staggerMs: 22,
  gridDriftPx: 18,
  gridDriftPeriodMs: 1_900,
  gridVerticalDriftPx: 9,
  gridVerticalPeriodMs: 2_200,
  flowIrregularity: 0.35,
  flowWave: 1.7,
  packetPeriodMs: 2_300,
  packetRadius: 6,
  packetCount: 5,
  queueCount: 36,
  queueSpacing: 25,
  landingIntervalMs: 1_700,
  batchApprovalMs: 4_200,
  batchFlightMs: 1_800,
  batchStaggerMs: 65,
  batchCount: 16,
  overlapPathsMs: 1_300,
  overlapMergeMs: 3_000,
  overlapResultMs: 7_200,
  conflictLandingMs: 2_000,
  conflictDiscoveryMs: 3_300,
  resolutionAnswerMs: 8_000,
  resolutionApplyMs: 11_000,
  resolutionModelMs: 4_700,
  checkLandingMs: 6_700,
  checkSaveMs: 900,
  checkHashMs: 7_350,
  checkRunMs: 8_200,
  checkPassMs: 9_800,
  lineProgress: 1,
  half: 0.5,
  fontBaselineDivisor: 3,
  boxInset: 8,
  boxInsetPair: 16,
  iconCapLeft: 7,
  iconCapWidth: 10,
  iconBodyTop: 13,
  iconBodyWidth: 11,
  iconRight: 13,
  iconSize: 24,
  iconDotRadius: 3,
  iconRise: 70,
  gridStaggerMs: 9,
  gridEnterMs: 850,
  brandGridOpacity: 0.16,
  ambientGridOpacity: 0.16,
  overlapOtherDelaySteps: 13,
  architectureCoordinatorDelaySteps: 11,
  architectureContainersDelaySteps: 13,
  architectureResolverDelaySteps: 13,
  labelEnterDistance: 32,
  oneOpacity: 1,
  sceneHeadingLeft: 160,
  sceneHeadingTop: 115,
  sceneHeadingRuleTop: 145,
  sceneHeadingRuleRight: 1_760,
  sceneHeadingFontSize: 45,
  sceneHeadingLetterSpacing: 3,
  gridUpperScale: 0.9,
  gridUpperLeft: -90,
  gridUpperTop: -40,
  gridUpperOpacity: 0.65
};
const EASING = { cubic: 3, double: 2 };
const SVG_STYLE = {
  hatchWidth: 12,
  hatchAngle: 35,
  hatchStrokeWidth: 2,
  boxStrokeWidth: 3,
  boxDash: '7 6',
  connectorStrokeWidth: 2,
  connectorDash: '7 9',
  headingDash: '5 8',
  hatchOpacity: 0.85,
  boxFontSize: 29
};
const FLEET_LAYOUT = {
  trunk: { left: 760, top: 765, width: 400, height: 76, label: 'TRUNK' },
  packetX: 960,
  packetStartY: 710,
  packetEndY: 765
};
const BRAND_LAYOUT = {
  centerX: 960,
  nameY: 470,
  nameFontSize: 154,
  taglineY: 555,
  taglineFontSize: 43
};
const AMBIENT_VISUALS = new Set(['overlaps', 'resolution', 'batch', 'checks', 'everything', 'architecture']);
const STAGE_HTML = htmlDocument({
  css: `*{box-sizing:border-box}html,body{margin:0;width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px;background:${BACKGROUND}}
    #art{width:${VIDEO_WIDTH}px;height:${ART_HEIGHT}px;overflow:hidden}svg{display:block}
    #caption{height:${CAPTION_HEIGHT}px;background:#0c0d0f;color:#f1f2f4;display:flex;align-items:center;
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
      { text: 'A merge queue lands one change at a time. Every change waits for the line ahead.', durationMs: 6_600 }
    ]
  },
  {
    id: 'opening-rerun',
    visual: 'rerun',
    cues: [{ text: 'Each landing moves trunk. Checks for every change behind it run again.', durationMs: 6_000 }]
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
        durationMs: 7_600
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
    cues: [{ text: 'Commute. Many coding agents, one repository.', durationMs: 4_000 }]
  }
];

export const CHAPTER_SCENES: Record<string, Scene> = {
  'Overlaps are known at the start': {
    id: 'chapter-overlaps',
    visual: 'overlaps',
    cues: [
      {
        text: 'Each change declares its files. Only changes sharing a file get a real merge check.',
        durationMs: 6_700
      },
      { text: 'A clean merge stays parallel; a conflict gives the pair an order.', durationMs: 5_300 }
    ]
  },
  'A conflict, resolved at the first push': {
    id: 'chapter-resolution',
    visual: 'resolution',
    cues: [
      { text: "Both changes insert after 'cart', in src/routes.mjs.", durationMs: 4_700 },
      {
        text: 'Workers AI reads both intents and selects existing line IDs. It cannot write a line.',
        durationMs: 6_200
      },
      { text: 'The resolution is stored and applies when c-3 lands.', durationMs: 4_600 }
    ]
  },
  'People approve batches, and changes land in parallel': {
    id: 'chapter-batches',
    visual: 'batch',
    cues: [
      { text: 'Ready changes that commute form one landing batch.', durationMs: 4_200 },
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
    cues: [{ text: 'Everything lands: 20 changes in four batches.', durationMs: 4_300 }]
  },
  "What Bob's agent saw": {
    id: 'chapter-agent',
    visual: 'agent',
    cues: [{ text: "What Bob's agent saw: Commute commands and plain git.", durationMs: 4_800 }]
  }
};

export const CLOSING_SCENES: Scene[] = [
  {
    id: 'closing-cloudflare',
    visual: 'architecture',
    cues: [
      {
        text: 'Workers serve the API, console, and git remote. Artifacts holds trunk and a repository per change.',
        durationMs: 7_500
      },
      {
        text: 'A Durable Object coordinates each project. Containers run merges and checks. Workers AI resolves conflicts.',
        durationMs: 8_200
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
    const durationMs = scene.cues.reduce((sum, cue) => sum + cue.durationMs, 0);
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

type SceneArtParams = {
  visual: string;
  timeMs: number;
  sequenceTimeMs: number;
};

function sceneArt({ visual, timeMs, sequenceTimeMs }: SceneArtParams): string {
  const ambient = AMBIENT_VISUALS.has(visual) ? agentGrid(sequenceTimeMs, MOTION.ambientGridOpacity) : '';
  const content = `${ambient}${visualArt({ visual, timeMs, sequenceTimeMs })}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${ART_HEIGHT}">
    <defs><pattern id="hatch" width="${SVG_STYLE.hatchWidth}" height="${SVG_STYLE.hatchWidth}" patternUnits="userSpaceOnUse" patternTransform="rotate(${SVG_STYLE.hatchAngle})"><path d="M0 0V${SVG_STYLE.hatchWidth}" stroke="#1c4a27" stroke-width="${SVG_STYLE.hatchStrokeWidth}"/></pattern></defs>
    <rect width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" fill="${BACKGROUND}"/>${content}</svg>`;
}

type VisualArtParams = {
  visual: string;
  timeMs: number;
  sequenceTimeMs: number;
};

function visualArt({ visual, timeMs, sequenceTimeMs }: VisualArtParams): string {
  switch (visual) {
    case 'fleet':
      return `${heading('MANY AGENTS · ONE REPOSITORY')}${agentGrid(sequenceTimeMs)}${box(FLEET_LAYOUT.trunk)}${flow({ fromX: FLEET_LAYOUT.packetX, fromY: FLEET_LAYOUT.packetStartY, toX: FLEET_LAYOUT.packetX, toY: FLEET_LAYOUT.packetEndY, timeMs, count: MOTION.packetCount })}`;
    case 'queue':
      return `${heading('ONE LINE')}${queueArt({ timeMs, sequenceTimeMs })}`;
    case 'rerun':
      return `${heading('TRUNK MOVES · CHECKS RESTART')}${rerunArt({ timeMs, sequenceTimeMs })}`;
    case 'late-conflict':
      return `${heading('CONFLICT FOUND LATE')}${conflictArt({ timeMs, sequenceTimeMs })}`;
    case 'lanes':
      return `${heading('ONE LANE PER AREA OF CODE')}${lanesArt({ timeMs, sequenceTimeMs, hasDependency: false })}`;
    case 'dependency':
      return `${heading('ORDER ONLY WHERE IT MATTERS')}${lanesArt({ timeMs, sequenceTimeMs, hasDependency: true })}`;
    case 'brand':
      return `${brandGrid(sequenceTimeMs, timeMs)}<text x="${BRAND_LAYOUT.centerX}" y="${BRAND_LAYOUT.nameY}" text-anchor="middle" fill="${WHITE}" font-size="${BRAND_LAYOUT.nameFontSize}" font-weight="700" font-family="Arial,sans-serif">Commute</text><text x="${BRAND_LAYOUT.centerX}" y="${BRAND_LAYOUT.taglineY}" text-anchor="middle" fill="${WHITE}" font-size="${BRAND_LAYOUT.taglineFontSize}" font-family="Arial,sans-serif">Many coding agents, one repository.</text>`;
    case 'overlaps':
      return `${heading('OVERLAPS ARE KNOWN AT THE START')}${overlapsArt(timeMs)}`;
    case 'resolution':
      return `${heading('RESOLVED AT THE FIRST PUSH')}${resolutionArt(timeMs)}`;
    case 'batch':
      return `${heading('ONE APPROVAL · ONE BATCH')}${batchArt(timeMs)}`;
    case 'checks':
      return `${heading('RESULTS FOLLOW CONTENT')}${checksArt(timeMs)}`;
    case 'everything':
      return `${heading('EVERYTHING LANDS')}${everythingArt(timeMs)}`;
    case 'agent':
      return `${heading("WHAT BOB'S AGENT SAW")}${agentArt(timeMs)}`;
    case 'architecture':
      return `${heading('COMMUTE RUNS ON CLOUDFLARE')}${architectureArt(timeMs)}`;
    case 'end':
      return endArt(timeMs, sequenceTimeMs);
    default:
      throw new Error(`UNKNOWN_SCENE: ${visual}`);
  }
}

function smooth(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (EASING.cubic - EASING.double * clamped);
}

function heading(label: string): string {
  return `<text x="${MOTION.sceneHeadingLeft}" y="${MOTION.sceneHeadingTop}" fill="${WHITE}" font-size="${MOTION.sceneHeadingFontSize}" font-weight="700" font-family="Arial,sans-serif" letter-spacing="${MOTION.sceneHeadingLetterSpacing}">${label}</text><path d="M${MOTION.sceneHeadingLeft} ${MOTION.sceneHeadingRuleTop}H${MOTION.sceneHeadingRuleRight}" stroke="${GREY}" stroke-dasharray="${SVG_STYLE.headingDash}"/>`;
}

type BoxParams = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  color?: string;
  fontSize?: number;
};

function box({ left, top, width, height, label, color = GREEN, fontSize = SVG_STYLE.boxFontSize }: BoxParams): string {
  return `<g><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#122116" stroke="${color}" stroke-width="${SVG_STYLE.boxStrokeWidth}"/>
    <rect x="${left + MOTION.boxInset}" y="${top + MOTION.boxInset}" width="${width - MOTION.boxInsetPair}" height="${height - MOTION.boxInsetPair}" fill="url(#hatch)" stroke="${color}" stroke-dasharray="${SVG_STYLE.boxDash}" opacity="${SVG_STYLE.hatchOpacity}"/>
    <text x="${left + width * MOTION.half}" y="${top + height * MOTION.half + fontSize / MOTION.fontBaselineDivisor}" text-anchor="middle" fill="${WHITE}" font-size="${fontSize}" font-family="Menlo,Consolas,monospace">${label}</text></g>`;
}

function line(path: string): string {
  return `<path d="${path}" fill="none" stroke="${GREY}" stroke-width="${SVG_STYLE.connectorStrokeWidth}" stroke-dasharray="${SVG_STYLE.connectorDash}"/>`;
}

function dot(left: number, top: number): string {
  return `<circle cx="${left}" cy="${top}" r="${MOTION.packetRadius}" fill="${ORANGE}"/>`;
}

type FlowParams = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  timeMs: number;
  count: number;
  periodMs?: number;
  delayMs?: number;
};

function flow({
  fromX,
  fromY,
  toX,
  toY,
  timeMs,
  count,
  periodMs = MOTION.packetPeriodMs,
  delayMs = 0
}: FlowParams): string {
  const packets: string[] = [];
  const activeMs = Math.max(0, timeMs - delayMs);
  for (let index = 0; index < count; index += 1) {
    const spacing = (index + Math.sin(index * MOTION.flowWave) * MOTION.flowIrregularity) / count;
    const progress = (activeMs / periodMs + spacing) % MOTION.lineProgress;
    const left = fromX + (toX - fromX) * progress;
    const top = fromY + (toY - fromY) * progress;
    const opacity = Math.min(MOTION.oneOpacity, activeMs / MOTION.enterMs);
    packets.push(`<g opacity="${opacity}">${dot(left, top)}</g>`);
  }
  return packets.join('');
}

type EnterBoxParams = BoxParams & {
  timeMs: number;
  delayMs: number;
};

function enterBox({ timeMs, delayMs, ...params }: EnterBoxParams): string {
  const progress = smooth((timeMs + MOTION.enterLeadMs - delayMs) / MOTION.enterMs);
  if (progress === 0) {
    return '';
  }
  return `<g opacity="${progress}" transform="translate(0 ${(MOTION.lineProgress - progress) * MOTION.labelEnterDistance})">${box(params)}</g>`;
}

type AgentIconParams = {
  left: number;
  top: number;
  opacity?: number;
};

function agentIcon({ left, top, opacity = 1 }: AgentIconParams): string {
  return `<g fill="none" stroke="${BLUE}" stroke-width="2" opacity="${opacity}"><rect x="${left + MOTION.iconCapLeft}" y="${top}" width="${MOTION.iconCapWidth}" height="${MOTION.iconCapWidth}" rx="1"/><rect x="${left}" y="${top + MOTION.iconBodyTop}" width="${MOTION.iconBodyWidth}" height="${MOTION.iconCapWidth}" rx="1"/><rect x="${left + MOTION.iconRight}" y="${top + MOTION.iconBodyTop}" width="${MOTION.iconBodyWidth}" height="${MOTION.iconCapWidth}" rx="1"/></g>`;
}

function agentGrid(timeMs: number, opacity = 1): string {
  const pieces: string[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const index = row * GRID_COLUMNS + column;
      const rise = smooth((timeMs - index * MOTION.gridStaggerMs) / MOTION.gridEnterMs);
      const drift = Math.sin(timeMs / MOTION.gridDriftPeriodMs + row / GRID_ROWS) * MOTION.gridDriftPx;
      const left = GRID_START_X + column * GRID_GAP_X + drift;
      const verticalDrift =
        Math.sin(timeMs / MOTION.gridVerticalPeriodMs + column / GRID_COLUMNS) * MOTION.gridVerticalDriftPx;
      const top = GRID_START_Y + row * GRID_GAP_Y + (MOTION.lineProgress - rise) * MOTION.iconRise + verticalDrift;
      pieces.push(
        `<circle cx="${left + MOTION.iconSize * MOTION.half}" cy="${GRID_START_Y + row * GRID_GAP_Y + MOTION.iconSize * MOTION.half}" r="${MOTION.iconDotRadius}" fill="${BLUE}" opacity="${opacity * (MOTION.lineProgress - rise)}"/>`
      );
      pieces.push(agentIcon({ left, top, opacity: opacity * rise }));
    }
  }
  return pieces.join('');
}

function upperGrid(sequenceTimeMs: number, entryTimeMs?: number): string {
  const progress = entryTimeMs === undefined ? MOTION.lineProgress : smooth(entryTimeMs / MOTION.enterMs);
  const left = MOTION.gridUpperLeft * progress;
  const top = MOTION.gridUpperTop * progress;
  const scale = MOTION.lineProgress + (MOTION.gridUpperScale - MOTION.lineProgress) * progress;
  return `<g transform="translate(${left} ${top}) scale(${scale})">${agentGrid(sequenceTimeMs, MOTION.gridUpperOpacity)}</g>`;
}

function brandGrid(sequenceTimeMs: number, timeMs: number): string {
  const progress = smooth(timeMs / MOTION.enterMs);
  const left = MOTION.gridUpperLeft * (MOTION.lineProgress - progress);
  const top = MOTION.gridUpperTop * (MOTION.lineProgress - progress);
  const scale = MOTION.gridUpperScale + (MOTION.lineProgress - MOTION.gridUpperScale) * progress;
  const opacity = MOTION.gridUpperOpacity + (MOTION.brandGridOpacity - MOTION.gridUpperOpacity) * progress;
  return `<g transform="translate(${left} ${top}) scale(${scale})">${agentGrid(sequenceTimeMs, opacity)}</g>`;
}

type OpeningArtParams = {
  timeMs: number;
  sequenceTimeMs: number;
};

const QUEUE_LAYOUT = {
  trunk: { left: 1_500, top: 635, width: 270, height: 120, label: 'TRUNK' },
  lineStartX: 520,
  lineEndX: 1_500,
  lineY: 695,
  sourceX: 235,
  sourceY: 510,
  sourceColumns: 12,
  sourceColumnGap: 65,
  sourceRowGap: 48,
  queueRight: 1_440,
  queueTop: 695,
  launchDistance: 210,
  landingLabelY: 845,
  landingLabelX: 960
};

function queueArt({ timeMs, sequenceTimeMs }: OpeningArtParams): string {
  const pieces = [
    upperGrid(sequenceTimeMs, timeMs),
    box(QUEUE_LAYOUT.trunk),
    line(`M${QUEUE_LAYOUT.lineStartX} ${QUEUE_LAYOUT.lineY}H${QUEUE_LAYOUT.lineEndX}`)
  ];
  const landed = Math.floor(timeMs / MOTION.landingIntervalMs);
  const landingProgress = (timeMs % MOTION.landingIntervalMs) / MOTION.landingIntervalMs;
  for (let index = 0; index < MOTION.queueCount; index += 1) {
    const sourceColumn = index % QUEUE_LAYOUT.sourceColumns;
    const sourceRow = Math.floor(index / QUEUE_LAYOUT.sourceColumns);
    const sourceX = QUEUE_LAYOUT.sourceX + sourceColumn * QUEUE_LAYOUT.sourceColumnGap;
    const sourceY = QUEUE_LAYOUT.sourceY + sourceRow * QUEUE_LAYOUT.sourceRowGap;
    const targetX = QUEUE_LAYOUT.queueRight - index * MOTION.queueSpacing;
    const enter = smooth((timeMs - index * MOTION.staggerMs) / MOTION.enterMs);
    const queueX = targetX + (landed + landingProgress) * MOTION.queueSpacing;
    const left = sourceX + (queueX - sourceX) * enter;
    const top = sourceY + (QUEUE_LAYOUT.queueTop - sourceY) * enter;
    pieces.push(dot(left, top));
  }
  pieces.push(dot(QUEUE_LAYOUT.queueRight + landingProgress * QUEUE_LAYOUT.launchDistance, QUEUE_LAYOUT.queueTop));
  pieces.push(
    `<text x="${QUEUE_LAYOUT.landingLabelX}" y="${QUEUE_LAYOUT.landingLabelY}" text-anchor="middle" fill="${WHITE}" font-size="35" font-family="Menlo,monospace">ONE AT A TIME · OTHERS WAIT</text>`
  );
  return pieces.join('');
}

const RERUN_LAYOUT = {
  trunk: { left: 1_500, top: 570, width: 270, height: 115, label: 'TRUNK' },
  lineY: 625,
  lineStartX: 260,
  lineEndX: 1_500,
  checkCount: 10,
  checkStartX: 295,
  checkGap: 110,
  checkTop: 745,
  checkWidth: 90,
  checkHeight: 65,
  checkFontSize: 17,
  progressTop: 680,
  progressLength: 65
};

function rerunArt({ timeMs, sequenceTimeMs }: OpeningArtParams): string {
  const pieces = [
    upperGrid(sequenceTimeMs),
    box(RERUN_LAYOUT.trunk),
    line(`M${RERUN_LAYOUT.lineStartX} ${RERUN_LAYOUT.lineY}H${RERUN_LAYOUT.lineEndX}`),
    flow({
      fromX: RERUN_LAYOUT.lineStartX,
      fromY: RERUN_LAYOUT.lineY,
      toX: RERUN_LAYOUT.lineEndX,
      toY: RERUN_LAYOUT.lineY,
      timeMs,
      count: MOTION.queueCount
    })
  ];
  const checkProgress = (timeMs % MOTION.landingIntervalMs) / MOTION.landingIntervalMs;
  for (let index = 0; index < RERUN_LAYOUT.checkCount; index += 1) {
    const left = RERUN_LAYOUT.checkStartX + index * RERUN_LAYOUT.checkGap;
    const center = left + RERUN_LAYOUT.checkWidth * MOTION.half;
    pieces.push(line(`M${center} ${RERUN_LAYOUT.progressTop}V${RERUN_LAYOUT.checkTop}`));
    pieces.push(
      enterBox({
        left,
        top: RERUN_LAYOUT.checkTop,
        width: RERUN_LAYOUT.checkWidth,
        height: RERUN_LAYOUT.checkHeight,
        label: 'CHECK',
        color: ORANGE,
        fontSize: RERUN_LAYOUT.checkFontSize,
        timeMs,
        delayMs: index * MOTION.staggerMs
      })
    );
    pieces.push(dot(center, RERUN_LAYOUT.progressTop + checkProgress * RERUN_LAYOUT.progressLength));
  }
  return pieces.join('');
}

const CONFLICT_LAYOUT = {
  left: { left: 200, top: 500, width: 490, height: 115, label: 'c-3 · SEARCH' },
  right: { left: 1_230, top: 500, width: 490, height: 115, label: 'c-5 · ORDERS' },
  trunk: { left: 790, top: 425, width: 340, height: 100, label: 'TRUNK' },
  file: { left: 710, top: 735, width: 500, height: 100, label: 'src/routes.mjs', color: BLUE },
  leftStartX: 445,
  rightStartX: 1_475,
  startY: 615,
  leftEndX: 850,
  rightEndX: 1_070,
  fileY: 735,
  trunkLeftX: 790,
  trunkRightX: 1_130,
  trunkY: 475,
  leftTrunkX: 690,
  rightTrunkX: 1_230,
  changeCenterY: 560,
  labelX: 960,
  labelY: 890
};

function conflictArt({ timeMs, sequenceTimeMs }: OpeningArtParams): string {
  return `${upperGrid(sequenceTimeMs)}${enterBox({ ...CONFLICT_LAYOUT.left, timeMs, delayMs: 0 })}
    ${enterBox({ ...CONFLICT_LAYOUT.right, timeMs, delayMs: MOTION.enterMs })}
    ${box({ ...CONFLICT_LAYOUT.trunk, label: timeMs >= MOTION.conflictLandingMs ? 'TRUNK · c-3 LANDED' : 'TRUNK', fontSize: 24 })}
    ${box(CONFLICT_LAYOUT.file)}
    ${line(`M${CONFLICT_LAYOUT.leftTrunkX} ${CONFLICT_LAYOUT.changeCenterY}L${CONFLICT_LAYOUT.trunkLeftX} ${CONFLICT_LAYOUT.trunkY}`)}
    ${line(`M${CONFLICT_LAYOUT.rightTrunkX} ${CONFLICT_LAYOUT.changeCenterY}L${CONFLICT_LAYOUT.trunkRightX} ${CONFLICT_LAYOUT.trunkY}`)}
    ${flow({ fromX: CONFLICT_LAYOUT.leftTrunkX, fromY: CONFLICT_LAYOUT.changeCenterY, toX: CONFLICT_LAYOUT.trunkLeftX, toY: CONFLICT_LAYOUT.trunkY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: CONFLICT_LAYOUT.rightTrunkX, fromY: CONFLICT_LAYOUT.changeCenterY, toX: CONFLICT_LAYOUT.trunkRightX, toY: CONFLICT_LAYOUT.trunkY, timeMs, count: MOTION.packetCount, delayMs: MOTION.conflictLandingMs })}
    ${line(`M${CONFLICT_LAYOUT.leftStartX} ${CONFLICT_LAYOUT.startY}L${CONFLICT_LAYOUT.leftEndX} ${CONFLICT_LAYOUT.fileY}`)}
    ${line(`M${CONFLICT_LAYOUT.rightStartX} ${CONFLICT_LAYOUT.startY}L${CONFLICT_LAYOUT.rightEndX} ${CONFLICT_LAYOUT.fileY}`)}
    ${flow({ fromX: CONFLICT_LAYOUT.leftStartX, fromY: CONFLICT_LAYOUT.startY, toX: CONFLICT_LAYOUT.leftEndX, toY: CONFLICT_LAYOUT.fileY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: CONFLICT_LAYOUT.rightStartX, fromY: CONFLICT_LAYOUT.startY, toX: CONFLICT_LAYOUT.rightEndX, toY: CONFLICT_LAYOUT.fileY, timeMs, count: MOTION.packetCount, delayMs: MOTION.conflictLandingMs })}
    ${timeMs >= MOTION.conflictDiscoveryMs ? `<text x="${CONFLICT_LAYOUT.labelX}" y="${CONFLICT_LAYOUT.labelY}" text-anchor="middle" fill="${ORANGE}" font-size="40" font-family="Menlo,monospace">CONFLICT FOUND · SAME LINE</text>` : ''}`;
}

type LanesArtParams = OpeningArtParams & {
  hasDependency: boolean;
};

const LANES_LAYOUT = {
  labels: ['src/routes.mjs', 'src/cart', 'src/catalog', 'src/search'],
  top: 505,
  gap: 100,
  labelLeft: 175,
  labelWidth: 390,
  labelHeight: 76,
  labelFontSize: 25,
  lineStartX: 565,
  lineEndX: 1_565,
  trunk: { left: 1_565, top: 475, width: 220, height: 420, label: 'TRUNK', fontSize: 30 },
  packetCountPerLane: 9,
  packetCycleMs: 2_200,
  sourceLeft: 280,
  sourceGap: 105,
  sourceTop: 385,
  sourceRowGap: 18,
  routeWaitingX: 1_070,
  routeWaitingY: 505,
  laneLabelY: 930
};

function lanesArt({ timeMs, sequenceTimeMs, hasDependency }: LanesArtParams): string {
  const pieces = [upperGrid(sequenceTimeMs), box(LANES_LAYOUT.trunk)];
  for (const [laneIndex, label] of LANES_LAYOUT.labels.entries()) {
    const top = LANES_LAYOUT.top + laneIndex * LANES_LAYOUT.gap;
    pieces.push(
      box({
        left: LANES_LAYOUT.labelLeft,
        top: top - LANES_LAYOUT.labelHeight * MOTION.half,
        width: LANES_LAYOUT.labelWidth,
        height: LANES_LAYOUT.labelHeight,
        label,
        color: BLUE,
        fontSize: LANES_LAYOUT.labelFontSize
      })
    );
    pieces.push(line(`M${LANES_LAYOUT.lineStartX} ${top}H${LANES_LAYOUT.lineEndX}`));
    for (let packetIndex = 0; packetIndex < LANES_LAYOUT.packetCountPerLane; packetIndex += 1) {
      const progress =
        (timeMs / LANES_LAYOUT.packetCycleMs +
          packetIndex / LANES_LAYOUT.packetCountPerLane +
          laneIndex * MOTION.half) %
        MOTION.lineProgress;
      let left = LANES_LAYOUT.lineStartX + progress * (LANES_LAYOUT.lineEndX - LANES_LAYOUT.lineStartX);
      if (hasDependency && laneIndex === 0 && packetIndex === 1) {
        left = Math.min(left, LANES_LAYOUT.routeWaitingX);
      }
      const enter = smooth((timeMs - packetIndex * MOTION.staggerMs) / MOTION.enterMs);
      const sourceX = LANES_LAYOUT.sourceLeft + packetIndex * LANES_LAYOUT.sourceGap;
      const sourceY = LANES_LAYOUT.sourceTop + laneIndex * LANES_LAYOUT.sourceRowGap;
      const animatedX = sourceX + (left - sourceX) * enter;
      const animatedY = sourceY + (top - sourceY) * enter;
      pieces.push(`<g opacity="${enter}">${dot(animatedX, animatedY)}</g>`);
    }
  }
  if (hasDependency) {
    pieces.push(dot(LANES_LAYOUT.routeWaitingX, LANES_LAYOUT.routeWaitingY));
    pieces.push(
      `<text x="960" y="${LANES_LAYOUT.laneLabelY}" text-anchor="middle" fill="${WHITE}" font-size="30" font-family="Menlo,monospace">c-5 waits for c-3 · other lanes keep moving</text>`
    );
  }
  return pieces.join('');
}

const OVERLAP_LAYOUT = {
  leftChange: { left: 165, top: 225, width: 420, height: 100, label: 'c-3 · SEARCH' },
  rightChange: { left: 750, top: 225, width: 420, height: 100, label: 'c-5 · ORDERS' },
  otherChange: { left: 1_335, top: 225, width: 420, height: 100, label: 'OTHER CHANGE' },
  routeFile: { left: 415, top: 530, width: 510, height: 100, label: 'src/routes.mjs', color: BLUE },
  otherFile: {
    left: 1_235,
    top: 530,
    width: 510,
    height: 100,
    label: 'src/cart/pricing.mjs',
    color: BLUE,
    fontSize: 23
  },
  merge: { left: 350, top: 745, width: 650, height: 105, label: 'REAL MERGE CHECK', color: ORANGE },
  routeTopX: 670,
  routeTopY: 530,
  otherTopX: 1_490,
  otherTopY: 530,
  changeBottomY: 325,
  leftChangeX: 375,
  rightChangeX: 960,
  otherChangeX: 1_545,
  mergeTopX: 675,
  mergeTopY: 745,
  mergeResultX: 675,
  mergeResultY: 910,
  parallelLabelX: 1_490,
  parallelLabelY: 805
};

function overlapsArt(timeMs: number): string {
  const pieces = [
    enterBox({ ...OVERLAP_LAYOUT.leftChange, timeMs, delayMs: 0 }),
    enterBox({ ...OVERLAP_LAYOUT.rightChange, timeMs, delayMs: MOTION.staggerMs }),
    enterBox({ ...OVERLAP_LAYOUT.otherChange, timeMs, delayMs: MOTION.staggerMs * MOTION.overlapOtherDelaySteps })
  ];
  if (timeMs >= MOTION.overlapPathsMs) {
    pieces.push(box(OVERLAP_LAYOUT.routeFile), box(OVERLAP_LAYOUT.otherFile));
    pieces.push(
      line(
        `M${OVERLAP_LAYOUT.leftChangeX} ${OVERLAP_LAYOUT.changeBottomY}L${OVERLAP_LAYOUT.routeTopX} ${OVERLAP_LAYOUT.routeTopY}`
      )
    );
    pieces.push(
      line(
        `M${OVERLAP_LAYOUT.rightChangeX} ${OVERLAP_LAYOUT.changeBottomY}L${OVERLAP_LAYOUT.routeTopX} ${OVERLAP_LAYOUT.routeTopY}`
      )
    );
    pieces.push(
      line(
        `M${OVERLAP_LAYOUT.otherChangeX} ${OVERLAP_LAYOUT.changeBottomY}L${OVERLAP_LAYOUT.otherTopX} ${OVERLAP_LAYOUT.otherTopY}`
      )
    );
    pieces.push(
      flow({
        fromX: OVERLAP_LAYOUT.leftChangeX,
        fromY: OVERLAP_LAYOUT.changeBottomY,
        toX: OVERLAP_LAYOUT.routeTopX,
        toY: OVERLAP_LAYOUT.routeTopY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.overlapPathsMs
      })
    );
    pieces.push(
      flow({
        fromX: OVERLAP_LAYOUT.rightChangeX,
        fromY: OVERLAP_LAYOUT.changeBottomY,
        toX: OVERLAP_LAYOUT.routeTopX,
        toY: OVERLAP_LAYOUT.routeTopY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.overlapPathsMs
      })
    );
    pieces.push(
      flow({
        fromX: OVERLAP_LAYOUT.otherChangeX,
        fromY: OVERLAP_LAYOUT.changeBottomY,
        toX: OVERLAP_LAYOUT.otherTopX,
        toY: OVERLAP_LAYOUT.otherTopY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.overlapPathsMs
      })
    );
  }
  if (timeMs >= MOTION.overlapMergeMs) {
    pieces.push(box(OVERLAP_LAYOUT.merge));
    pieces.push(
      line(
        `M${OVERLAP_LAYOUT.routeTopX} ${OVERLAP_LAYOUT.routeFile.top + OVERLAP_LAYOUT.routeFile.height}V${OVERLAP_LAYOUT.mergeTopY}`
      )
    );
    pieces.push(
      flow({
        fromX: OVERLAP_LAYOUT.routeTopX,
        fromY: OVERLAP_LAYOUT.routeFile.top + OVERLAP_LAYOUT.routeFile.height,
        toX: OVERLAP_LAYOUT.mergeTopX,
        toY: OVERLAP_LAYOUT.mergeTopY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.overlapMergeMs
      })
    );
  }
  if (timeMs >= MOTION.overlapResultMs) {
    pieces.push(
      `<text x="${OVERLAP_LAYOUT.mergeResultX}" y="${OVERLAP_LAYOUT.mergeResultY}" text-anchor="middle" fill="${ORANGE}" font-size="34" font-family="Menlo,monospace">c-5 AFTER c-3</text>`
    );
    pieces.push(
      `<text x="${OVERLAP_LAYOUT.parallelLabelX}" y="${OVERLAP_LAYOUT.parallelLabelY + OVERLAP_LAYOUT.routeFile.height * MOTION.half}" text-anchor="middle" fill="${WHITE}" font-size="28" font-family="Menlo,monospace">OTHER FILE · PARALLEL</text>`
    );
  }
  return pieces.join('');
}

const RESOLUTION_LAYOUT = {
  leftBox: { left: 145, top: 220, width: 600, height: 110, label: 'c-3 · SEARCH' },
  rightBox: { left: 1_175, top: 220, width: 600, height: 110, label: 'c-5 · ORDERS' },
  aiBox: { left: 620, top: 505, width: 680, height: 108, label: 'WORKERS AI · LINE IDS' },
  resultBox: { left: 620, top: 730, width: 680, height: 185, label: '' },
  leftTextX: 250,
  rightTextX: 1_280,
  firstTextY: 380,
  textGapY: 43,
  textFontSize: 29,
  aiAnswerX: 960,
  aiAnswerY: 680,
  resultTextX: 730,
  resultFirstY: 775,
  resultGapY: 43,
  resultStaggerMs: 400,
  resultFlightMs: 350,
  leftConnectorX: 445,
  rightConnectorX: 1_475,
  connectorStartY: 450,
  aiLeftX: 790,
  aiRightX: 1_130,
  aiTopY: 505,
  aiBottomX: 960,
  aiBottomY: 613,
  resultTopX: 960,
  resultTopY: 730
};

const RESOLUTION_LINES = [
  { id: '', value: "'home',", side: 'left', row: 0 },
  { id: '', value: "'cart',", side: 'left', row: 1 },
  { id: 't1', value: "'search',", side: 'left', row: 2 },
  { id: 'o1', value: "'orders',", side: 'right', row: 2 }
];

function resolutionArt(timeMs: number): string {
  const pieces = [box(RESOLUTION_LAYOUT.leftBox), box(RESOLUTION_LAYOUT.rightBox)];
  for (const item of RESOLUTION_LINES) {
    const sideX = item.side === 'left' ? RESOLUTION_LAYOUT.leftTextX : RESOLUTION_LAYOUT.rightTextX;
    const sideY = RESOLUTION_LAYOUT.firstTextY + item.row * RESOLUTION_LAYOUT.textGapY;
    const label = item.id === '' ? item.value : `${item.id}  ${item.value}`;
    pieces.push(
      `<text x="${sideX}" y="${sideY}" fill="${WHITE}" font-size="${RESOLUTION_LAYOUT.textFontSize}" font-family="Menlo,monospace">${label}</text>`
    );
    if (item.id === '') {
      pieces.push(
        `<text x="${RESOLUTION_LAYOUT.rightTextX}" y="${sideY}" fill="${WHITE}" font-size="${RESOLUTION_LAYOUT.textFontSize}" font-family="Menlo,monospace">${label}</text>`
      );
    }
  }
  if (timeMs >= MOTION.resolutionModelMs) {
    pieces.push(box(RESOLUTION_LAYOUT.aiBox));
    pieces.push(
      line(
        `M${RESOLUTION_LAYOUT.leftConnectorX} ${RESOLUTION_LAYOUT.connectorStartY}L${RESOLUTION_LAYOUT.aiLeftX} ${RESOLUTION_LAYOUT.aiTopY}`
      )
    );
    pieces.push(
      line(
        `M${RESOLUTION_LAYOUT.rightConnectorX} ${RESOLUTION_LAYOUT.connectorStartY}L${RESOLUTION_LAYOUT.aiRightX} ${RESOLUTION_LAYOUT.aiTopY}`
      )
    );
    pieces.push(
      flow({
        fromX: RESOLUTION_LAYOUT.leftConnectorX,
        fromY: RESOLUTION_LAYOUT.connectorStartY,
        toX: RESOLUTION_LAYOUT.aiLeftX,
        toY: RESOLUTION_LAYOUT.aiTopY,
        timeMs,
        count: MOTION.packetCount
      })
    );
    pieces.push(
      flow({
        fromX: RESOLUTION_LAYOUT.rightConnectorX,
        fromY: RESOLUTION_LAYOUT.connectorStartY,
        toX: RESOLUTION_LAYOUT.aiRightX,
        toY: RESOLUTION_LAYOUT.aiTopY,
        timeMs,
        count: MOTION.packetCount
      })
    );
  }
  if (timeMs >= MOTION.resolutionAnswerMs) {
    pieces.push(
      `<text x="${RESOLUTION_LAYOUT.aiAnswerX}" y="${RESOLUTION_LAYOUT.aiAnswerY}" text-anchor="middle" fill="${ORANGE}" font-size="35" font-family="Menlo,monospace">[ t1, o1 ]</text>`
    );
    pieces.push(line(`M${RESOLUTION_LAYOUT.aiBottomX} ${RESOLUTION_LAYOUT.aiBottomY}V${RESOLUTION_LAYOUT.resultTopY}`));
    pieces.push(
      flow({
        fromX: RESOLUTION_LAYOUT.aiBottomX,
        fromY: RESOLUTION_LAYOUT.aiBottomY,
        toX: RESOLUTION_LAYOUT.resultTopX,
        toY: RESOLUTION_LAYOUT.resultTopY,
        timeMs,
        count: MOTION.packetCount
      })
    );
  }
  if (timeMs >= MOTION.resolutionApplyMs) {
    pieces.push(box(RESOLUTION_LAYOUT.resultBox));
    for (const [index, item] of RESOLUTION_LINES.entries()) {
      const progress = smooth(
        (timeMs - MOTION.resolutionApplyMs - index * RESOLUTION_LAYOUT.resultStaggerMs) /
          RESOLUTION_LAYOUT.resultFlightMs
      );
      if (progress === 0) {
        continue;
      }
      const sourceX = item.side === 'left' ? RESOLUTION_LAYOUT.leftTextX : RESOLUTION_LAYOUT.rightTextX;
      const sourceY = RESOLUTION_LAYOUT.firstTextY + item.row * RESOLUTION_LAYOUT.textGapY;
      const left = sourceX + (RESOLUTION_LAYOUT.resultTextX - sourceX) * progress;
      const top =
        sourceY + (RESOLUTION_LAYOUT.resultFirstY + index * RESOLUTION_LAYOUT.resultGapY - sourceY) * progress;
      pieces.push(
        `<text x="${left}" y="${top}" fill="${WHITE}" font-size="${RESOLUTION_LAYOUT.textFontSize}" font-family="Menlo,monospace">${item.value}</text>`
      );
    }
  }
  return pieces.join('');
}

const BATCH_LAYOUT = {
  batchBox: { left: 170, top: 240, width: 790, height: 110, label: 'BATCH 1 · 16 READY', fontSize: 34 },
  approvalBox: { left: 740, top: 700, width: 440, height: 110, label: 'APPROVED', fontSize: 34 },
  trunkBox: { left: 1_360, top: 300, width: 390, height: 520, label: '', fontSize: 34 },
  gridLeft: 255,
  gridTop: 420,
  gridColumns: 4,
  gridGapX: 165,
  gridGapY: 75,
  trunkLeft: 1_425,
  trunkTop: 430,
  trunkGapX: 72,
  trunkGapY: 75,
  lineStartX: 960,
  lineEndX: 1_360,
  lineY: 560,
  flightDotRadius: 12,
  floatAmplitude: 12,
  floatPeriodMs: 1_600,
  floatPhase: 0.9,
  countX: 1_555,
  countY: 750,
  trunkLabelY: 365,
  trunkLabelFontSize: 34
};

const BATCH_ORDER = [
  { rank: 6 },
  { rank: 13 },
  { rank: 1 },
  { rank: 9 },
  { rank: 4 },
  { rank: 15 },
  { rank: 2 },
  { rank: 11 },
  { rank: 0 },
  { rank: 8 },
  { rank: 14 },
  { rank: 3 },
  { rank: 12 },
  { rank: 5 },
  { rank: 10 },
  { rank: 7 }
];

function batchArt(timeMs: number): string {
  const pieces = [box(BATCH_LAYOUT.batchBox), box(BATCH_LAYOUT.trunkBox)];
  pieces.push(
    `<text x="${BATCH_LAYOUT.countX}" y="${BATCH_LAYOUT.trunkLabelY}" text-anchor="middle" fill="${WHITE}" font-size="${BATCH_LAYOUT.trunkLabelFontSize}" font-family="Menlo,monospace">TRUNK</text>`
  );
  pieces.push(line(`M${BATCH_LAYOUT.lineStartX} ${BATCH_LAYOUT.lineY}H${BATCH_LAYOUT.lineEndX}`));
  let landed = 0;
  for (let index = 0; index < MOTION.batchCount; index += 1) {
    const column = index % BATCH_LAYOUT.gridColumns;
    const row = Math.floor(index / BATCH_LAYOUT.gridColumns);
    const order = BATCH_ORDER[index];
    if (order === undefined) {
      throw new Error('BATCH_ORDER_MISSING');
    }
    const progress = smooth(
      (timeMs - MOTION.batchApprovalMs - order.rank * MOTION.batchStaggerMs) / MOTION.batchFlightMs
    );
    const fromX = BATCH_LAYOUT.gridLeft + column * BATCH_LAYOUT.gridGapX;
    const fromY = BATCH_LAYOUT.gridTop + row * BATCH_LAYOUT.gridGapY;
    const toX = BATCH_LAYOUT.trunkLeft + column * BATCH_LAYOUT.trunkGapX;
    const toY = BATCH_LAYOUT.trunkTop + row * BATCH_LAYOUT.trunkGapY;
    const float =
      Math.sin(timeMs / BATCH_LAYOUT.floatPeriodMs + index * BATCH_LAYOUT.floatPhase) *
      BATCH_LAYOUT.floatAmplitude *
      (MOTION.lineProgress - progress);
    const left = fromX + (toX - fromX) * progress + float;
    const top = fromY + (toY - fromY) * progress - float * MOTION.half;
    const enter = smooth((timeMs + MOTION.enterLeadMs - index * MOTION.staggerMs) / MOTION.enterMs);
    pieces.push(
      `<circle cx="${left}" cy="${top}" r="${BATCH_LAYOUT.flightDotRadius}" fill="${ORANGE}" opacity="${enter}"/>`
    );
    if (progress >= MOTION.lineProgress) {
      landed += MOTION.lineProgress;
    }
  }
  if (timeMs >= MOTION.batchApprovalMs) {
    pieces.push(box(BATCH_LAYOUT.approvalBox));
    pieces.push(
      flow({
        fromX: BATCH_LAYOUT.lineStartX,
        fromY: BATCH_LAYOUT.lineY,
        toX: BATCH_LAYOUT.lineEndX,
        toY: BATCH_LAYOUT.lineY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.batchApprovalMs
      })
    );
  }
  pieces.push(
    `<text x="${BATCH_LAYOUT.countX}" y="${BATCH_LAYOUT.countY}" text-anchor="middle" fill="${WHITE}" font-size="32" font-family="Menlo,monospace">${landed} / ${MOTION.batchCount} LANDED</text>`
  );
  return pieces.join('');
}

const CHECKS_LAYOUT = {
  folderX: 165,
  folderTop: 315,
  folderGap: 175,
  folderWidth: 610,
  folderHeight: 105,
  folderFontSize: 27,
  checkX: 1_125,
  checkWidth: 630,
  checkHeight: 105,
  connectorStartX: 775,
  connectorEndX: 1_125,
  trunk: { left: 745, top: 175, width: 430, height: 90, label: 'TRUNK' },
  landingX: 960,
  landingStartY: 265,
  landingEndY: 315,
  statusX: 960,
  statusY: 890,
  folderNames: ['src/routes.mjs', 'src/cart', 'src/catalog'],
  initialHashes: ['7c7959', 'd7e7df', '74c53e'],
  changedRouteHash: 'c51183',
  checkNames: ['ROUTES CHECK', 'CART CHECK', 'CATALOG CHECK']
};

function checksArt(timeMs: number): string {
  const pieces = [box(CHECKS_LAYOUT.trunk)];
  const hasChangedHash = timeMs >= MOTION.checkHashMs;
  const hasRun = timeMs >= MOTION.checkRunMs;
  const hasPassed = timeMs >= MOTION.checkPassMs;
  if (timeMs >= MOTION.checkLandingMs) {
    pieces.push(line(`M${CHECKS_LAYOUT.landingX} ${CHECKS_LAYOUT.landingStartY}V${CHECKS_LAYOUT.landingEndY}`));
    pieces.push(
      flow({
        fromX: CHECKS_LAYOUT.landingX,
        fromY: CHECKS_LAYOUT.landingStartY,
        toX: CHECKS_LAYOUT.landingX,
        toY: CHECKS_LAYOUT.landingEndY,
        timeMs,
        count: MOTION.packetCount,
        delayMs: MOTION.checkLandingMs
      })
    );
    pieces.push(
      `<text x="${CHECKS_LAYOUT.statusX}" y="${CHECKS_LAYOUT.statusY}" text-anchor="middle" fill="${ORANGE}" font-size="33" font-family="Menlo,monospace">CHANGE LANDED · TRUNK MOVED</text>`
    );
  }
  for (const [index, name] of CHECKS_LAYOUT.folderNames.entries()) {
    const top = CHECKS_LAYOUT.folderTop + index * CHECKS_LAYOUT.folderGap;
    const centerY = top + CHECKS_LAYOUT.folderHeight * MOTION.half;
    const initialHash = CHECKS_LAYOUT.initialHashes[index];
    const checkName = CHECKS_LAYOUT.checkNames[index];
    if (initialHash === undefined || checkName === undefined) {
      throw new Error('CHECK_LAYOUT_MISSING');
    }
    const hash = index === 0 && hasChangedHash ? CHECKS_LAYOUT.changedRouteHash : initialHash;
    let status = 'SAVED';
    if (hasRun && index > 0) {
      status = 'KEPT';
    } else if (hasPassed && index === 0) {
      status = 'PASSED';
    } else if (hasRun && index === 0) {
      status = 'RUNS';
    }
    pieces.push(
      enterBox({
        left: CHECKS_LAYOUT.folderX,
        top,
        width: CHECKS_LAYOUT.folderWidth,
        height: CHECKS_LAYOUT.folderHeight,
        label: `${name} · ${hash}`,
        color: BLUE,
        fontSize: CHECKS_LAYOUT.folderFontSize,
        timeMs,
        delayMs: index * MOTION.staggerMs
      })
    );
    pieces.push(line(`M${CHECKS_LAYOUT.connectorStartX} ${centerY}H${CHECKS_LAYOUT.connectorEndX}`));
    pieces.push(
      flow({
        fromX: CHECKS_LAYOUT.connectorStartX,
        fromY: centerY,
        toX: CHECKS_LAYOUT.connectorEndX,
        toY: centerY,
        timeMs,
        count: MOTION.packetCount
      })
    );
    pieces.push(
      enterBox({
        left: CHECKS_LAYOUT.checkX,
        top,
        width: CHECKS_LAYOUT.checkWidth,
        height: CHECKS_LAYOUT.checkHeight,
        label: `${checkName} · ${status}`,
        color: status === 'RUNS' ? ORANGE : GREEN,
        timeMs,
        delayMs: MOTION.checkSaveMs + index * MOTION.staggerMs
      })
    );
  }
  return pieces.join('');
}

const EVERYTHING_LAYOUT = {
  count: 20,
  columns: 10,
  startX: 400,
  startY: 230,
  gapX: 115,
  gapY: 120,
  targetX: 585,
  targetY: 660,
  targetGapX: 78,
  targetGapY: 44,
  batchSize: 5,
  batchGapMs: 650,
  itemGapMs: 30,
  flightMs: 600,
  trunk: { left: 480, top: 585, width: 960, height: 220, label: '' },
  countX: 960,
  countY: 755,
  batchLabelY: 880
};

function everythingArt(timeMs: number): string {
  const pieces = [box(EVERYTHING_LAYOUT.trunk)];
  let landed = 0;
  for (let index = 0; index < EVERYTHING_LAYOUT.count; index += 1) {
    const column = index % EVERYTHING_LAYOUT.columns;
    const row = Math.floor(index / EVERYTHING_LAYOUT.columns);
    const batch = Math.floor(index / EVERYTHING_LAYOUT.batchSize);
    const progress = smooth(
      (timeMs -
        batch * EVERYTHING_LAYOUT.batchGapMs -
        (index % EVERYTHING_LAYOUT.batchSize) * EVERYTHING_LAYOUT.itemGapMs) /
        EVERYTHING_LAYOUT.flightMs
    );
    const fromX = EVERYTHING_LAYOUT.startX + column * EVERYTHING_LAYOUT.gapX;
    const fromY = EVERYTHING_LAYOUT.startY + row * EVERYTHING_LAYOUT.gapY;
    const toX = EVERYTHING_LAYOUT.targetX + column * EVERYTHING_LAYOUT.targetGapX;
    const toY = EVERYTHING_LAYOUT.targetY + row * EVERYTHING_LAYOUT.targetGapY;
    pieces.push(agentIcon({ left: fromX + (toX - fromX) * progress, top: fromY + (toY - fromY) * progress }));
    if (progress >= MOTION.lineProgress) {
      landed += MOTION.lineProgress;
    }
  }
  pieces.push(
    `<text x="${EVERYTHING_LAYOUT.countX}" y="${EVERYTHING_LAYOUT.countY}" text-anchor="middle" fill="${WHITE}" font-size="40" font-family="Menlo,monospace">TRUNK · ${landed} / ${EVERYTHING_LAYOUT.count}</text>`
  );
  pieces.push(
    `<text x="${EVERYTHING_LAYOUT.countX}" y="${EVERYTHING_LAYOUT.batchLabelY}" text-anchor="middle" fill="${WHITE}" font-size="34" font-family="Menlo,monospace">FOUR LANDING BATCHES</text>`
  );
  return pieces.join('');
}

const AGENT_LAYOUT = {
  iconX: 245,
  iconY: 385,
  start: { left: 385, top: 335, width: 350, height: 120, label: 'commute start', fontSize: 27 },
  push: { left: 795, top: 335, width: 350, height: 120, label: 'git push', fontSize: 27 },
  wait: { left: 1_205, top: 335, width: 350, height: 120, label: 'commute wait', fontSize: 27 },
  lineY: 395,
  iconEndX: 385,
  firstEndX: 795,
  secondEndX: 1_205,
  gridScale: 0.65,
  gridLeft: 110,
  gridTop: 390,
  gridOpacity: 0.18
};

function agentArt(timeMs: number): string {
  return `<g transform="translate(${AGENT_LAYOUT.gridLeft} ${AGENT_LAYOUT.gridTop}) scale(${AGENT_LAYOUT.gridScale})">${agentGrid(timeMs, AGENT_LAYOUT.gridOpacity)}</g>
    ${agentIcon({ left: AGENT_LAYOUT.iconX, top: AGENT_LAYOUT.iconY })}
    ${box(AGENT_LAYOUT.start)}${box(AGENT_LAYOUT.push)}${box(AGENT_LAYOUT.wait)}
    ${line(`M${AGENT_LAYOUT.iconX + MOTION.iconSize} ${AGENT_LAYOUT.lineY}H${AGENT_LAYOUT.iconEndX}`)}
    ${line(`M${AGENT_LAYOUT.start.left + AGENT_LAYOUT.start.width} ${AGENT_LAYOUT.lineY}H${AGENT_LAYOUT.firstEndX}`)}
    ${line(`M${AGENT_LAYOUT.push.left + AGENT_LAYOUT.push.width} ${AGENT_LAYOUT.lineY}H${AGENT_LAYOUT.secondEndX}`)}
    ${flow({ fromX: AGENT_LAYOUT.iconX + MOTION.iconSize, fromY: AGENT_LAYOUT.lineY, toX: AGENT_LAYOUT.iconEndX, toY: AGENT_LAYOUT.lineY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: AGENT_LAYOUT.start.left + AGENT_LAYOUT.start.width, fromY: AGENT_LAYOUT.lineY, toX: AGENT_LAYOUT.firstEndX, toY: AGENT_LAYOUT.lineY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: AGENT_LAYOUT.push.left + AGENT_LAYOUT.push.width, fromY: AGENT_LAYOUT.lineY, toX: AGENT_LAYOUT.secondEndX, toY: AGENT_LAYOUT.lineY, timeMs, count: MOTION.packetCount })}`;
}

const ARCHITECTURE_LAYOUT = {
  workers: { left: 750, top: 245, width: 420, height: 105, label: 'WORKERS' },
  artifacts: { left: 160, top: 515, width: 400, height: 115, label: 'ARTIFACTS' },
  coordinator: { left: 645, top: 515, width: 630, height: 115, label: 'DURABLE OBJECT' },
  containers: { left: 1_360, top: 515, width: 400, height: 115, label: 'CONTAINERS' },
  resolver: { left: 760, top: 760, width: 400, height: 95, label: 'WORKERS AI' },
  centerX: 960,
  workersBottomY: 350,
  forkY: 440,
  artifactsX: 360,
  artifactsY: 515,
  coordinatorY: 515,
  containersStartX: 1_275,
  containersEndX: 1_360,
  containersY: 573,
  coordinatorBottomY: 630,
  resolverTopY: 760
};

function architectureArt(timeMs: number): string {
  const layout = ARCHITECTURE_LAYOUT;
  return `${enterBox({ ...layout.workers, timeMs, delayMs: 0 })}
    ${enterBox({ ...layout.artifacts, timeMs, delayMs: MOTION.staggerMs })}
    ${enterBox({ ...layout.coordinator, timeMs, delayMs: MOTION.staggerMs * MOTION.architectureCoordinatorDelaySteps })}
    ${enterBox({ ...layout.containers, timeMs, delayMs: MOTION.staggerMs * MOTION.architectureContainersDelaySteps })}
    ${enterBox({ ...layout.resolver, timeMs, delayMs: MOTION.staggerMs * MOTION.architectureResolverDelaySteps })}
    ${line(`M${layout.centerX} ${layout.workersBottomY}V${layout.forkY}H${layout.artifactsX}V${layout.artifactsY}`)}
    ${line(`M${layout.centerX} ${layout.workersBottomY}V${layout.coordinatorY}`)}
    ${line(`M${layout.containersStartX} ${layout.containersY}H${layout.containersEndX}`)}
    ${line(`M${layout.centerX} ${layout.coordinatorBottomY}V${layout.resolverTopY}`)}
    ${flow({ fromX: layout.centerX, fromY: layout.workersBottomY, toX: layout.centerX, toY: layout.forkY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: layout.centerX, fromY: layout.forkY, toX: layout.artifactsX, toY: layout.forkY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: layout.artifactsX, fromY: layout.forkY, toX: layout.artifactsX, toY: layout.artifactsY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: layout.centerX, fromY: layout.workersBottomY, toX: layout.centerX, toY: layout.coordinatorY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: layout.containersStartX, fromY: layout.containersY, toX: layout.containersEndX, toY: layout.containersY, timeMs, count: MOTION.packetCount })}
    ${flow({ fromX: layout.centerX, fromY: layout.coordinatorBottomY, toX: layout.centerX, toY: layout.resolverTopY, timeMs, count: MOTION.packetCount })}`;
}

const END_LAYOUT = {
  enterMs: 900,
  gridOpacity: 0.13,
  enterDistance: 65,
  centerX: 960,
  nameY: 410,
  nameFontSize: 158,
  taglineY: 535,
  taglineFontSize: 57,
  urlY: 675,
  urlFontSize: 39
};

function endArt(timeMs: number, sequenceTimeMs: number): string {
  const enter = smooth(timeMs / END_LAYOUT.enterMs);
  return `${agentGrid(sequenceTimeMs, END_LAYOUT.gridOpacity)}<g transform="translate(0 ${(MOTION.lineProgress - enter) * END_LAYOUT.enterDistance})" opacity="${enter}">
    <text x="${END_LAYOUT.centerX}" y="${END_LAYOUT.nameY}" text-anchor="middle" fill="${WHITE}" font-size="${END_LAYOUT.nameFontSize}" font-weight="700" font-family="Arial,sans-serif">Commute</text>
    <text x="${END_LAYOUT.centerX}" y="${END_LAYOUT.taglineY}" text-anchor="middle" fill="${WHITE}" font-size="${END_LAYOUT.taglineFontSize}" font-family="Arial,sans-serif">Changes that commute land in any order.</text>
    <text x="${END_LAYOUT.centerX}" y="${END_LAYOUT.urlY}" text-anchor="middle" fill="${GREEN}" font-size="${END_LAYOUT.urlFontSize}" font-family="Menlo,monospace">github.com/lucrise-llc/commute</text></g>`;
}

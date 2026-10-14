import type { Page } from 'playwright';

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import type { FrameEntry } from './clips.ts';

import { FADE_MS, FRAME_MS } from './clips.ts';
import { captionMarkup, escapeHtml, htmlDocument, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

const BACKGROUND = '#101010';
const BLUE = '#1868bc';
const GREEN = '#2dc242';
const GREEN_BRIGHT = '#75e980';
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
const COORD_DIGITS = 2;
const OPACITY_DIGITS = 3;
const BATCH_TOTAL = 16;
const CHANGE_TOTAL = 20;
const BATCH_COUNT = 4;
const MARK_VIEWBOX_SIZE = 16;
const RESULT_SLOT = 3;
const APPROVAL_SLOT = 2;
const WORLD = {
  boxLeft: 180,
  boxTop: 122,
  boxWidth: 280,
  boxHeight: 170,
  boxGap: 40,
  boxCount: 5,
  boxLabelY: 43,
  boxCenterLabelY: 96,
  boxLineStartY: 77,
  boxLineGap: 29,
  resultLineStartY: 76,
  resultLineGap: 24,
  busLeft: 180,
  busTop: 430,
  busWidth: 1_560,
  busHeight: 90,
  busLabelY: 55,
  busCountX: 1_605,
  connectorTop: 292,
  connectorBottom: 430,
  lowerConnectorTop: 520,
  lowerConnectorBottom: 635,
  bandLeft: 180,
  bandTop: 635,
  bandColumns: 33,
  bandRows: 6,
  bandGapX: 48,
  bandGapY: 43,
  iconSize: 24,
  lowerConnectorStride: 4,
  lowerConnectorCount: 9,
  centerX: 960,
  queueY: 580,
  queueStartX: 610,
  queueEndX: 960,
  queueCount: 4,
  queueBaseGap: 68,
  queueGapGrowth: 12,
  batchConnectorStride: 2,
  batchConnectorCount: 16,
  labelSize: 25,
  packetRadius: 7
};
const MOTION = {
  enterMs: 900,
  busEnterMs: 1_000,
  boxesEnterMs: 1_450,
  packetsEnterMs: 2_300,
  agentStaggerMs: 5,
  agentRisePx: 65,
  packetFlightMs: 1_120,
  packetPeriodMs: 2_100,
  packetPeriodSpreadMs: 660,
  packetOffsetStrideMs: 613,
  packetPeriodStrideMs: 371,
  pulseMs: 260,
  pulseExtraWidth: 3,
  queueLandMs: 1_600,
  queueLaunchMs: 900,
  conflictLandMs: 1_950,
  conflictStopMs: 3_300,
  laneRevealMs: 750,
  overlapPathsMs: 1_300,
  overlapMergeMs: 3_000,
  overlapResultMs: 7_200,
  resolutionModelMs: 4_700,
  resolutionAnswerMs: 8_000,
  resolutionApplyMs: 11_000,
  resolutionLineMs: 300,
  resolutionLineStaggerMs: 300,
  batchApproveMs: 4_200,
  batchFlightMs: 1_150,
  batchLaunchSpacingMs: 95,
  batchShuffleStride: 7,
  batchArrivalMs: 180,
  checkLandingMs: 6_700,
  checkHashMs: 7_350,
  checkRunMs: 8_200,
  checkPassMs: 9_800,
  everythingBatchMs: 710,
  everythingFlightMs: 520,
  brandEnterMs: 850,
  endClearMs: 800,
  driftMs: 2_700,
  driftPx: 3,
  unit: 1,
  half: 0.5,
  double: 2,
  cubic: 3
};
const STYLE = {
  boxStroke: 3,
  boxInnerInset: 9,
  boxInnerPair: 18,
  boxDash: '10 9',
  hatchWidth: 12,
  hatchStroke: 2,
  connectorStroke: 2,
  connectorDash: '8 10',
  fontBaseline: 8,
  iconStroke: 2,
  iconCapLeft: 7,
  iconCapWidth: 10,
  iconBodyTop: 13,
  iconBodyWidth: 11,
  iconRight: 13,
  iconDotRadius: 3,
  markTileSize: 94,
  markTileRadius: 18,
  markNameSize: 86,
  markUrlSize: 38,
  markLeft: 660,
  markTop: 166,
  markNameX: 782,
  markNameY: 232,
  markUrlY: 342
};
const OPENING_VISUALS = new Set(['fleet', 'queue', 'rerun', 'late-conflict', 'lanes', 'dependency', 'brand']);
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

type Slot = {
  index: number;
  label: string;
  lines?: string[];
  hasDetails?: boolean;
};

function sceneArt({ visual, timeMs, sequenceTimeMs }: SceneArtParams): string {
  const isOpening = OPENING_VISUALS.has(visual);
  const worldTimeMs = isOpening ? sequenceTimeMs : timeMs;
  const slots = slotsForVisual({ visual, timeMs });
  const hasQueue = visual === 'queue' || visual === 'rerun' || visual === 'late-conflict';
  const busLabel = visual === 'brand' ? 'COMMUTE' : 'TRUNK';
  const busValue = busValueForVisual({ visual, timeMs });
  const queueTimeMs = visual === 'queue' || visual === 'rerun' ? worldTimeMs : timeMs;
  const busPulse = busPulseForVisual({ visual, timeMs: queueTimeMs });
  const busOpacity = visual === 'fleet' ? smooth((worldTimeMs - MOTION.busEnterMs) / MOTION.enterMs) : MOTION.unit;
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${ART_HEIGHT}"><defs>
      <pattern id="hatch" width="${STYLE.hatchWidth}" height="${STYLE.hatchWidth}" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <path d="M0 0V${STYLE.hatchWidth}" stroke="#1c4a27" stroke-width="${STYLE.hatchStroke}"/>
      </pattern></defs><rect width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" fill="${BACKGROUND}"/>`,
    connectorLines({ slots, hasQueue, timeMs, visual }),
    `<g opacity="${busOpacity.toFixed(OPACITY_DIGITS)}">${busBox({ label: busLabel, value: busValue, pulse: busPulse })}</g>`,
    ...slots.map((slot) => slotBox({ slot, worldTimeMs, visual })),
    agentBand({ worldTimeMs, isOpening }),
    connectorPackets({ slots, hasQueue, worldTimeMs, visual }),
    detailForVisual({ visual, timeMs: visual === 'rerun' ? worldTimeMs : timeMs }),
    '</svg>'
  ];
  return pieces.join('');
}

function smooth(progress: number): number {
  const clamped = Math.max(0, Math.min(MOTION.unit, progress));
  return clamped * clamped * (MOTION.cubic - MOTION.double * clamped);
}

function slotLeft(index: number): number {
  return WORLD.boxLeft + index * (WORLD.boxWidth + WORLD.boxGap);
}

function slotCenter(index: number): number {
  return slotLeft(index) + WORLD.boxWidth * MOTION.half;
}

function iconCenter(column: number): number {
  return WORLD.bandLeft + column * WORLD.bandGapX + WORLD.iconSize * MOTION.half;
}

function line(path: string): string {
  return `<path d="${path}" fill="none" stroke="${GREY}" stroke-width="${STYLE.connectorStroke}" stroke-dasharray="${STYLE.connectorDash}"/>`;
}

function packet(left: number, top: number): string {
  return `<circle cx="${left.toFixed(COORD_DIGITS)}" cy="${top.toFixed(COORD_DIGITS)}" r="${WORLD.packetRadius}" fill="${ORANGE}"/>`;
}

type PacketOnParams = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  timeMs: number;
  seed: number;
};

function packetOn({ fromX, fromY, toX, toY, timeMs, seed }: PacketOnParams): string {
  const periodMs = MOTION.packetPeriodMs + ((seed * MOTION.packetPeriodStrideMs) % MOTION.packetPeriodSpreadMs);
  const phaseMs = (timeMs + ((seed * MOTION.packetOffsetStrideMs) % periodMs)) % periodMs;
  if (phaseMs >= MOTION.packetFlightMs) {
    return '';
  }
  const progress = smooth(phaseMs / MOTION.packetFlightMs);
  return packet(fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress);
}

function arrivalPulse(timeMs: number, seed: number): number {
  const periodMs = MOTION.packetPeriodMs + ((seed * MOTION.packetPeriodStrideMs) % MOTION.packetPeriodSpreadMs);
  const phaseMs = (timeMs + ((seed * MOTION.packetOffsetStrideMs) % periodMs)) % periodMs;
  if (phaseMs < MOTION.packetFlightMs || phaseMs > MOTION.packetFlightMs + MOTION.pulseMs) {
    return 0;
  }
  return MOTION.unit - (phaseMs - MOTION.packetFlightMs) / MOTION.pulseMs;
}

type BoxShapeParams = {
  left: number;
  top: number;
  width: number;
  height: number;
  pulse: number;
};

function boxShape({ left, top, width, height, pulse }: BoxShapeParams): string {
  const stroke = pulse > 0 ? GREEN_BRIGHT : GREEN;
  const strokeWidth = STYLE.boxStroke + pulse * MOTION.pulseExtraWidth;
  return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#122116" stroke="${stroke}" stroke-width="${strokeWidth}"/>
    <rect x="${left + STYLE.boxInnerInset}" y="${top + STYLE.boxInnerInset}" width="${width - STYLE.boxInnerPair}" height="${height - STYLE.boxInnerPair}" fill="url(#hatch)" stroke="${stroke}" stroke-width="${STYLE.boxStroke}" stroke-dasharray="${STYLE.boxDash}"/>`;
}

type BusBoxParams = {
  label: string;
  value: string;
  pulse: number;
};

function busBox({ label, value, pulse }: BusBoxParams): string {
  const shape = boxShape({
    left: WORLD.busLeft,
    top: WORLD.busTop,
    width: WORLD.busWidth,
    height: WORLD.busHeight,
    pulse
  });
  const centerY = WORLD.busTop + WORLD.busLabelY;
  const valueMarkup =
    value === ''
      ? ''
      : `<text x="${WORLD.busCountX}" y="${centerY}" text-anchor="end" fill="${WHITE}" font-size="${WORLD.labelSize}" font-family="Menlo,Consolas,monospace">${escapeHtml(value)}</text>`;
  return `<g>${shape}<text x="${WORLD.centerX}" y="${centerY}" text-anchor="middle" fill="${WHITE}" font-size="${WORLD.labelSize}" font-family="Menlo,Consolas,monospace">${label}</text>${valueMarkup}</g>`;
}

type SlotBoxParams = {
  slot: Slot;
  worldTimeMs: number;
  visual: string;
};

function slotBox({ slot, worldTimeMs, visual }: SlotBoxParams): string {
  const left = slotLeft(slot.index);
  let progress = MOTION.unit;
  if (visual === 'fleet') {
    progress = smooth((worldTimeMs - MOTION.boxesEnterMs - slot.index * MOTION.batchArrivalMs) / MOTION.enterMs);
  } else if (visual === 'end') {
    progress = MOTION.unit - smooth(worldTimeMs / MOTION.endClearMs);
  }
  let pulse = arrivalPulse(worldTimeMs, slot.index + MOTION.unit);
  if (visual === 'checks') {
    const elapsedMs = worldTimeMs - MOTION.checkPassMs;
    pulse =
      slot.index === 0 && elapsedMs >= 0 && elapsedMs < MOTION.pulseMs ? MOTION.unit - elapsedMs / MOTION.pulseMs : 0;
  }
  if (visual === 'batch' && slot.index === APPROVAL_SLOT) {
    const elapsedMs = worldTimeMs - MOTION.batchApproveMs;
    pulse = elapsedMs >= 0 && elapsedMs < MOTION.pulseMs ? MOTION.unit - elapsedMs / MOTION.pulseMs : 0;
  }
  const shape = boxShape({ left, top: WORLD.boxTop, width: WORLD.boxWidth, height: WORLD.boxHeight, pulse });
  const centerX = slotCenter(slot.index);
  const hasDetails = slot.hasDetails === true || (slot.lines?.length ?? 0) > 0;
  const labelY = WORLD.boxTop + (hasDetails ? WORLD.boxLabelY : WORLD.boxCenterLabelY);
  const lines = (slot.lines ?? [])
    .map((value, index) => {
      const top = WORLD.boxTop + WORLD.boxLineStartY + index * WORLD.boxLineGap;
      return `<text x="${centerX}" y="${top}" text-anchor="middle" fill="${WHITE}" font-size="${WORLD.labelSize}" font-family="Menlo,Consolas,monospace">${escapeHtml(value)}</text>`;
    })
    .join('');
  return `<g opacity="${progress.toFixed(OPACITY_DIGITS)}">${shape}<text x="${centerX}" y="${labelY}" text-anchor="middle" fill="${WHITE}" font-size="${WORLD.labelSize}" font-family="Menlo,Consolas,monospace">${escapeHtml(slot.label)}</text>${lines}</g>`;
}
type ConnectorsParams = {
  slots: Slot[];
  hasQueue: boolean;
  timeMs: number;
  visual: string;
};

function connectorLines({ slots, hasQueue, timeMs, visual }: ConnectorsParams): string {
  const pieces: string[] = [];
  const entry = visual === 'fleet' ? smooth((timeMs - MOTION.busEnterMs) / MOTION.enterMs) : MOTION.unit;
  const topOpacity = visual === 'end' ? MOTION.unit - smooth(timeMs / MOTION.endClearMs) : MOTION.unit;
  for (const slot of slots) {
    const centerX = slotCenter(slot.index);
    const endY = WORLD.connectorTop + (WORLD.connectorBottom - WORLD.connectorTop) * entry;
    pieces.push(
      `<g opacity="${topOpacity.toFixed(OPACITY_DIGITS)}">${line(`M${centerX} ${WORLD.connectorTop}V${endY}`)}</g>`
    );
  }
  let queueOpacity = MOTION.unit;
  let laneOpacity = MOTION.unit;
  if (visual === 'queue') {
    queueOpacity = smooth(timeMs / MOTION.laneRevealMs);
    laneOpacity = MOTION.unit - queueOpacity;
  } else if (visual === 'lanes') {
    laneOpacity = smooth(timeMs / MOTION.laneRevealMs);
    queueOpacity = MOTION.unit - laneOpacity;
  } else if (visual === 'fleet') {
    laneOpacity = smooth((timeMs - MOTION.busEnterMs) / MOTION.enterMs);
  }
  const oldLaneCount = visual === 'queue' ? WORLD.lowerConnectorCount : 0;
  for (let index = 0; index < oldLaneCount; index += MOTION.unit) {
    const centerX = iconCenter(index * WORLD.lowerConnectorStride);
    pieces.push(
      `<g opacity="${laneOpacity.toFixed(OPACITY_DIGITS)}">${line(`M${centerX} ${WORLD.lowerConnectorTop}V${WORLD.lowerConnectorBottom}`)}</g>`
    );
  }
  if (hasQueue) {
    pieces.push(
      `<g opacity="${queueOpacity.toFixed(OPACITY_DIGITS)}">${line(`M${WORLD.centerX} ${WORLD.lowerConnectorTop}V${WORLD.lowerConnectorBottom}`)}${line(`M${WORLD.queueStartX} ${WORLD.queueY}H${WORLD.queueEndX}`)}</g>`
    );
  } else {
    if (visual === 'lanes') {
      pieces.push(
        `<g opacity="${queueOpacity.toFixed(OPACITY_DIGITS)}">${line(`M${WORLD.centerX} ${WORLD.lowerConnectorTop}V${WORLD.lowerConnectorBottom}`)}${line(`M${WORLD.queueStartX} ${WORLD.queueY}H${WORLD.queueEndX}`)}</g>`
      );
    }
    const connectorCount = visual === 'batch' ? WORLD.batchConnectorCount : WORLD.lowerConnectorCount;
    const connectorStride = visual === 'batch' ? WORLD.batchConnectorStride : WORLD.lowerConnectorStride;
    for (let index = 0; index < connectorCount; index += MOTION.unit) {
      const centerX = iconCenter(index * connectorStride);
      pieces.push(
        `<g opacity="${laneOpacity.toFixed(OPACITY_DIGITS)}">${line(`M${centerX} ${WORLD.lowerConnectorTop}V${WORLD.lowerConnectorBottom}`)}</g>`
      );
    }
  }
  return pieces.join('');
}

type AgentBandParams = {
  worldTimeMs: number;
  isOpening: boolean;
};

function agentBand({ worldTimeMs, isOpening }: AgentBandParams): string {
  const pieces: string[] = [];
  for (let row = 0; row < WORLD.bandRows; row += MOTION.unit) {
    for (let column = 0; column < WORLD.bandColumns; column += MOTION.unit) {
      const index = row * WORLD.bandColumns + column;
      const progress = isOpening ? smooth((worldTimeMs - index * MOTION.agentStaggerMs) / MOTION.enterMs) : MOTION.unit;
      const drift = Math.sin(worldTimeMs / MOTION.driftMs + row) * MOTION.driftPx;
      const left = WORLD.bandLeft + column * WORLD.bandGapX + drift;
      const top = WORLD.bandTop + row * WORLD.bandGapY + (MOTION.unit - progress) * MOTION.agentRisePx;
      const centerX = WORLD.bandLeft + column * WORLD.bandGapX + WORLD.iconSize * MOTION.half;
      const centerY = WORLD.bandTop + row * WORLD.bandGapY + WORLD.iconSize * MOTION.half;
      pieces.push(
        `<circle cx="${centerX}" cy="${centerY}" r="${STYLE.iconDotRadius}" fill="${BLUE}" opacity="${(MOTION.unit - progress).toFixed(OPACITY_DIGITS)}"/>`
      );
      pieces.push(`<g fill="none" stroke="${BLUE}" stroke-width="${STYLE.iconStroke}" opacity="${progress.toFixed(OPACITY_DIGITS)}">
        <rect x="${left + STYLE.iconCapLeft}" y="${top}" width="${STYLE.iconCapWidth}" height="${STYLE.iconCapWidth}" rx="1"/>
        <rect x="${left}" y="${top + STYLE.iconBodyTop}" width="${STYLE.iconBodyWidth}" height="${STYLE.iconCapWidth}" rx="1"/>
        <rect x="${left + STYLE.iconRight}" y="${top + STYLE.iconBodyTop}" width="${STYLE.iconBodyWidth}" height="${STYLE.iconCapWidth}" rx="1"/>
      </g>`);
    }
  }
  return pieces.join('');
}

type ConnectorPacketsParams = {
  slots: Slot[];
  hasQueue: boolean;
  worldTimeMs: number;
  visual: string;
};

function connectorPackets({ slots, hasQueue, worldTimeMs, visual }: ConnectorPacketsParams): string {
  if (visual === 'fleet' && worldTimeMs < MOTION.packetsEnterMs) {
    return '';
  }
  const pieces: string[] = [];
  let activeSlots = slots;
  if (visual === 'batch' || visual === 'end') {
    activeSlots = [];
  } else if (visual === 'checks') {
    activeSlots = slots.slice(0, MOTION.unit);
  }
  for (const slot of activeSlots) {
    if (visual === 'checks' && worldTimeMs < MOTION.checkRunMs) {
      continue;
    }
    const centerX = slotCenter(slot.index);
    pieces.push(
      packetOn({
        fromX: centerX,
        fromY: WORLD.connectorTop,
        toX: centerX,
        toY: WORLD.connectorBottom,
        timeMs: worldTimeMs,
        seed: slot.index + MOTION.unit
      })
    );
  }
  if (hasQueue) {
    pieces.push(queuePackets(worldTimeMs));
  } else if (visual !== 'batch' && visual !== 'checks') {
    for (let index = 0; index < WORLD.lowerConnectorCount; index += MOTION.unit) {
      const centerX = iconCenter(index * WORLD.lowerConnectorStride);
      pieces.push(
        packetOn({
          fromX: centerX,
          fromY: WORLD.lowerConnectorBottom,
          toX: centerX,
          toY: WORLD.lowerConnectorTop,
          timeMs: worldTimeMs,
          seed: index + WORLD.boxCount
        })
      );
    }
  }
  return pieces.join('');
}

function queuePackets(worldTimeMs: number): string {
  const pieces: string[] = [];
  const phaseMs = worldTimeMs % MOTION.queueLandMs;
  const progress = smooth(phaseMs / MOTION.queueLaunchMs);
  for (let index = MOTION.unit; index < WORLD.queueCount; index += MOTION.unit) {
    const fromOffset = queueOffset(index);
    const toOffset = queueOffset(index - MOTION.unit);
    pieces.push(packet(WORLD.queueEndX - fromOffset + (fromOffset - toOffset) * progress, WORLD.queueY));
  }
  const rearX = WORLD.queueEndX - queueOffset(WORLD.queueCount - MOTION.unit);
  pieces.push(packet(WORLD.queueStartX + (rearX - WORLD.queueStartX) * progress, WORLD.queueY));
  if (progress < MOTION.unit) {
    pieces.push(packet(WORLD.centerX, WORLD.queueY - (WORLD.queueY - WORLD.lowerConnectorTop) * progress));
  }
  return pieces.join('');
}

function queueOffset(index: number): number {
  return index * WORLD.queueBaseGap + index * index * WORLD.queueGapGrowth;
}
type SlotsParams = {
  visual: string;
  timeMs: number;
};

function slotsForVisual({ visual, timeMs }: SlotsParams): Slot[] {
  switch (visual) {
    case 'fleet':
    case 'queue':
    case 'rerun':
      return [
        { index: 0, label: 'APP' },
        { index: 1, label: 'APP' },
        { index: 2, label: 'APP' },
        { index: 3, label: 'APP' },
        { index: 4, label: 'APP' }
      ];
    case 'late-conflict':
      return [
        { index: 0, label: 'APP' },
        { index: 1, label: 'c-3' },
        { index: 2, label: 'src/routes.mjs' },
        { index: 3, label: 'c-5' },
        { index: 4, label: 'APP' }
      ];
    case 'lanes':
    case 'dependency':
    case 'brand':
      return [
        { index: 0, label: 'src/routes.mjs' },
        { index: 1, label: 'src/cart' },
        { index: 2, label: 'src/catalog' },
        { index: 3, label: 'src/search' },
        { index: 4, label: 'docs' }
      ];
    case 'overlaps':
      return [
        { index: 0, label: 'c-3', hasDetails: true, lines: timeMs >= MOTION.overlapPathsMs ? ['src/routes.mjs'] : [] },
        { index: 1, label: 'c-5', hasDetails: true, lines: timeMs >= MOTION.overlapPathsMs ? ['src/routes.mjs'] : [] },
        ...(timeMs >= MOTION.overlapMergeMs
          ? [
              {
                index: 2,
                label: 'MERGE',
                hasDetails: true,
                lines: timeMs >= MOTION.overlapResultMs ? ['c-3 → c-5'] : []
              }
            ]
          : []),
        { index: 3, label: 'src/cart' },
        { index: 4, label: 'LANE' }
      ];
    case 'resolution':
      return [
        { index: 0, label: 'c-3', lines: ["t1  'search',"] },
        { index: 1, label: 'src/routes.mjs', lines: ["'home',", "'cart',"] },
        ...(timeMs >= MOTION.resolutionModelMs
          ? [
              {
                index: 2,
                label: 'WORKERS AI',
                hasDetails: true,
                lines: timeMs >= MOTION.resolutionAnswerMs ? ['[ t1, o1 ]'] : []
              }
            ]
          : []),
        { index: 3, label: 'RESULT', hasDetails: true },
        { index: 4, label: 'c-5', lines: ["o1  'orders',"] }
      ];
    case 'batch':
      return [
        { index: 0, label: 'LANE 1' },
        { index: 1, label: 'LANE 2' },
        { index: 2, label: 'APPROVAL' },
        { index: 3, label: 'LANE 3' },
        { index: 4, label: 'LANE 4' }
      ];
    case 'checks': {
      const isChanged = timeMs >= MOTION.checkHashMs;
      return [
        { index: 0, label: 'src/routes.mjs', lines: [isChanged ? 'c51183' : '7c7959'] },
        { index: 2, label: 'src/cart', lines: ['d7e7df'] },
        { index: 4, label: 'src/catalog', lines: ['74c53e'] }
      ];
    }
    case 'everything':
      return [
        { index: 0, label: 'BATCH 1' },
        { index: 1, label: 'BATCH 2' },
        { index: 2, label: 'BATCH 3' },
        { index: 3, label: 'BATCH 4' }
      ];
    case 'agent':
      return [
        { index: 0, label: 'AGENT' },
        { index: 1, label: 'COMMUTE START' },
        { index: 2, label: 'GIT PUSH' },
        { index: 3, label: 'COMMUTE WAIT' },
        { index: 4, label: 'TRUNK' }
      ];
    case 'architecture':
    case 'end':
      return [
        { index: 0, label: 'WORKERS' },
        { index: 1, label: 'ARTIFACTS' },
        { index: 2, label: 'DURABLE OBJECT' },
        { index: 3, label: 'CONTAINERS' },
        { index: 4, label: 'WORKERS AI' }
      ];
    default:
      throw new Error(`UNKNOWN_SCENE: ${visual}`);
  }
}

type BusValueParams = {
  visual: string;
  timeMs: number;
};

function busValueForVisual({ visual, timeMs }: BusValueParams): string {
  switch (visual) {
    case 'late-conflict':
      return timeMs >= MOTION.conflictLandMs ? 'c-3' : '';
    case 'batch':
      return `${batchLanded(timeMs)} / 16`;
    case 'everything':
      return `${everythingLanded(timeMs)} / 20`;
    default:
      return '';
  }
}

function busPulseForVisual({ visual, timeMs }: BusValueParams): number {
  if (visual === 'queue' || visual === 'rerun') {
    const phaseMs = (timeMs - MOTION.queueLaunchMs + MOTION.queueLandMs) % MOTION.queueLandMs;
    return phaseMs < MOTION.pulseMs ? MOTION.unit - phaseMs / MOTION.pulseMs : 0;
  }
  if (visual === 'late-conflict') {
    const elapsedMs = timeMs - MOTION.conflictLandMs;
    return elapsedMs >= 0 && elapsedMs < MOTION.pulseMs ? MOTION.unit - elapsedMs / MOTION.pulseMs : 0;
  }
  if (visual === 'checks') {
    const elapsedMs = timeMs - MOTION.checkLandingMs;
    return elapsedMs >= 0 && elapsedMs < MOTION.pulseMs ? MOTION.unit - elapsedMs / MOTION.pulseMs : 0;
  }
  if (visual === 'batch') {
    const landed = batchLanded(timeMs);
    const elapsedMs = timeMs - MOTION.batchApproveMs - (landed - MOTION.unit) * MOTION.batchArrivalMs;
    return landed > 0 && elapsedMs >= 0 && elapsedMs < MOTION.pulseMs ? MOTION.unit - elapsedMs / MOTION.pulseMs : 0;
  }
  return 0;
}

function batchLanded(timeMs: number): number {
  if (timeMs < MOTION.batchApproveMs) {
    return 0;
  }
  let landed = 0;
  for (let index = 0; index < BATCH_TOTAL; index += MOTION.unit) {
    const launchRank = (index * MOTION.batchShuffleStride) % BATCH_TOTAL;
    const startMs = MOTION.batchApproveMs + launchRank * MOTION.batchLaunchSpacingMs;
    if (timeMs >= startMs + MOTION.batchFlightMs) {
      landed += MOTION.unit;
    }
  }
  return landed;
}

function everythingLanded(timeMs: number): number {
  let landed = 0;
  for (let batch = 0; batch < BATCH_COUNT; batch += MOTION.unit) {
    if (timeMs >= batch * MOTION.everythingBatchMs + MOTION.everythingFlightMs) {
      landed += WORLD.boxCount;
    }
  }
  return landed;
}
type VisualDetailParams = {
  visual: string;
  timeMs: number;
};

function detailForVisual({ visual, timeMs }: VisualDetailParams): string {
  switch (visual) {
    case 'rerun':
      return checkResetBars(timeMs);
    case 'late-conflict':
      return timeMs >= MOTION.conflictStopMs
        ? packet(
            slotCenter(RESULT_SLOT),
            WORLD.connectorTop + (WORLD.connectorBottom - WORLD.connectorTop) * MOTION.half
          )
        : '';
    case 'dependency':
      return packet(slotCenter(0), WORLD.connectorTop + (WORLD.connectorBottom - WORLD.connectorTop) * MOTION.half);
    case 'resolution':
      return resolutionResultLines(timeMs);
    case 'batch':
      return batchPackets(timeMs);
    case 'everything':
      return everythingPackets(timeMs);
    case 'end':
      return brandMark(timeMs);
    default:
      return '';
  }
}

function checkResetBars(timeMs: number): string {
  const progress = ((timeMs - MOTION.queueLaunchMs + MOTION.queueLandMs) % MOTION.queueLandMs) / MOTION.queueLandMs;
  const pieces: string[] = [];
  for (let index = 0; index < WORLD.boxCount; index += MOTION.unit) {
    const left = slotLeft(index) + STYLE.boxInnerInset * MOTION.double;
    const top = WORLD.boxTop + WORLD.boxHeight - STYLE.boxInnerInset * MOTION.double;
    const width = (WORLD.boxWidth - STYLE.boxInnerInset * MOTION.double * MOTION.double) * progress;
    pieces.push(`<path d="M${left} ${top}h${width}" stroke="${GREEN_BRIGHT}" stroke-width="${STYLE.boxStroke}"/>`);
  }
  return pieces.join('');
}

const RESOLUTION_LINES = ["'home',", "'cart',", "'search',", "'orders',"];

function resolutionResultLines(timeMs: number): string {
  const pieces: string[] = [];
  const centerX = slotCenter(RESULT_SLOT);
  for (const [index, value] of RESOLUTION_LINES.entries()) {
    const startMs = MOTION.resolutionApplyMs + index * MOTION.resolutionLineStaggerMs;
    const progress = smooth((timeMs - startMs) / MOTION.resolutionLineMs);
    if (progress <= 0) {
      continue;
    }
    const left = centerX + (MOTION.unit - progress) * WORLD.boxGap;
    const top = WORLD.boxTop + WORLD.resultLineStartY + index * WORLD.resultLineGap;
    pieces.push(
      `<text x="${left}" y="${top}" text-anchor="middle" fill="${WHITE}" opacity="${progress.toFixed(OPACITY_DIGITS)}" font-size="${WORLD.labelSize}" font-family="Menlo,Consolas,monospace">${escapeHtml(value)}</text>`
    );
  }
  return pieces.join('');
}

function batchPackets(timeMs: number): string {
  const pieces: string[] = [];
  for (let index = 0; index < BATCH_TOTAL; index += MOTION.unit) {
    const launchRank = (index * MOTION.batchShuffleStride) % BATCH_TOTAL;
    const centerX = iconCenter(index * WORLD.batchConnectorStride);
    const startY = WORLD.lowerConnectorBottom - WORLD.packetRadius * MOTION.double;
    const startMs = MOTION.batchApproveMs + launchRank * MOTION.batchLaunchSpacingMs;
    if (index >= WORLD.lowerConnectorCount && timeMs < startMs) {
      continue;
    }
    const progress = smooth((timeMs - startMs) / MOTION.batchFlightMs);
    if (progress >= MOTION.unit) {
      continue;
    }
    const top = startY + (WORLD.lowerConnectorTop - startY) * progress;
    pieces.push(packet(centerX, top));
  }
  return pieces.join('');
}

function everythingPackets(timeMs: number): string {
  const pieces: string[] = [];
  for (let index = 0; index < CHANGE_TOTAL; index += MOTION.unit) {
    const batch = Math.floor(index / WORLD.boxCount);
    const connectorIndex = index % WORLD.boxCount;
    const centerX = slotCenter(connectorIndex);
    const startMs = batch * MOTION.everythingBatchMs;
    const progress = smooth((timeMs - startMs) / MOTION.everythingFlightMs);
    if (progress >= MOTION.unit) {
      continue;
    }
    const top = WORLD.connectorTop + (WORLD.connectorBottom - WORLD.connectorTop) * progress;
    pieces.push(packet(centerX, top));
  }
  return pieces.join('');
}

function brandMark(timeMs: number): string {
  const opacity = smooth((timeMs - MOTION.endClearMs) / MOTION.brandEnterMs);
  const tileX = STYLE.markLeft;
  const tileY = STYLE.markTop;
  const markScale = STYLE.markTileSize / MARK_VIEWBOX_SIZE;
  const mark = `<g transform="translate(${tileX} ${tileY})">
    <rect width="${STYLE.markTileSize}" height="${STYLE.markTileSize}" rx="${STYLE.markTileRadius}" fill="${BLUE}"/>
    <path d="M2 5h5l4 6h3M2 11h5l4-6h3" transform="scale(${markScale})" fill="none" stroke="${WHITE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
  return `<g opacity="${opacity.toFixed(OPACITY_DIGITS)}">${mark}
    <text x="${STYLE.markNameX}" y="${STYLE.markNameY}" fill="${WHITE}" font-size="${STYLE.markNameSize}" font-weight="650" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Commute</text>
    <text x="${WORLD.centerX}" y="${STYLE.markUrlY}" text-anchor="middle" fill="${WHITE}" font-size="${STYLE.markUrlSize}" font-family="Menlo,Consolas,monospace">github.com/lucrise-llc/commute</text>
  </g>`;
}

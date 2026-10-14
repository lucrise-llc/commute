import type { Page } from 'playwright';

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import type { FrameEntry } from './clips.ts';

import { FADE_MS, FRAME_MS } from './clips.ts';
import { captionMarkup, htmlDocument, VIDEO_HEIGHT, VIDEO_WIDTH } from './graphics.ts';

// oxlint-disable no-magic-numbers -- Numeric literals in the illustration are authored SVG coordinates and sizes.

const BACKGROUND = '#101010';
const BLUE = '#1868bc';
const GREEN = '#2dc242';
const ORANGE = '#df3d17';
const WHITE = '#f4fcf3';
const GREY = '#5e5e5e';
const CAPTION_HEIGHT = 120;
const ART_HEIGHT = VIDEO_HEIGHT - CAPTION_HEIGHT;
const TRANSITION_MS = 800;
const FRAME_DIGITS = 6;
const SHEET_COLUMNS = 2;
const SHEET_SAMPLE_COUNT = 4;
const READING_CHARS_PER_SECOND = 15;
const READING_LEAD_MS = 300;
const MS_PER_SECOND = 1_000;
const GRID_COLUMNS = 25;
const GRID_ROWS = 9;
const GRID_GAP_X = 57;
const GRID_GAP_Y = 60;
const GRID_START_X = 265;
const GRID_START_Y = 195;
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
      const priorVisual = scenes[sceneIndex - 1]?.visual;
      const art = sceneArt({ visual: scene.visual, priorVisual, timeMs, durationMs });
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
  await page.screenshot({ path });
  await page.setContent(STAGE_HTML);
}

type SceneArtParams = {
  visual: string;
  priorVisual?: string;
  timeMs: number;
  durationMs: number;
};

function sceneArt({ visual, priorVisual, timeMs, durationMs }: SceneArtParams): string {
  const scene = visualArt({ visual, timeMs, durationMs });
  let content = `<g>${scene}</g>`;
  if (priorVisual !== undefined && timeMs < TRANSITION_MS) {
    const shift = smooth(timeMs / TRANSITION_MS) * VIDEO_WIDTH;
    const prior = visualArt({ visual: priorVisual, timeMs: durationMs, durationMs });
    content = `<g transform="translate(${-shift} 0)">${prior}</g><g transform="translate(${VIDEO_WIDTH - shift} 0)">${scene}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${ART_HEIGHT}">
    <defs><pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V12" stroke="#1c4a27" stroke-width="2"/></pattern></defs>
    <rect width="${VIDEO_WIDTH}" height="${ART_HEIGHT}" fill="${BACKGROUND}"/>${content}</svg>`;
}

type VisualArtParams = {
  visual: string;
  timeMs: number;
  durationMs: number;
};

function visualArt({ visual, timeMs, durationMs }: VisualArtParams): string {
  const phase = Math.min(1, timeMs / durationMs);
  const packet = (timeMs / MS_PER_SECOND) % 1;
  switch (visual) {
    case 'fleet':
      return `${heading('MANY AGENTS · ONE REPOSITORY')}${agentGrid(timeMs)}${box({ left: 760, top: 765, width: 400, height: 76, label: 'TRUNK' })}`;
    case 'queue':
      return `${heading('ONE LINE')}${queueArt(packet)}`;
    case 'rerun':
      return `${heading('TRUNK MOVES · CHECKS RESTART')}${rerunArt(packet)}`;
    case 'late-conflict':
      return `${heading('CONFLICT FOUND LATE')}${conflictArt(packet)}`;
    case 'lanes':
      return `${heading('ONE LANE PER AREA OF CODE')}${lanesArt(packet, false)}`;
    case 'dependency':
      return `${heading('ORDER ONLY WHERE IT MATTERS')}${lanesArt(packet, true)}`;
    case 'brand':
      return `${agentGrid(timeMs, 0.16)}<text x="960" y="470" text-anchor="middle" fill="${WHITE}" font-size="154" font-weight="700" font-family="Arial,sans-serif">Commute</text><text x="960" y="555" text-anchor="middle" fill="${WHITE}" font-size="43" font-family="Arial,sans-serif">Many coding agents, one repository.</text>`;
    case 'overlaps':
      return `${heading('OVERLAPS ARE KNOWN AT THE START')}${overlapsArt(packet)}`;
    case 'resolution':
      return `${heading('RESOLVED AT THE FIRST PUSH')}${resolutionArt(phase)}`;
    case 'batch':
      return `${heading('ONE APPROVAL · ONE BATCH')}${batchArt(packet)}`;
    case 'checks':
      return `${heading('RESULTS FOLLOW CONTENT')}${checksArt(packet)}`;
    case 'everything':
      return `${heading('EVERYTHING LANDS')}${everythingArt(phase)}`;
    case 'agent':
      return `${heading("WHAT BOB'S AGENT SAW")}${agentArt(packet)}`;
    case 'architecture':
      return `${heading('COMMUTE RUNS ON CLOUDFLARE')}${architectureArt(packet)}`;
    case 'end':
      return endArt(timeMs);
    default:
      throw new Error(`UNKNOWN_SCENE: ${visual}`);
  }
}

function smooth(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function heading(label: string): string {
  return `<text x="160" y="115" fill="${WHITE}" font-size="45" font-weight="700" font-family="Arial,sans-serif" letter-spacing="3">${label}</text><path d="M160 145H1760" stroke="${GREY}" stroke-dasharray="5 8"/>`;
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

function box({ left, top, width, height, label, color = GREEN, fontSize = 29 }: BoxParams): string {
  return `<g><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#122116" stroke="${color}" stroke-width="3"/>
    <rect x="${left + 8}" y="${top + 8}" width="${width - 16}" height="${height - 16}" fill="url(#hatch)" stroke="${color}" stroke-dasharray="7 6" opacity=".85"/>
    <text x="${left + width / 2}" y="${top + height / 2 + fontSize / 3}" text-anchor="middle" fill="${WHITE}" font-size="${fontSize}" font-family="Menlo,Consolas,monospace">${label}</text></g>`;
}

function line(path: string): string {
  return `<path d="${path}" fill="none" stroke="${GREY}" stroke-width="2" stroke-dasharray="7 9"/>`;
}

function dot(left: number, top: number): string {
  return `<circle cx="${left}" cy="${top}" r="8" fill="${ORANGE}"/>`;
}

type AgentIconParams = {
  left: number;
  top: number;
  opacity?: number;
};

function agentIcon({ left, top, opacity = 1 }: AgentIconParams): string {
  return `<g fill="none" stroke="${BLUE}" stroke-width="2" opacity="${opacity}"><rect x="${left + 7}" y="${top}" width="10" height="10" rx="1"/><rect x="${left}" y="${top + 13}" width="11" height="10" rx="1"/><rect x="${left + 13}" y="${top + 13}" width="11" height="10" rx="1"/></g>`;
}

function agentGrid(timeMs: number, opacity = 1): string {
  const pieces: string[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const index = row * GRID_COLUMNS + column;
      const rise = smooth((timeMs - index * 9) / 850);
      const left = GRID_START_X + column * GRID_GAP_X;
      const top = GRID_START_Y + row * GRID_GAP_Y + (1 - rise) * 70;
      pieces.push(
        `<circle cx="${left + 12}" cy="${GRID_START_Y + row * GRID_GAP_Y + 12}" r="3" fill="${BLUE}" opacity="${opacity * (1 - rise)}"/>`
      );
      pieces.push(agentIcon({ left, top, opacity: opacity * rise }));
    }
  }
  return pieces.join('');
}

function queueArt(packet: number): string {
  const items: string[] = [
    box({ left: 1_420, top: 400, width: 310, height: 110, label: 'TRUNK' }),
    line('M190 455H1420')
  ];
  for (let index = 0; index < 9; index += 1) {
    const left = 260 + index * 126;
    items.push(box({ left, top: 405, width: 96, height: 96, label: `c-${index + 1}`, color: BLUE, fontSize: 22 }));
    items.push(agentIcon({ left: left + 36, top: 325 }));
  }
  items.push(dot(190 + packet * 1_230, 455));
  return items.join('');
}

function rerunArt(packet: number): string {
  const items = [box({ left: 1_450, top: 360, width: 300, height: 105, label: 'TRUNK' }), line('M210 415H1450')];
  for (let index = 0; index < 6; index += 1) {
    const left = 215 + index * 190;
    items.push(box({ left, top: 370, width: 134, height: 88, label: `c-${index + 1}`, color: BLUE, fontSize: 24 }));
    items.push(line(`M${left + 67} 460V610`));
    items.push(box({ left: left - 4, top: 610, width: 142, height: 67, label: 'CHECK', color: ORANGE, fontSize: 19 }));
    items.push(dot(left + 67, 460 + ((packet + index / 6) % 1) * 150));
  }
  return items.join('');
}

function conflictArt(packet: number): string {
  return `${box({ left: 250, top: 345, width: 490, height: 120, label: 'c-3 · SEARCH' })}
    ${box({ left: 1_180, top: 345, width: 490, height: 120, label: 'c-5 · ORDERS' })}
    ${line('M740 405H1180')}${dot(740 + packet * 440, 405)}
    ${box({ left: 710, top: 575, width: 500, height: 95, label: 'src/routes.mjs', color: BLUE })}
    ${line('M495 465L830 575')}${line('M1425 465L1090 575')}
    <text x="960" y="750" text-anchor="middle" fill="${ORANGE}" font-size="50" font-family="Menlo,monospace">same line · different inserts</text>`;
}

function lanesArt(packet: number, hasDependency: boolean): string {
  const labels = ['src/routes.mjs', 'src/cart', 'src/catalog', 'src/search'];
  const pieces = [box({ left: 1_520, top: 270, width: 250, height: 485, label: 'TRUNK', fontSize: 34 })];
  for (const [index, label] of labels.entries()) {
    const top = 305 + index * 135;
    pieces.push(
      `<text x="160" y="${top + 15}" fill="${WHITE}" font-size="27" font-family="Menlo,monospace">${label}</text>`
    );
    pieces.push(line(`M420 ${top}H1520`));
    const changeCount = index === 0 ? 2 : 3;
    for (let change = 0; change < changeCount; change += 1) {
      let changeLabel = 'CHANGE';
      if (index === 0 && change === 0) {
        changeLabel = 'c-3';
      } else if (index === 0 && change === 1) {
        changeLabel = 'c-5';
      }
      pieces.push(
        box({
          left: 560 + change * 285,
          top: top - 38,
          width: 130,
          height: 76,
          label: changeLabel,
          color: BLUE,
          fontSize: 19
        })
      );
    }
    pieces.push(dot(420 + ((packet + index / 4) % 1) * 1_100, top));
  }
  if (hasDependency) {
    pieces.push(`<path d="M690 305H845" fill="none" stroke="${ORANGE}" stroke-width="4" stroke-dasharray="10 9"/>`);
    pieces.push(dot(845, 305));
    pieces.push(
      `<text x="960" y="815" text-anchor="middle" fill="${WHITE}" font-size="34" font-family="Menlo,monospace">c-5 waits for c-3 · other lanes move</text>`
    );
  }
  return pieces.join('');
}

function overlapsArt(packet: number): string {
  return `${box({ left: 180, top: 280, width: 420, height: 100, label: 'c-3 · SEARCH' })}
    ${box({ left: 750, top: 280, width: 420, height: 100, label: 'c-5 · ORDERS' })}
    ${box({ left: 1_320, top: 280, width: 420, height: 100, label: 'OTHER CHANGE' })}
    ${box({ left: 390, top: 640, width: 500, height: 100, label: 'src/routes.mjs', color: BLUE })}
    ${box({ left: 1_110, top: 640, width: 500, height: 100, label: 'src/cart/pricing.mjs', color: BLUE })}
    ${line('M390 380L590 640')}${line('M960 380L690 640')}${line('M1530 380L1360 640')}
    ${dot(390 + packet * 200, 380 + packet * 260)}${dot(960 - packet * 270, 380 + packet * 260)}
    <text x="640" y="815" text-anchor="middle" fill="${ORANGE}" font-size="34" font-family="Menlo,monospace">real merge check</text>
    <text x="1360" y="815" text-anchor="middle" fill="${WHITE}" font-size="34" font-family="Menlo,monospace">independent</text>`;
}

function resolutionArt(phase: number): string {
  return `${box({ left: 150, top: 260, width: 485, height: 100, label: 'c-3 · ADD SEARCH' })}
    ${box({ left: 1_285, top: 260, width: 485, height: 100, label: 'c-5 · ADD ORDERS' })}
    ${box({ left: 630, top: 460, width: 660, height: 100, label: 'WORKERS AI · LINE IDS' })}
    ${line('M392 360L770 460')}${line('M1528 360L1150 460')}
    <text x="390" y="420" text-anchor="middle" fill="${WHITE}" font-size="30" font-family="Menlo,monospace">'search',</text>
    <text x="1530" y="420" text-anchor="middle" fill="${WHITE}" font-size="30" font-family="Menlo,monospace">'orders',</text>
    ${line('M960 560V655')}${dot(960, 560 + phase * 95)}
    ${box({ left: 650, top: 660, width: 620, height: 190, label: '' })}
    <text x="820" y="705" fill="${WHITE}" font-size="28" font-family="Menlo,monospace">'home',</text>
    <text x="820" y="747" fill="${WHITE}" font-size="28" font-family="Menlo,monospace">'cart',</text>
    <text x="820" y="789" fill="${WHITE}" font-size="28" font-family="Menlo,monospace">'search',</text>
    <text x="820" y="831" fill="${WHITE}" font-size="28" font-family="Menlo,monospace">'orders',</text>`;
}

function batchArt(packet: number): string {
  const pieces = [
    box({ left: 680, top: 350, width: 570, height: 145, label: 'BATCH 1 · 16 READY', fontSize: 35 }),
    box({ left: 1_435, top: 365, width: 340, height: 115, label: 'TRUNK' }),
    line('M1250 423H1435')
  ];
  for (let index = 0; index < 16; index += 1) {
    const row = Math.floor(index / 8);
    const column = index % 8;
    pieces.push(agentIcon({ left: 225 + column * 52, top: 320 + row * 110 }));
  }
  pieces.push(line('M615 423H680'));
  pieces.push(dot(1_250 + packet * 185, 423));
  pieces.push(
    `<text x="965" y="660" text-anchor="middle" fill="${WHITE}" font-size="48" font-family="Menlo,monospace">ONE APPROVAL</text>`
  );
  return pieces.join('');
}

function checksArt(packet: number): string {
  return `${box({ left: 230, top: 290, width: 490, height: 95, label: 'src/routes.mjs · HASH', color: BLUE })}
    ${box({ left: 230, top: 440, width: 490, height: 95, label: 'src/cart · HASH', color: BLUE })}
    ${box({ left: 230, top: 590, width: 490, height: 95, label: 'src/catalog · HASH', color: BLUE })}
    ${line('M720 338H1110')}${line('M720 488H1110')}${line('M720 638H1110')}
    ${box({ left: 1_110, top: 290, width: 590, height: 95, label: 'ROUTES CHECK · RUNS', color: ORANGE })}
    ${box({ left: 1_110, top: 440, width: 590, height: 95, label: 'CART CHECK · KEPT' })}
    ${box({ left: 1_110, top: 590, width: 590, height: 95, label: 'CATALOG CHECK · KEPT' })}
    ${dot(720 + packet * 390, 338)}`;
}

function everythingArt(phase: number): string {
  const landed = Math.min(20, Math.floor(phase * 24));
  const pieces = [box({ left: 690, top: 470, width: 540, height: 135, label: `TRUNK · ${landed} / 20`, fontSize: 39 })];
  for (let index = 0; index < 20; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    pieces.push(agentIcon({ left: 650 + column * 65, top: 280 + row * 90, opacity: index < landed ? 1 : 0.3 }));
  }
  pieces.push(
    `<text x="960" y="750" text-anchor="middle" fill="${WHITE}" font-size="40" font-family="Menlo,monospace">FOUR LANDING BATCHES</text>`
  );
  return pieces.join('');
}

function agentArt(packet: number): string {
  return `${agentIcon({ left: 285, top: 395 })}${box({ left: 430, top: 345, width: 320, height: 115, label: 'commute start', fontSize: 27 })}
    ${box({ left: 800, top: 345, width: 320, height: 115, label: 'git push', fontSize: 27 })}
    ${box({ left: 1_170, top: 345, width: 320, height: 115, label: 'commute wait', fontSize: 27 })}
    ${line('M310 405H430')}${line('M750 405H800')}${line('M1120 405H1170')}${dot(430 + packet * 740, 405)}`;
}

function architectureArt(packet: number): string {
  return `${box({ left: 750, top: 245, width: 420, height: 105, label: 'WORKERS' })}
    ${box({ left: 160, top: 515, width: 400, height: 115, label: 'ARTIFACTS' })}
    ${box({ left: 645, top: 515, width: 630, height: 115, label: 'DURABLE OBJECT' })}
    ${box({ left: 1_360, top: 515, width: 400, height: 115, label: 'CONTAINERS' })}
    ${box({ left: 760, top: 760, width: 400, height: 95, label: 'WORKERS AI' })}
    ${line('M960 350V440H360V515')}${line('M960 350V515')}${line('M1275 573H1360')}${line('M960 630V760')}
    ${dot(960, 350 + packet * 165)}${dot(960, 630 + packet * 130)}`;
}

function endArt(timeMs: number): string {
  const enter = smooth(timeMs / 900);
  return `${agentGrid(timeMs, 0.13)}<g transform="translate(0 ${(1 - enter) * 65})" opacity="${enter}">
    <text x="960" y="410" text-anchor="middle" fill="${WHITE}" font-size="158" font-weight="700" font-family="Arial,sans-serif">Commute</text>
    <text x="960" y="535" text-anchor="middle" fill="${WHITE}" font-size="57" font-family="Arial,sans-serif">Changes that commute land in any order.</text>
    <text x="960" y="675" text-anchor="middle" fill="${GREEN}" font-size="39" font-family="Menlo,monospace">github.com/lucrise-llc/commute</text></g>`;
}

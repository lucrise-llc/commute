// The caption strip, speed badge, and terminal colors for the composed video.
import type { Page } from 'playwright';

export const VIDEO_WIDTH = 1_920;
export const VIDEO_HEIGHT = 1_080;
export const STRIP_HEIGHT = 120;
export const BADGE_WIDTH = 200;
const CAPTION_SIDE_PADDING = 240;
export const BACKGROUND = '#121417';
export const STRIP_BACKGROUND = '#0c0d0f';
export const TEXT_COLOR = '#f1f2f4';
export const MUTED_COLOR = '#9299a4';
export const ACCENT_COLOR = '#f6821f';
export const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

// The caption style, shared by the strip under the console and the terminal replay. A caption takes two lines at most.
export const CAPTION_CSS = `
.caption { max-width: 1440px; max-height: 100px; overflow: hidden; text-align: center; text-wrap: balance;
  color: ${TEXT_COLOR}; font: 500 36px/1.35 ${FONT_FAMILY}; letter-spacing: -0.005em; }
.caption .nowrap { white-space: nowrap; }
`;
// Words with a hyphen, such as a change ID, stay on one line.
const HYPHENATED_WORD = /[\w.]+(?:-[\w.]+)+/g;

// One caption in the strip under the console. The strip leaves room on the right for the speed badge.
export function captionHtml(text: string): string {
  return htmlDocument({
    css: `* { box-sizing: border-box; margin: 0; }
      body { width: ${VIDEO_WIDTH}px; height: ${STRIP_HEIGHT}px; background: ${STRIP_BACKGROUND};
        display: flex; align-items: center; justify-content: center; padding: 0 ${CAPTION_SIDE_PADDING}px;
        -webkit-font-smoothing: antialiased; }
      ${CAPTION_CSS}`,
    body: `<div class="caption" data-fit>${captionMarkup(text)}</div>`
  });
}

// The badge that shows while a wait plays faster, on a transparent background, sized to the right end of the strip.
export function badgeHtml(label: string): string {
  return htmlDocument({
    css: `* { box-sizing: border-box; margin: 0; }
      html, body { background: transparent; }
      body { width: ${BADGE_WIDTH}px; height: ${STRIP_HEIGHT}px; display: flex; align-items: center; justify-content: center; }
      .badge { display: flex; align-items: center; gap: 10px; padding: 10px 22px; border-radius: 999px;
        background: ${ACCENT_COLOR}; color: #15171a; font: 700 32px/1 ${FONT_FAMILY}; font-variant-numeric: tabular-nums; }`,
    body: `<div class="badge"><svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">
        <path d="M2 2l12 9-12 9zM16 2l12 9-12 9z" fill="currentColor"/></svg>${escapeHtml(label)}</div>`
  });
}

type PageParams = {
  css: string;
  body: string;
};

export function htmlDocument({ css, body }: PageParams): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

export function captionMarkup(text: string): string {
  return escapeHtml(text).replaceAll(HYPHENATED_WORD, '<span class="nowrap">$&</span>');
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

type Size = {
  width: number;
  height: number;
};

type RenderGraphicParams = {
  page: Page;
  html: string;
  path: string;
  size: Size;
  isTransparent?: boolean;
};

// Screenshots the HTML as a PNG. Text marked data-fit must fit its box, so that no caption loses a line.
export async function renderGraphic({
  page,
  html,
  path,
  size,
  isTransparent = false
}: RenderGraphicParams): Promise<void> {
  await page.setViewportSize(size);
  await page.setContent(html);
  const isFitting = await page.evaluate(() =>
    [...document.querySelectorAll('[data-fit]')].every((element) => element.scrollHeight <= element.clientHeight)
  );
  if (!isFitting) {
    throw new Error(`GRAPHIC_TEXT_OVERFLOWS: the text of ${path} does not fit its box.`);
  }
  await page.screenshot({ path, omitBackground: isTransparent });
}

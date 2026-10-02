// A person's hands on a recorded page: a visible cursor, and clicks, typing, hovers, and scrolls at a human pace.
import type { BrowserContext, Locator, Page } from 'playwright';

const STEP_MS = 16;
const GLIDE_MS_MIN = 180;
const GLIDE_MS_MAX = 900;
const GLIDE_MS_PER_PX = 0.7;
const PRESS_PAUSE_MS = 140;
const AFTER_CLICK_MS = 250;
const SELECT_PAUSE_MS = 200;
// Key delays vary from 90 to 150 ms in a fixed pattern, so that typing does not look mechanical.
const KEY_DELAY_MS = 90;
const KEY_DELAY_SPREAD_MS = 60;
const KEY_DELAY_STRIDE_MS = 37;
const TYPED_LENGTH_MAX = 100;
const HOVER_MS_MAX = 20_000;
const FOLLOW_MS = 200;
const FOLLOW_SLACK_PX = 4;
const AIM_ATTEMPTS_MAX = 3;
const SCROLL_SETTLE_MS_MAX = 1_500;
const HALF = 0.5;
const EASE_POWER = 3;
const EASE_SCALE = 4;
const EASE_TAIL = 2;
const CURSOR_STORAGE_KEY = 'commute-demo-cursor';
const RIPPLE_MS = 450;

// The tip of the arrow sits at (3, 2) in the 24 by 24 drawing, so the cursor shifts by that much.
const CURSOR_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 2v17.5l4.6-4.3 3 6.8 3-1.3-2.9-6.7H17z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const CURSOR_CSS = `
.commute-demo-cursor { position: fixed; left: -3px; top: -2px; z-index: 2147483647; pointer-events: none;
  opacity: 0; will-change: transform; }
.commute-demo-cursor.is-placed { opacity: 1; }
.commute-demo-cursor svg { display: block; transform-origin: 3px 2px; transition: transform 90ms ease-out;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
.commute-demo-cursor.is-pressed svg { transform: scale(0.85); }
.commute-demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 40px; height: 40px;
  margin: -20px 0 0 -20px; border-radius: 50%; border: 3px solid rgba(246, 130, 31, 0.95);
  background: rgba(246, 130, 31, 0.18); animation: commute-demo-ripple ${RIPPLE_MS}ms ease-out forwards; }
@keyframes commute-demo-ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
`;

// A point in CSS pixels of the viewport.
type Point = {
  left: number;
  top: number;
};

type CursorOptions = {
  svg: string;
  css: string;
  storageKey: string;
  rippleMs: number;
};

// Runs in the page before its scripts, on every document. The cursor is not part of the app: it ignores the pointer
// and sits above everything. The last position stays in session storage, so the cursor survives a page load.
function mountCursor({ svg, css, storageKey, rippleMs }: CursorOptions): void {
  const mount = (): void => {
    const style = document.createElement('style');
    style.textContent = css;
    const cursor = document.createElement('div');
    cursor.className = 'commute-demo-cursor';
    cursor.innerHTML = svg;
    document.documentElement.append(style, cursor);
    const place = ({ left, top }: Point): void => {
      cursor.style.transform = `translate(${left}px, ${top}px)`;
      cursor.classList.add('is-placed');
    };
    const saved = sessionStorage.getItem(storageKey);
    if (saved !== null) {
      const [left = 0, top = 0] = saved.split(',').map(Number);
      place({ left, top });
    }
    window.addEventListener(
      'mousemove',
      (event) => {
        place({ left: event.clientX, top: event.clientY });
        sessionStorage.setItem(storageKey, `${event.clientX},${event.clientY}`);
      },
      { capture: true, passive: true }
    );
    window.addEventListener(
      'mousedown',
      (event) => {
        cursor.classList.add('is-pressed');
        const ripple = document.createElement('div');
        ripple.className = 'commute-demo-ripple';
        ripple.style.left = `${event.clientX}px`;
        ripple.style.top = `${event.clientY}px`;
        document.documentElement.append(ripple);
        setTimeout(() => ripple.remove(), rippleMs);
      },
      { capture: true }
    );
    window.addEventListener('mouseup', () => cursor.classList.remove('is-pressed'), { capture: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}

export async function installCursor(context: BrowserContext): Promise<void> {
  await context.addInitScript(mountCursor, {
    svg: CURSOR_SVG,
    css: CURSOR_CSS,
    storageKey: CURSOR_STORAGE_KEY,
    rippleMs: RIPPLE_MS
  });
}

type TypeParams = {
  target: Locator;
  text: string;
};

type HoverParams = {
  target: Locator;
  ms: number;
};

export type Hands = {
  click: (target: Locator) => Promise<void>;
  type: (params: TypeParams) => Promise<void>;
  hover: (params: HoverParams) => Promise<void>;
};

// The cursor starts at the center of the viewport. Install the cursor on the context before the page opens.
export async function createHands(page: Page): Promise<Hands> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('HANDS_NEED_VIEWPORT: the page has no fixed viewport.');
  }
  let position: Point = { left: viewport.width * HALF, top: viewport.height * HALF };
  await page.mouse.move(position.left, position.top);

  const glideTo = async (target: Point): Promise<void> => {
    const from = position;
    const distance = Math.hypot(target.left - from.left, target.top - from.top);
    const durationMs = Math.min(GLIDE_MS_MAX, GLIDE_MS_MIN + distance * GLIDE_MS_PER_PX);
    const steps = Math.max(1, Math.round(durationMs / STEP_MS));
    for (let step = 1; step <= steps; step += 1) {
      const progress = easeInOut(step / steps);
      await page.mouse.move(
        from.left + (target.left - from.left) * progress,
        from.top + (target.top - from.top) * progress
      );
      await pause(STEP_MS);
    }
    position = target;
  };

  // Glides to the center of the target. The target can move while live events re-render the page, so the glide
  // aims again until the cursor rests on it.
  const aim = async (target: Locator): Promise<void> => {
    await bringIntoView(target);
    for (let attempt = 0; attempt < AIM_ATTEMPTS_MAX; attempt += 1) {
      const center = await centerOf(target);
      if (distanceTo(center) <= FOLLOW_SLACK_PX) {
        return;
      }
      await glideTo(center);
    }
  };

  const distanceTo = (point: Point): number => Math.hypot(point.left - position.left, point.top - position.top);

  const click = async (target: Locator): Promise<void> => {
    await aim(target);
    await pause(PRESS_PAUSE_MS);
    // Playwright clicks the center of the target. A click on a link can remove the target, so the cursor position is
    // taken before the click.
    position = await centerOf(target);
    await target.click();
    await pause(AFTER_CLICK_MS);
  };

  // Each step fills the whole prefix. A key typed while live events re-render the page can get lost; a fill cannot.
  const type = async ({ target, text }: TypeParams): Promise<void> => {
    if (text.length > TYPED_LENGTH_MAX) {
      throw new Error(`TYPED_TEXT_TOO_LONG: ${text.length} characters, more than ${TYPED_LENGTH_MAX}.`);
    }
    await click(target);
    await page.keyboard.press('ControlOrMeta+A');
    await pause(SELECT_PAUSE_MS);
    for (let length = 1; length <= text.length; length += 1) {
      await target.fill(text.slice(0, length));
      await pause(KEY_DELAY_MS + ((length * KEY_DELAY_STRIDE_MS) % KEY_DELAY_SPREAD_MS));
    }
  };

  const isInViewport = ({ left, top }: Point): boolean =>
    left >= 0 && top >= 0 && left <= viewport.width && top <= viewport.height;

  // Rests the cursor on the target for the given time, and follows the target while it moves inside the viewport. A
  // target that live events push out of the viewport is let go, so the page does not jump.
  const hover = async ({ target, ms }: HoverParams): Promise<void> => {
    if (ms > HOVER_MS_MAX) {
      throw new Error(`HOVER_TOO_LONG: ${ms} ms, more than ${HOVER_MS_MAX}.`);
    }
    await aim(target);
    const endAt = Date.now() + ms;
    for (let look = 0; look < Math.ceil(ms / FOLLOW_MS) && Date.now() < endAt; look += 1) {
      await pause(Math.min(FOLLOW_MS, endAt - Date.now()));
      if (!(await target.isVisible())) {
        continue;
      }
      const center = await centerOf(target);
      if (isInViewport(center) && distanceTo(center) > FOLLOW_SLACK_PX) {
        await glideTo(center);
      }
    }
  };

  return { click, type, hover };
}

// Scrolls smoothly until the target is in the viewport. A scroll that cannot move far enough ends after a bound.
async function bringIntoView(target: Locator): Promise<void> {
  await target.waitFor({ state: 'visible' });
  await target.evaluate(
    (element, settleMsMax) =>
      new Promise<void>((resolve) => {
        const rect = element.getBoundingClientRect();
        if (rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, settleMsMax);
        const settle = (): void => {
          clearTimeout(timer);
          resolve();
        };
        window.addEventListener('scrollend', settle, { capture: true, once: true });
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }),
    SCROLL_SETTLE_MS_MAX
  );
}

async function centerOf(target: Locator): Promise<Point> {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error('TARGET_NOT_VISIBLE: the target has no box on the page.');
  }
  return { left: box.x + box.width * HALF, top: box.y + box.height * HALF };
}

// Cubic ease-in-out: progress from 0 to 1, slow at both ends.
function easeInOut(progress: number): number {
  if (progress < HALF) {
    return EASE_SCALE * progress ** EASE_POWER;
  }
  return 1 - (EASE_TAIL - EASE_TAIL * progress) ** EASE_POWER / EASE_TAIL;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

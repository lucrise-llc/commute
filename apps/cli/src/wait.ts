import type { ChangeEvent } from '@commute/api-client';

import { parseArgs } from 'node:util';
import { createClient, getChange, zChangeEvent } from '@commute/api-client';

import type { ChangeContext } from './change-context.ts';

import { git } from './git.ts';
import { describeApiError } from './server.ts';
import { describeOverlap } from './overlaps.ts';
import { readChangeContext } from './change-context.ts';

const DEFAULT_TIMEOUT_SECONDS = 600;
const TIMEOUT_SECONDS_MAX = 86_400;
const MILLISECONDS_PER_SECOND = 1_000;
const EXIT_CODE_NO_EVENT = 2;
const WEBSOCKET_NORMAL_CLOSURE = 1_000;

export const WAIT_USAGE = 'commute wait [--timeout <seconds>] [--json]';

export async function runWait(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_SECONDS) },
      json: { type: 'boolean', default: false }
    }
  });
  const timeoutSeconds = Number(values.timeout);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > TIMEOUT_SECONDS_MAX) {
    throw new Error(`--timeout is a whole number of seconds from 1 to ${TIMEOUT_SECONDS_MAX}.`);
  }
  const cwd = process.cwd();
  const context = await readChangeContext(cwd);

  const { error } = await getChange({
    client: createClient({ baseUrl: context.url }),
    path: { projectId: context.projectId, changeId: context.changeId }
  });
  if (error !== undefined) {
    throw new Error(`commute wait failed: ${describeApiError(error)}`);
  }

  const event = await nextEvent({ context, timeoutMs: timeoutSeconds * MILLISECONDS_PER_SECOND });
  if (event === null) {
    console.error(`No event for ${context.changeId} within ${timeoutSeconds} s.`);
    return EXIT_CODE_NO_EVENT;
  }
  await git({ args: ['config', 'commute.cursor', String(event.seq)], cwd });
  console.log(values.json ? JSON.stringify(event) : `overlap  ${describeOverlap(event.overlap)}`);
  return 0;
}

type NextEventParams = {
  context: ChangeContext;
  timeoutMs: number;
};

// Opens the event stream, asks for events after the cursor, and settles on the first one. A timeout settles with
// null; a closed or failed stream settles with an error.
function nextEvent({ context, timeoutMs }: NextEventParams): Promise<ChangeEvent | null> {
  const url = new URL(`/api/projects/${context.projectId}/changes/${context.changeId}/events`, context.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      resolve(null);
      socket.close(WEBSOCKET_NORMAL_CLOSURE);
    }, timeoutMs);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ after: context.cursor }));
    });
    socket.addEventListener('message', (message) => {
      const event = zChangeEvent.safeParse(JSON.parse(String(message.data)));
      if (!event.success) {
        clearTimeout(timer);
        reject(new Error(`The server sent an event that does not match ChangeEvent: ${event.error.message}`));
        socket.close(WEBSOCKET_NORMAL_CLOSURE);
        return;
      }
      if (event.data.seq <= context.cursor) {
        return;
      }
      clearTimeout(timer);
      resolve(event.data);
      socket.close(WEBSOCKET_NORMAL_CLOSURE);
    });
    socket.addEventListener('close', (closed) => {
      clearTimeout(timer);
      reject(new Error(`The event stream closed (${closed.code}${closed.reason === '' ? '' : `: ${closed.reason}`}).`));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`Could not reach the event stream at ${url.origin}.`));
    });
  });
}

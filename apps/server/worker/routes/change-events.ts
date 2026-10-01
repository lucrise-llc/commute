import type { Context } from 'hono';

import type { AppEnv } from '../app-env';

import { changeIdSchema, projectIdSchema } from '../schemas';

const NOT_FOUND = 404;

// The WebSocket that `commute wait` listens on. It is outside the OpenAPI document; the ChangeEvent and WaitRequest
// components describe its messages.
export async function changeEventsHandler(c: Context<AppEnv>): Promise<Response> {
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  const changeId = changeIdSchema.safeParse(c.req.param('changeId'));
  if (!projectId.success || !changeId.success) {
    return c.json({ error: 'CHANGE_NOT_FOUND' }, NOT_FOUND);
  }
  return c.env.COORDINATOR.getByName(projectId.data).fetch(c.req.raw);
}

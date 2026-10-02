import type { Context } from 'hono';

import type { AppEnv } from '../app-env';

import { projectIdSchema } from '../schemas';

const NOT_FOUND = 404;

// The WebSocket that the console listens on: the events of every change in the project. It is outside the OpenAPI
// document; the ChangeEvent and WaitRequest components describe its messages.
export async function projectEventsHandler(c: Context<AppEnv>): Promise<Response> {
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  if (!projectId.success) {
    return c.json({ error: 'PROJECT_NOT_FOUND' }, NOT_FOUND);
  }
  return c.env.COORDINATOR.getByName(projectId.data).fetch(c.req.raw);
}

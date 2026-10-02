import type { Context } from 'hono';

import type { AppEnv } from '../app-env';

import { changeIdSchema, projectIdSchema } from '../schemas';

const NOT_FOUND = 404;

// The WebSockets of the coordinator's events: one change's, which `commute wait` listens on, and the whole project's,
// which the console listens on. They are outside the OpenAPI document; the ChangeEvent and WaitRequest components
// describe their messages.
export async function eventsHandler(c: Context<AppEnv>): Promise<Response> {
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  const changeId = c.req.param('changeId');
  if (!projectId.success) {
    return c.json({ error: 'PROJECT_NOT_FOUND' }, NOT_FOUND);
  }
  if (changeId !== undefined && !changeIdSchema.safeParse(changeId).success) {
    return c.json({ error: 'CHANGE_NOT_FOUND' }, NOT_FOUND);
  }
  return c.env.COORDINATOR.getByName(projectId.data).fetch(c.req.raw);
}

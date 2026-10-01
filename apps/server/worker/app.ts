import { OpenAPIHono } from '@hono/zod-openapi';

import type { AppEnv } from './app-env';

import { logError } from './log';
import { handleGit } from './git-remote';
import { ERROR_STATUS, errorCodeOf } from './errors';
import { healthHandler, healthRoute } from './routes/health';
import { changeEventsHandler } from './routes/change-events';
import { changeEventSchema, waitRequestSchema } from './schemas';
import { getChangeHandler, getChangeRoute } from './routes/get-change';
import { startChangeHandler, startChangeRoute } from './routes/start-change';
import { createProjectHandler, createProjectRoute } from './routes/create-project';

const BAD_REQUEST = 400;
const INTERNAL_ERROR = 500;

export const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c): Response | undefined => {
    if (result.success) {
      return undefined;
    }
    const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return c.json({ error: 'INVALID_REQUEST', issues }, BAD_REQUEST);
  }
});

app.openapi(healthRoute, healthHandler);
app.openapi(createProjectRoute, createProjectHandler);
app.openapi(startChangeRoute, startChangeHandler);
app.openapi(getChangeRoute, getChangeHandler);
app.get('/api/projects/:projectId/changes/:changeId/events', changeEventsHandler);
app.all('/git/*', (c) => handleGit({ request: c.req.raw, env: c.env }));

app.openAPIRegistry.register('ChangeEvent', changeEventSchema);
app.openAPIRegistry.register('WaitRequest', waitRequestSchema);

app.onError((error, c) => {
  const code = errorCodeOf(error);
  if (code !== null) {
    return c.json({ error: code }, ERROR_STATUS[code]);
  }
  logError({ event: 'request_failed', method: c.req.method, path: c.req.path, error });
  return c.json({ error: 'INTERNAL_ERROR' }, INTERNAL_ERROR);
});

app.doc31('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Commute API',
    version: '0.1.0'
  }
});

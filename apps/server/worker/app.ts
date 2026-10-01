import { OpenAPIHono } from '@hono/zod-openapi';

import type { AppEnv } from './app-env';

import { healthHandler, healthRoute } from './routes/health';

export const app = new OpenAPIHono<AppEnv>();

app.openapi(healthRoute, healthHandler);

app.doc31('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Commute API',
    version: '0.1.0'
  }
});

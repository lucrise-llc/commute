import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

const healthSchema = z
  .object({
    status: z.literal('ok')
  })
  .openapi('Health');

export const healthRoute = createRoute({
  operationId: 'getHealth',
  method: 'get',
  path: '/api/health',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: healthSchema
        }
      },
      description: 'The Worker serves requests.'
    }
  }
});

export const healthHandler: RouteHandler<typeof healthRoute, AppEnv> = (c) => c.json({ status: 'ok' }, 200);

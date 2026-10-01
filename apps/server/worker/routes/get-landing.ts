import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { errorResponse, jsonResponse } from './responses';
import { landingSchema, projectIdSchema } from '../schemas';

export const getLandingRoute = createRoute({
  operationId: 'getLanding',
  method: 'get',
  path: '/api/projects/{projectId}/landing',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: landingSchema,
      description:
        'The changes ready to land as the next batch, the changes that wait and why, and the batch that is landing.'
    }),
    404: errorResponse('PROJECT_NOT_FOUND: no project has this ID.')
  }
});

export const getLandingHandler: RouteHandler<typeof getLandingRoute, AppEnv> = async (c) => {
  const { projectId } = c.req.valid('param');
  const landing = await c.env.COORDINATOR.getByName(projectId).getLanding();
  return c.json(landing, 200);
};

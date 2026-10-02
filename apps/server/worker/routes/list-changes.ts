import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { errorResponse, jsonResponse } from './responses';
import { changeListItemSchema, projectIdSchema } from '../schemas';

export const listChangesRoute = createRoute({
  operationId: 'listChanges',
  method: 'get',
  path: '/api/projects/{projectId}/changes',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: z.array(changeListItemSchema),
      description: 'Every change of the project, newest first: in flight and landed.'
    }),
    404: errorResponse('PROJECT_NOT_FOUND: the project does not exist.')
  }
});

export const listChangesHandler: RouteHandler<typeof listChangesRoute, AppEnv> = async (c) => {
  const { projectId } = c.req.valid('param');
  return c.json(await c.env.COORDINATOR.getByName(projectId).listChanges(), 200);
};

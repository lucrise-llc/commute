import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { errorResponse, jsonResponse } from './responses';
import { changeIdSchema, overlapPageSchema, projectIdSchema } from '../schemas';

export const getOverlapRoute = createRoute({
  operationId: 'getOverlap',
  method: 'get',
  path: '/api/projects/{projectId}/overlaps/{changeId}/{otherChangeId}',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      changeId: changeIdSchema.openapi({ param: { name: 'changeId', in: 'path' } }),
      otherChangeId: changeIdSchema.openapi({ param: { name: 'otherChangeId', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: overlapPageSchema,
      description: 'Two changes side by side: their intents and footprints, their merge result, and its resolution.'
    }),
    404: errorResponse('CHANGE_NOT_FOUND: the project has no change with one of these IDs.')
  }
});

export const getOverlapHandler: RouteHandler<typeof getOverlapRoute, AppEnv> = async (c) => {
  const { projectId, changeId, otherChangeId } = c.req.valid('param');
  return c.json(await c.env.COORDINATOR.getByName(projectId).getOverlap({ changeId, otherChangeId }), 200);
};

import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { errorResponse, jsonResponse } from './responses';
import { changeIdSchema, changeSchema, projectIdSchema } from '../schemas';

export const getChangeRoute = createRoute({
  operationId: 'getChange',
  method: 'get',
  path: '/api/projects/{projectId}/changes/{changeId}',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      changeId: changeIdSchema.openapi({ param: { name: 'changeId', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: changeSchema,
      description: 'The change as the coordinator knows it: its head, its footprint, and its overlaps.'
    }),
    404: errorResponse('CHANGE_NOT_FOUND: the project has no open change with this ID.')
  }
});

export const getChangeHandler: RouteHandler<typeof getChangeRoute, AppEnv> = async (c) => {
  const { projectId, changeId } = c.req.valid('param');
  const change = await c.env.COORDINATOR.getByName(projectId).getChange(changeId);
  return c.json(change, 200);
};

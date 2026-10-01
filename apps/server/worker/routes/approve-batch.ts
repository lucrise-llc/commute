import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { errorResponse, jsonResponse } from './responses';
import { approveBatchBodySchema, batchApprovedSchema, projectIdSchema } from '../schemas';

export const approveBatchRoute = createRoute({
  operationId: 'approveBatch',
  method: 'post',
  path: '/api/projects/{projectId}/batches',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } })
    }),
    body: {
      content: {
        'application/json': {
          schema: approveBatchBodySchema
        }
      },
      required: true
    }
  },
  responses: {
    202: jsonResponse({
      schema: batchApprovedSchema,
      description: 'The batch lands in the background. Each change gets a landed event, then the others restack.'
    }),
    400: errorResponse('INVALID_REQUEST: the body does not match the schema.'),
    404: errorResponse('PROJECT_NOT_FOUND: no project has this ID.'),
    409: errorResponse('BATCH_NOT_READY: a change is not ready. LANDING_IN_PROGRESS: another batch is landing.')
  }
});

export const approveBatchHandler: RouteHandler<typeof approveBatchRoute, AppEnv> = async (c) => {
  const { projectId } = c.req.valid('param');
  const { changeIds, approver } = c.req.valid('json');
  const approved = await c.env.COORDINATOR.getByName(projectId).approveBatch({ changeIds, approver });
  return c.json(approved, 202);
};

import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { commuteRemote } from '../repos';
import { errorResponse, jsonResponse } from './responses';
import { changeStartedSchema, projectIdSchema, startChangeBodySchema } from '../schemas';

export const startChangeRoute = createRoute({
  operationId: 'startChange',
  method: 'post',
  path: '/api/projects/{projectId}/changes',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } })
    }),
    body: {
      content: {
        'application/json': {
          schema: startChangeBodySchema
        }
      },
      required: true
    }
  },
  responses: {
    201: jsonResponse({
      schema: changeStartedSchema,
      description:
        'The change has its own repository, forked from trunk. The response lists the changes in flight whose ' +
        'footprints meet the declared paths.'
    }),
    400: errorResponse('INVALID_REQUEST: the body does not match the schema.'),
    404: errorResponse('PROJECT_NOT_FOUND: no project has this ID.'),
    409: errorResponse('TRUNK_EMPTY: trunk has no commit to fork from.'),
    502: errorResponse('FORK_FAILED: Artifacts could not fork trunk.')
  }
});

export const startChangeHandler: RouteHandler<typeof startChangeRoute, AppEnv> = async (c) => {
  const { projectId } = c.req.valid('param');
  const { intent, paths, owner } = c.req.valid('json');
  const started = await c.env.COORDINATOR.getByName(projectId).startChange({
    projectId,
    intent,
    owner: owner ?? null,
    paths
  });
  return c.json(
    {
      changeId: started.changeId,
      remote: commuteRemote({ origin: new URL(c.req.url).origin, projectId, repoId: started.changeId }),
      token: started.token,
      tokenExpiresAt: started.tokenExpiresAt,
      baseCommit: started.baseCommit,
      overlaps: started.overlaps
    },
    201
  );
};

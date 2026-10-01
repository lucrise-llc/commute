import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { commuteRemote } from '../repos';
import { errorResponse, jsonResponse } from './responses';
import { createProjectBodySchema, projectCreatedSchema } from '../schemas';

export const createProjectRoute = createRoute({
  operationId: 'createProject',
  method: 'post',
  path: '/api/projects',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createProjectBodySchema
        }
      },
      required: true
    }
  },
  responses: {
    201: jsonResponse({
      schema: projectCreatedSchema,
      description: 'The project exists with an empty trunk. The token lets the owner push the first commit to trunk.'
    }),
    400: errorResponse('INVALID_REQUEST: the body does not match the schema.'),
    409: errorResponse('PROJECT_EXISTS: a project with this ID exists.')
  }
});

export const createProjectHandler: RouteHandler<typeof createProjectRoute, AppEnv> = async (c) => {
  const { projectId } = c.req.valid('json');
  const writeToken = await c.env.COORDINATOR.getByName(projectId).createProject(projectId);
  const remote = commuteRemote({ origin: new URL(c.req.url).origin, projectId, repoId: 'trunk' });
  return c.json({ projectId, remote, token: writeToken.token, tokenExpiresAt: writeToken.tokenExpiresAt }, 201);
};

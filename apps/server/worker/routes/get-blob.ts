import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { readText } from '../repo-browser';
import { errorResponse, jsonResponse } from './responses';
import { blobSchema, projectIdSchema, refSchema, repoPathSchema } from '../schemas';

export const getBlobRoute = createRoute({
  operationId: 'getBlob',
  method: 'get',
  path: '/api/projects/{projectId}/refs/{ref}/blob',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      ref: refSchema.openapi({ param: { name: 'ref', in: 'path' } })
    }),
    query: z.object({
      path: repoPathSchema
    })
  },
  responses: {
    200: jsonResponse({ schema: blobSchema, description: 'The file at the path, at the head of the ref.' }),
    404: errorResponse('REF_NOT_FOUND or PATH_NOT_FOUND: the ref has no head, or the head has no file there.')
  }
});

export const getBlobHandler: RouteHandler<typeof getBlobRoute, AppEnv> = async (c) => {
  const { projectId, ref } = c.req.valid('param');
  const { path } = c.req.valid('query');
  const { repoName, head } = await c.env.COORDINATOR.getByName(projectId).getRef(ref);
  using repo = await c.env.ARTIFACTS.get(repoName);
  const file = await readText({ repo, commit: head, path });
  if (file === null) {
    throw new Error('PATH_NOT_FOUND');
  }
  return c.json({ size: file.size, text: file.text }, 200);
};

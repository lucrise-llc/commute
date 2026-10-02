import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { readFolder } from '../repo-browser';
import { errorResponse, jsonResponse } from './responses';
import { projectIdSchema, refSchema, repoPathSchema, treeSchema } from '../schemas';

export const getTreeRoute = createRoute({
  operationId: 'getTree',
  method: 'get',
  path: '/api/projects/{projectId}/refs/{ref}/tree',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      ref: refSchema.openapi({ param: { name: 'ref', in: 'path' } })
    }),
    query: z.object({
      path: repoPathSchema.optional()
    })
  },
  responses: {
    200: jsonResponse({ schema: treeSchema, description: 'The folder at the path, at the head of the ref.' }),
    404: errorResponse('REF_NOT_FOUND or PATH_NOT_FOUND: the ref has no head, or the head has no folder there.')
  }
});

export const getTreeHandler: RouteHandler<typeof getTreeRoute, AppEnv> = async (c) => {
  const { projectId, ref } = c.req.valid('param');
  const path = c.req.valid('query').path ?? '';
  const { repoName, head } = await c.env.COORDINATOR.getByName(projectId).getRef(ref);
  using repo = await c.env.ARTIFACTS.get(repoName);
  const entries = await readFolder({ repo, commit: head, path });
  if (entries === null) {
    throw new Error('PATH_NOT_FOUND');
  }
  const prefix = path === '' ? '' : `${path}/`;
  const sorted = entries.toSorted(
    (left, right) => Number(right.type === 'tree') - Number(left.type === 'tree') || left.name.localeCompare(right.name)
  );
  return c.json(
    {
      entries: sorted.map((entry) => ({ name: entry.name, path: `${prefix}${entry.name}`, type: entry.type }))
    },
    200
  );
};

import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { readCommits } from '../repo-browser';
import { errorResponse, jsonResponse } from './responses';
import { commitListSchema, projectIdSchema, refSchema } from '../schemas';

const MILLISECONDS_PER_SECOND = 1_000;

export const listCommitsRoute = createRoute({
  operationId: 'listCommits',
  method: 'get',
  path: '/api/projects/{projectId}/refs/{ref}/commits',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      ref: refSchema.openapi({ param: { name: 'ref', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: commitListSchema,
      description: 'The newest commits of trunk, or the commits of a change since its base, newest first.'
    }),
    404: errorResponse('REF_NOT_FOUND: the ref has no head.')
  }
});

export const listCommitsHandler: RouteHandler<typeof listCommitsRoute, AppEnv> = async (c) => {
  const { projectId, ref } = c.req.valid('param');
  const { repoName, head, base } = await c.env.COORDINATOR.getByName(projectId).getRef(ref);
  using repo = await c.env.ARTIFACTS.get(repoName);
  const commits = await readCommits({ repo, head, base });
  return c.json(
    {
      head,
      commits: commits.map((commit) => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author.name,
        authoredAt: new Date(commit.authoredAt * MILLISECONDS_PER_SECOND).toISOString()
      }))
    },
    200
  );
};

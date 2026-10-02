import type { RouteHandler } from '@hono/zod-openapi';

import { createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../app-env';

import { readText } from '../repo-browser';
import { diffCommits } from '../footprint';
import { errorResponse, jsonResponse } from './responses';
import { changeIdSchema, diffSchema, projectIdSchema } from '../schemas';

const DIFF_FILES_MAX = 50;

export const getDiffRoute = createRoute({
  operationId: 'getDiff',
  method: 'get',
  path: '/api/projects/{projectId}/changes/{changeId}/diff',
  request: {
    params: z.object({
      projectId: projectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
      changeId: changeIdSchema.openapi({ param: { name: 'changeId', in: 'path' } })
    })
  },
  responses: {
    200: jsonResponse({
      schema: diffSchema,
      description: 'The files of the change that differ from its base on trunk.'
    }),
    404: errorResponse('REF_NOT_FOUND: the change has no head.')
  }
});

export const getDiffHandler: RouteHandler<typeof getDiffRoute, AppEnv> = async (c) => {
  const { projectId, changeId } = c.req.valid('param');
  const { repoName, head, base } = await c.env.COORDINATOR.getByName(projectId).getRef(changeId);
  if (base === null) {
    throw new Error('REF_NOT_FOUND');
  }
  using repo = await c.env.ARTIFACTS.get(repoName);
  const changed = await diffCommits({ repo, fromCommit: base, toCommit: head, shouldListFolderFiles: true });
  const files = await Promise.all(
    changed.slice(0, DIFF_FILES_MAX).map(async (path) => {
      const [before, after] = await Promise.all([
        readText({ repo, commit: base, path }),
        readText({ repo, commit: head, path })
      ]);
      const isText = (before === null || before.text !== null) && (after === null || after.text !== null);
      return { path, before: before?.text ?? null, after: after?.text ?? null, isText };
    })
  );
  return c.json({ baseCommit: base, files, isTruncated: changed.length > DIFF_FILES_MAX }, 200);
};

import { z } from '@hono/zod-openapi';

import { isCanonicalPath } from './footprint';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;
const CHANGE_ID_PATTERN = /^c-[1-9][0-9]{0,8}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const INTENT_LENGTH_MAX = 500;
const DECLARED_PATHS_MAX = 100;
const REPO_PATH_LENGTH_MAX = 512;
const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]+$/u;

export const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN).openapi({ example: 'storefront' });

export const changeIdSchema = z.string().regex(CHANGE_ID_PATTERN).openapi({ example: 'c-157' });

const commitSchema = z.string().regex(COMMIT_PATTERN);

const repoPathSchema = z
  .string()
  .min(1)
  .max(REPO_PATH_LENGTH_MAX)
  .refine(
    isCanonicalPath,
    'A path is relative, separates segments with /, and has no empty, . or .. segment or control character.'
  )
  .openapi({ example: 'src/cart/pricing.ts' });

export const errorSchema = z
  .object({
    error: z.string(),
    issues: z
      .array(
        z.object({
          path: z.string(),
          message: z.string()
        })
      )
      .optional()
  })
  .openapi('Error');

export const createProjectBodySchema = z
  .object({
    projectId: projectIdSchema
  })
  .openapi('CreateProjectBody');

export const projectCreatedSchema = z
  .object({
    projectId: projectIdSchema,
    remote: z.string(),
    token: z.string(),
    tokenExpiresAt: z.string()
  })
  .openapi('ProjectCreated');

export const startChangeBodySchema = z
  .object({
    intent: z
      .string()
      .min(1)
      .max(INTENT_LENGTH_MAX)
      .regex(NO_CONTROL_CHARACTERS, 'An intent has no line breaks or control characters.'),
    paths: z
      .array(repoPathSchema)
      .min(1)
      .max(DECLARED_PATHS_MAX)
      .refine((paths) => new Set(paths).size === paths.length, 'Paths are unique.')
  })
  .openapi('StartChangeBody');

const overlapPathSchema = z.object({
  path: z.string(),
  otherPath: z.string()
});

export const overlapSchema = z
  .object({
    changeId: changeIdSchema,
    intent: z.string(),
    paths: z.array(overlapPathSchema)
  })
  .openapi('Overlap');

export const changeStartedSchema = z
  .object({
    changeId: changeIdSchema,
    remote: z.string(),
    token: z.string(),
    tokenExpiresAt: z.string(),
    baseCommit: commitSchema,
    overlaps: z.array(overlapSchema)
  })
  .openapi('ChangeStarted');

export const changeSchema = z
  .object({
    changeId: changeIdSchema,
    intent: z.string(),
    baseCommit: commitSchema,
    headCommit: commitSchema,
    declaredPaths: z.array(z.string()),
    footprint: z.array(z.string()),
    overlaps: z.array(overlapSchema),
    createdAt: z.string()
  })
  .openapi('Change');

const overlapFoundEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('overlap_found'),
    changeId: changeIdSchema,
    at: z.string(),
    overlap: overlapSchema
  })
  .openapi('OverlapFoundEvent');

export const changeEventSchema = z.discriminatedUnion('type', [overlapFoundEventSchema]).openapi('ChangeEvent');

export const waitRequestSchema = z
  .object({
    after: z.number().int().min(0)
  })
  .openapi('WaitRequest');

export type Overlap = z.infer<typeof overlapSchema>;
export type Change = z.infer<typeof changeSchema>;
export type ChangeEvent = z.infer<typeof changeEventSchema>;

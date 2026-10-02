import { z } from '@hono/zod-openapi';

import { isCanonicalPath } from './footprint';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;
const CHANGE_ID_PATTERN = /^c-[1-9][0-9]{0,8}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const INTENT_LENGTH_MAX = 500;
const DECLARED_PATHS_MAX = 100;
const REPO_PATH_LENGTH_MAX = 512;
const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]+$/u;
const PERSON_NAME_LENGTH_MAX = 64;
const BATCH_CHANGES_MAX = 50;
const BATCH_ID_PATTERN = /^b-[1-9][0-9]{0,8}$/;

export const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN).openapi({ example: 'storefront' });

export const changeIdSchema = z.string().regex(CHANGE_ID_PATTERN).openapi({ example: 'c-157' });

const commitSchema = z.string().regex(COMMIT_PATTERN);

const batchIdSchema = z.string().regex(BATCH_ID_PATTERN).openapi({ example: 'b-12' });

const personNameSchema = z
  .string()
  .min(1)
  .max(PERSON_NAME_LENGTH_MAX)
  .regex(NO_CONTROL_CHARACTERS, 'A name has no line breaks or control characters.')
  .openapi({ example: 'alice' });

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
      .refine((paths) => new Set(paths).size === paths.length, 'Paths are unique.'),
    owner: personNameSchema.optional()
  })
  .openapi('StartChangeBody');

const overlapPathSchema = z.object({
  path: z.string(),
  otherPath: z.string()
});

const overlapSchema = z
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

// Why a change is not in the next batch. The change IDs name the changes it waits for, where that applies.
const waitReasonSchema = z
  .object({
    code: z.enum([
      'NO_COMMITS',
      'RESTACKING',
      'RESTACK_CONFLICT',
      'LANDS_AFTER',
      'CHECKING',
      'CHECKS',
      'CHECKS_FAILED',
      'LANDING'
    ]),
    changeIds: z.array(changeIdSchema)
  })
  .openapi('WaitReason');

// A check of a change at its head. reads and previousReads map each read path to its subtree hash at this head and
// at the head before. kept means the result was reused, not run.
const changeCheckSchema = z
  .object({
    name: z.string(),
    outcome: z.enum(['pending', 'pass', 'fail']),
    kept: z.boolean(),
    reads: z.record(z.string(), z.string()),
    previousReads: z.record(z.string(), z.string()).nullable(),
    exitCode: z.number().int().nullable(),
    output: z.string().nullable()
  })
  .openapi('ChangeCheck');

export const changeSchema = z
  .object({
    changeId: changeIdSchema,
    intent: z.string(),
    owner: z.string().nullable(),
    state: z.enum(['open', 'landing', 'landed']),
    baseCommit: commitSchema,
    headCommit: commitSchema,
    declaredPaths: z.array(z.string()),
    footprint: z.array(z.string()),
    overlaps: z.array(overlapSchema),
    landsAfter: z.array(changeIdSchema),
    landsBefore: z.array(changeIdSchema),
    waitsFor: z.array(waitReasonSchema),
    checks: z.array(changeCheckSchema),
    batchId: batchIdSchema.nullable(),
    landedCommit: commitSchema.nullable(),
    createdAt: z.string()
  })
  .openapi('Change');

const changeSummarySchema = z.object({
  changeId: changeIdSchema,
  intent: z.string(),
  owner: z.string().nullable()
});

export const landingSchema = z
  .object({
    trunkHead: commitSchema.nullable(),
    ready: z.array(changeSummarySchema),
    waiting: z.array(changeSummarySchema.extend({ waitsFor: z.array(waitReasonSchema) })),
    batch: z
      .object({
        batchId: batchIdSchema,
        changeIds: z.array(changeIdSchema),
        approver: z.string()
      })
      .nullable()
  })
  .openapi('Landing');

export const approveBatchBodySchema = z
  .object({
    changeIds: z
      .array(changeIdSchema)
      .min(1)
      .max(BATCH_CHANGES_MAX)
      .refine((changeIds) => new Set(changeIds).size === changeIds.length, 'Change IDs are unique.'),
    approver: personNameSchema
  })
  .openapi('ApproveBatchBody');

export const batchApprovedSchema = z
  .object({
    batchId: batchIdSchema
  })
  .openapi('BatchApproved');

const overlapFoundEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('overlap_found'),
    changeId: changeIdSchema,
    at: z.string(),
    overlap: overlapSchema
  })
  .openapi('OverlapFoundEvent');

const mergeCheckedEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('merge_checked'),
    changeId: changeIdSchema,
    at: z.string(),
    otherChange: z.object({
      changeId: changeIdSchema,
      intent: z.string()
    }),
    outcome: z.enum(['parallel', 'sequenced']),
    landsFirst: changeIdSchema.nullable(),
    conflicts: z.array(z.string())
  })
  .openapi('MergeCheckedEvent');

const landedEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('landed'),
    changeId: changeIdSchema,
    at: z.string(),
    batchId: batchIdSchema,
    landedCommit: commitSchema,
    approver: z.string()
  })
  .openapi('LandedEvent');

const restackedEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('restacked'),
    changeId: changeIdSchema,
    at: z.string(),
    trunkCommit: commitSchema,
    headCommit: commitSchema
  })
  .openapi('RestackedEvent');

const restackConflictEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('restack_conflict'),
    changeId: changeIdSchema,
    at: z.string(),
    trunkCommit: commitSchema,
    conflicts: z.array(z.string())
  })
  .openapi('RestackConflictEvent');

const checksDoneEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('checks_done'),
    changeId: changeIdSchema,
    at: z.string(),
    kept: z.number().int(),
    ran: z.number().int(),
    failed: z.array(z.string())
  })
  .openapi('ChecksDoneEvent');

const landingFailedEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('landing_failed'),
    changeId: changeIdSchema,
    at: z.string(),
    batchId: batchIdSchema
  })
  .openapi('LandingFailedEvent');

export const changeEventSchema = z
  .discriminatedUnion('type', [
    overlapFoundEventSchema,
    mergeCheckedEventSchema,
    landedEventSchema,
    restackedEventSchema,
    restackConflictEventSchema,
    checksDoneEventSchema,
    landingFailedEventSchema
  ])
  .openapi('ChangeEvent');

export const waitRequestSchema = z
  .object({
    after: z.number().int().min(0)
  })
  .openapi('WaitRequest');

export type Overlap = z.infer<typeof overlapSchema>;
export type Change = z.infer<typeof changeSchema>;
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export type WaitReason = z.infer<typeof waitReasonSchema>;
export type Landing = z.infer<typeof landingSchema>;

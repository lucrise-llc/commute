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

export const repoPathSchema = z
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
      'CHECKS_PENDING',
      'CHECKS_INVALID',
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

// A file whose conflict Commute resolved on this change by choosing lines from both sides. dropped lists the lines
// that the resolution left out, each with the resolver's reason.
const resolvedConflictSchema = z
  .object({
    path: z.string(),
    dropped: z.array(
      z.object({
        text: z.string(),
        reason: z.string()
      })
    )
  })
  .openapi('ResolvedConflict');

// A conflicting hunk of two changes in flight: the original lines, the lines of the change that lands first (theirs)
// and of the change that lands later (ours), and the lines the resolution kept. lines is null when the hunk needs the
// owner or was not reached.
const hunkDetailSchema = z.object({
  path: z.string(),
  base: z.array(z.string()),
  ours: z.array(z.string()),
  theirs: z.array(z.string()),
  lines: z.array(z.string()).nullable(),
  dropped: z.array(
    z.object({
      text: z.string(),
      reason: z.string()
    })
  )
});

const overlapResolutionSchema = z
  .object({
    outcome: z.enum(['ready', 'needs_owner']),
    reason: z.string().nullable(),
    hunks: z.array(hunkDetailSchema)
  })
  .openapi('OverlapResolution');

const overlapSideSchema = z.object({
  changeId: changeIdSchema,
  intent: z.string(),
  owner: z.string().nullable(),
  state: z.enum(['open', 'landing', 'landed']),
  footprint: z.array(z.string())
});

// Two changes whose footprints meet. left started first. merge is the result of the merge check of their current
// heads, and resolution is how Commute resolved a conflict for the right change.
export const overlapPageSchema = z
  .object({
    left: overlapSideSchema,
    right: overlapSideSchema,
    merge: z
      .object({
        outcome: z.enum(['clean', 'conflict']),
        conflicts: z.array(z.string())
      })
      .nullable(),
    resolution: overlapResolutionSchema.nullable()
  })
  .openapi('OverlapPage');

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
    checksError: z.string().nullable(),
    resolvedConflicts: z.array(resolvedConflictSchema).nullable(),
    batchId: batchIdSchema.nullable(),
    landedCommit: commitSchema.nullable(),
    createdAt: z.string()
  })
  .openapi('Change');

// A row of the Changes list. checks counts the checks of the current head by how each one stands.
export const changeListItemSchema = z
  .object({
    changeId: changeIdSchema,
    intent: z.string(),
    owner: z.string().nullable(),
    state: z.enum(['open', 'landing', 'landed']),
    footprint: z.array(z.string()),
    checks: z.object({
      kept: z.number().int(),
      ran: z.number().int(),
      pending: z.number().int(),
      failed: z.number().int()
    }),
    waitsFor: z.array(waitReasonSchema),
    landsAfter: z.array(changeIdSchema),
    resolvedConflicts: z.number().int(),
    createdAt: z.string()
  })
  .openapi('ChangeListItem');

// A ref is trunk or the repository of a change.
export const refSchema = z.union([z.literal('trunk'), changeIdSchema]).openapi({ example: 'trunk' });

export const treeSchema = z
  .object({
    head: commitSchema,
    path: z.string(),
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(['tree', 'blob', 'exec', 'symlink', 'gitlink'])
      })
    )
  })
  .openapi('Tree');

// text is null when the file is not UTF-8 or is larger than the bound.
export const blobSchema = z
  .object({
    head: commitSchema,
    path: z.string(),
    size: z.number().int(),
    text: z.string().nullable()
  })
  .openapi('Blob');

export const commitListSchema = z
  .object({
    head: commitSchema,
    commits: z.array(
      z.object({
        hash: commitSchema,
        message: z.string(),
        author: z.string(),
        authoredAt: z.string()
      })
    )
  })
  .openapi('CommitList');

// Each changed file of a change against its base, with the text of both sides. A side is null when the file does
// not exist there or is not text.
export const diffSchema = z
  .object({
    baseCommit: commitSchema,
    headCommit: commitSchema,
    files: z.array(
      z.object({
        path: z.string(),
        before: z.string().nullable(),
        after: z.string().nullable(),
        isText: z.boolean()
      })
    ),
    isTruncated: z.boolean()
  })
  .openapi('Diff');

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
    headCommit: commitSchema,
    resolvedPaths: z.array(z.string())
  })
  .openapi('RestackedEvent');

const restackConflictEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('restack_conflict'),
    changeId: changeIdSchema,
    at: z.string(),
    trunkCommit: commitSchema,
    conflicts: z.array(z.string()),
    reason: z.string()
  })
  .openapi('RestackConflictEvent');

// The resolution of a conflict with a change that lands first, found when the merge check sees the conflict. A ready
// resolution applies when the change restacks.
const resolutionEventSchema = z
  .object({
    seq: z.number().int(),
    type: z.literal('resolution'),
    changeId: changeIdSchema,
    at: z.string(),
    otherChange: z.object({
      changeId: changeIdSchema,
      intent: z.string()
    }),
    outcome: z.enum(['ready', 'needs_owner']),
    conflicts: z.array(z.string()),
    reason: z.string().nullable()
  })
  .openapi('ResolutionEvent');

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
    resolutionEventSchema,
    checksDoneEventSchema,
    landingFailedEventSchema
  ])
  .openapi('ChangeEvent');

export const waitRequestSchema = z
  .object({
    after: z.number().int().min(0)
  })
  .openapi('WaitRequest');

export type Change = z.infer<typeof changeSchema>;
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export type WaitReason = z.infer<typeof waitReasonSchema>;
export type Landing = z.infer<typeof landingSchema>;
export type ChangeListItem = z.infer<typeof changeListItemSchema>;
export type OverlapResolution = z.infer<typeof overlapResolutionSchema>;
export type OverlapPage = z.infer<typeof overlapPageSchema>;
export type Overlap = z.infer<typeof overlapSchema>;
export type ResolvedConflict = z.infer<typeof resolvedConflictSchema>;

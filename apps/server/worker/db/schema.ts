import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ResolvedConflict } from '../schemas';

export const CHANGE_STATES = ['starting', 'open', 'landing', 'landed'] as const;
export const FOOTPRINT_SOURCES = ['declared', 'pushed'] as const;
export const MERGE_OUTCOMES = ['clean', 'conflict'] as const;
export const BATCH_STATES = ['landing', 'landed', 'failed'] as const;
export const JOB_KINDS = ['merge', 'restack', 'land', 'evaluate', 'check'] as const;
export const CHECK_OUTCOMES = ['pass', 'fail'] as const;
export const CHANGE_CHECK_OUTCOMES = ['pending', 'pass', 'fail'] as const;

export const project = sqliteTable('project', {
  id: text('id').primaryKey(),
  changeCount: integer('change_count').notNull(),
  batchCount: integer('batch_count').notNull(),
  trunkHead: text('trunk_head'),
  createdAt: text('created_at').notNull()
});

export const change = sqliteTable('change', {
  id: text('id').primaryKey(),
  number: integer('number').notNull(),
  intent: text('intent').notNull(),
  owner: text('owner'),
  state: text('state', { enum: CHANGE_STATES }).notNull(),
  baseCommit: text('base_commit'),
  headCommit: text('head_commit'),
  restackConflicts: text('restack_conflicts', { mode: 'json' }).$type<string[]>(),
  batchId: text('batch_id'),
  landedCommit: text('landed_commit'),
  // The head whose checks are evaluated, and why they could not be, when commute.json is invalid.
  checksHead: text('checks_head'),
  checksError: text('checks_error'),
  // The files whose restack conflicts Commute resolved, for the person who approves the batch.
  resolvedConflicts: text('resolved_conflicts', { mode: 'json' }).$type<ResolvedConflict[]>(),
  createdAt: text('created_at').notNull()
});

export const footprint = sqliteTable(
  'footprint',
  {
    changeId: text('change_id').notNull(),
    source: text('source', { enum: FOOTPRINT_SOURCES }).notNull(),
    path: text('path').notNull()
  },
  (table) => [primaryKey({ columns: [table.changeId, table.source, table.path] })]
);

// The pairs each change has heard about, so an overlap is announced once.
export const reportedOverlap = sqliteTable(
  'reported_overlap',
  {
    changeId: text('change_id').notNull(),
    otherChangeId: text('other_change_id').notNull(),
    path: text('path').notNull(),
    otherPath: text('other_path').notNull()
  },
  (table) => [primaryKey({ columns: [table.changeId, table.otherChangeId, table.path, table.otherPath] })]
);

export const event = sqliteTable('event', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  changeId: text('change_id').notNull(),
  at: text('at').notNull(),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull()
});

// A merge result for two heads; the change that started first is on the left.
export const mergeCheck = sqliteTable(
  'merge_check',
  {
    leftId: text('left_id').notNull(),
    rightId: text('right_id').notNull(),
    leftHead: text('left_head').notNull(),
    rightHead: text('right_head').notNull(),
    outcome: text('outcome', { enum: MERGE_OUTCOMES }).notNull(),
    conflicts: text('conflicts', { mode: 'json' }).$type<string[]>().notNull()
  },
  (table) => [primaryKey({ columns: [table.leftId, table.rightId] })]
);

// One result per key, for every change of the project. The key covers the check as declared and the content it
// reads, so a change reuses a result that another change produced.
export const checkResult = sqliteTable('check_result', {
  key: text('key').primaryKey(),
  outcome: text('outcome', { enum: CHECK_OUTCOMES }).notNull(),
  exitCode: integer('exit_code').notNull(),
  output: text('output').notNull(),
  ranAt: text('ran_at').notNull()
});

// The checks of a change at its current head. previousReads holds the subtree hashes at the head before, so a
// reader sees what a restack changed. kept means the result existed before this head asked for it.
export const changeCheck = sqliteTable(
  'change_check',
  {
    changeId: text('change_id').notNull(),
    name: text('name').notNull(),
    head: text('head').notNull(),
    key: text('key').notNull(),
    command: text('command').notNull(),
    reads: text('reads', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    previousReads: text('previous_reads', { mode: 'json' }).$type<Record<string, string>>(),
    kept: integer('kept', { mode: 'boolean' }).notNull(),
    outcome: text('outcome', { enum: CHANGE_CHECK_OUTCOMES }).notNull()
  },
  (table) => [primaryKey({ columns: [table.changeId, table.name] })]
);

// The changes of a batch name it in change.batch_id.
// The resolution of one conflict hunk, keyed by the hash of its base, ours, and theirs lines. lines is null when the
// hunk needs its owner, and reason says why.
export const resolution = sqliteTable('resolution', {
  key: text('key').primaryKey(),
  lines: text('lines', { mode: 'json' }).$type<string[]>(),
  dropped: text('dropped', { mode: 'json' }).$type<ResolvedConflict['dropped']>().notNull(),
  reason: text('reason'),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull()
});

export const batch = sqliteTable('batch', {
  id: text('id').primaryKey(),
  approver: text('approver').notNull(),
  state: text('state', { enum: BATCH_STATES }).notNull(),
  trunkBefore: text('trunk_before').notNull(),
  createdAt: text('created_at').notNull()
});

// Work that runs from the alarm. The target is the change to restack, to evaluate, or to check, the batch to land, or
// the left change of a merge check. The partner is the right change of a merge check, or the name of a check. A job
// queued again while it runs gets a new version, so the run that ends does not delete or delay it.
export const job = sqliteTable('job', {
  key: text('key').primaryKey(),
  kind: text('kind', { enum: JOB_KINDS }).notNull(),
  target: text('target').notNull(),
  partner: text('partner'),
  version: integer('version').notNull(),
  attempts: integer('attempts').notNull(),
  runAfter: integer('run_after').notNull()
});

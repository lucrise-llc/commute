import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const CHANGE_STATES = ['starting', 'open', 'landing', 'landed'] as const;
export const FOOTPRINT_SOURCES = ['declared', 'pushed'] as const;
export const MERGE_OUTCOMES = ['clean', 'conflict'] as const;
export const BATCH_STATES = ['landing', 'landed', 'failed'] as const;
export const JOB_KINDS = ['merge', 'restack', 'land'] as const;

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

// The changes of a batch name it in change.batch_id.
export const batch = sqliteTable('batch', {
  id: text('id').primaryKey(),
  approver: text('approver').notNull(),
  state: text('state', { enum: BATCH_STATES }).notNull(),
  trunkBefore: text('trunk_before').notNull(),
  createdAt: text('created_at').notNull()
});

// Work that runs from the alarm. The target is the change to restack, the batch to land, or the left change of a
// merge check, whose right change is the partner. A job queued again while it runs gets a new version, so the run
// that ends does not delete or delay it.
export const job = sqliteTable('job', {
  key: text('key').primaryKey(),
  kind: text('kind', { enum: JOB_KINDS }).notNull(),
  target: text('target').notNull(),
  partner: text('partner'),
  version: integer('version').notNull(),
  attempts: integer('attempts').notNull(),
  runAfter: integer('run_after').notNull()
});

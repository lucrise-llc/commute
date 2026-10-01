import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, eq, getColumns, gt, inArray, lte, min, ne, or, sql } from 'drizzle-orm';

import type { JOB_KINDS } from './schema';
import type { MeetingPair } from '../footprint';

import { batch, change, event, footprint, job, mergeCheck, project, reportedOverlap } from './schema';

// A change is active from the moment its fork exists until it lands.
const ACTIVE_STATES = ['open', 'landing'] as const;

export type ProjectRecord = typeof project.$inferSelect;
export type ChangeRecord = typeof change.$inferSelect;
export type EventRecord = typeof event.$inferSelect;
export type MergeCheckRecord = typeof mergeCheck.$inferSelect;
export type BatchRecord = typeof batch.$inferSelect;
export type JobRecord = typeof job.$inferSelect;
type JobKind = (typeof JOB_KINDS)[number];

export type OtherChange = {
  intent: string;
  paths: string[];
};

type NewChangeParams = {
  changeId: string;
  number: number;
  intent: string;
  owner: string | null;
  paths: string[];
};

type ChangeCommitParams = {
  changeId: string;
  commit: string;
};

type RestackedParams = {
  changeId: string;
  baseCommit: string;
  headCommit: string;
};

type RestackConflictsParams = {
  changeId: string;
  conflicts: string[];
};

type LandingParams = {
  changeIds: string[];
  batchId: string;
};

type FootprintParams = {
  changeId: string;
  source: 'declared' | 'pushed';
};

type ReplaceFootprintParams = {
  changeId: string;
  paths: string[];
};

type ReportPairsParams = {
  changeId: string;
  otherChangeId: string;
  pairs: MeetingPair[];
};

type InsertEventParams = {
  changeId: string;
  type: string;
  payload: Record<string, unknown>;
};

type EventsAfterParams = {
  changeId: string;
  after: number;
  limit: number;
};

type PairParams = {
  leftId: string;
  rightId: string;
};

type NewBatchParams = {
  approver: string;
  trunkBefore: string;
};

type FinishBatchParams = {
  batchId: string;
  state: 'landed' | 'failed';
};

type QueueJobParams = {
  kind: JobKind;
  target: string;
  partner?: string;
  runAfter: number;
};

type FinishJobParams = {
  key: string;
  version: number;
};

type RetryJobParams = FinishJobParams & {
  attempts: number;
  runAfter: number;
};

// The storage of one coordinator. Every query of the coordinator lives here. Each method runs synchronously, so the
// writes of one coordinator step commit together.
export class ProjectStore {
  private readonly db: DrizzleSqliteDODatabase;

  constructor(db: DrizzleSqliteDODatabase) {
    this.db = db;
  }

  project(): ProjectRecord | null {
    return this.db.select().from(project).get() ?? null;
  }

  insertProject(projectId: string): void {
    this.db.insert(project).values({ id: projectId, changeCount: 0, batchCount: 0, createdAt: now() }).run();
  }

  setTrunkHead(commit: string): void {
    this.db.update(project).set({ trunkHead: commit }).run();
  }

  nextChangeNumber(): number {
    const row = this.db
      .update(project)
      .set({ changeCount: sql`${project.changeCount} + 1` })
      .returning({ changeCount: project.changeCount })
      .get();
    if (row === undefined) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    return row.changeCount;
  }

  insertStartingChange({ changeId, number, intent, owner, paths }: NewChangeParams): void {
    this.db.insert(change).values({ id: changeId, number, intent, owner, state: 'starting', createdAt: now() }).run();
    for (const path of paths) {
      this.db.insert(footprint).values({ changeId, source: 'declared', path }).run();
    }
  }

  removeChange(changeId: string): void {
    this.db.delete(change).where(eq(change.id, changeId)).run();
    this.db.delete(footprint).where(eq(footprint.changeId, changeId)).run();
  }

  openChange({ changeId, commit }: ChangeCommitParams): void {
    this.db
      .update(change)
      .set({ state: 'open', baseCommit: commit, headCommit: commit })
      .where(eq(change.id, changeId))
      .run();
  }

  findChange(changeId: string): ChangeRecord | null {
    return this.db.select().from(change).where(eq(change.id, changeId)).get() ?? null;
  }

  activeChanges(): ChangeRecord[] {
    return this.db.select().from(change).where(inArray(change.state, ACTIVE_STATES)).orderBy(asc(change.number)).all();
  }

  setHead({ changeId, commit }: ChangeCommitParams): void {
    this.db.update(change).set({ headCommit: commit }).where(eq(change.id, changeId)).run();
  }

  setRestacked({ changeId, baseCommit, headCommit }: RestackedParams): void {
    this.db.update(change).set({ baseCommit, headCommit, restackConflicts: null }).where(eq(change.id, changeId)).run();
  }

  setRestackConflicts({ changeId, conflicts }: RestackConflictsParams): void {
    this.db.update(change).set({ restackConflicts: conflicts }).where(eq(change.id, changeId)).run();
  }

  setLanding({ changeIds, batchId }: LandingParams): void {
    this.db.update(change).set({ state: 'landing', batchId }).where(inArray(change.id, changeIds)).run();
  }

  setLanded({ changeId, commit }: ChangeCommitParams): void {
    this.db.update(change).set({ state: 'landed', landedCommit: commit }).where(eq(change.id, changeId)).run();
  }

  reopen(changeIds: string[]): void {
    this.db.update(change).set({ state: 'open', batchId: null }).where(inArray(change.id, changeIds)).run();
  }

  footprint({ changeId, source }: FootprintParams): string[] {
    return this.db
      .select({ path: footprint.path })
      .from(footprint)
      .where(and(eq(footprint.changeId, changeId), eq(footprint.source, source)))
      .orderBy(asc(footprint.path))
      .all()
      .map((row) => row.path);
  }

  allPaths(changeId: string): string[] {
    return this.db
      .selectDistinct({ path: footprint.path })
      .from(footprint)
      .where(eq(footprint.changeId, changeId))
      .orderBy(asc(footprint.path))
      .all()
      .map((row) => row.path);
  }

  replacePushedFootprint({ changeId, paths }: ReplaceFootprintParams): void {
    this.db
      .delete(footprint)
      .where(and(eq(footprint.changeId, changeId), eq(footprint.source, 'pushed')))
      .run();
    for (const path of paths) {
      this.db.insert(footprint).values({ changeId, source: 'pushed', path }).run();
    }
  }

  // ceiling: compares a footprint with every path of every other change in flight. Debt — index paths by segment
  // when one project holds thousands of changes in flight, which the post-demo scale benchmark measures.
  otherActiveFootprints(changeId: string): Map<string, OtherChange> {
    const rows = this.db
      .selectDistinct({ changeId: footprint.changeId, intent: change.intent, path: footprint.path })
      .from(footprint)
      .innerJoin(change, eq(change.id, footprint.changeId))
      .where(and(ne(footprint.changeId, changeId), inArray(change.state, ACTIVE_STATES)))
      .orderBy(asc(change.number), asc(footprint.path))
      .all();
    const others = new Map<string, OtherChange>();
    for (const row of rows) {
      const other = others.get(row.changeId) ?? { intent: row.intent, paths: [] };
      other.paths.push(row.path);
      others.set(row.changeId, other);
    }
    return others;
  }

  // Returns whether any pair is new, so each side hears about a meeting once.
  reportPairs({ changeId, otherChangeId, pairs }: ReportPairsParams): boolean {
    let isNew = false;
    for (const pair of pairs) {
      const inserted = this.db
        .insert(reportedOverlap)
        .values({ changeId, otherChangeId, path: pair.path, otherPath: pair.otherPath })
        .onConflictDoNothing()
        .returning({ changeId: reportedOverlap.changeId })
        .all();
      isNew = isNew || inserted.length > 0;
    }
    return isNew;
  }

  insertEvent({ changeId, type, payload }: InsertEventParams): EventRecord {
    return this.db.insert(event).values({ changeId, at: now(), type, payload }).returning().get();
  }

  eventsAfter({ changeId, after, limit }: EventsAfterParams): EventRecord[] {
    return this.db
      .select()
      .from(event)
      .where(and(eq(event.changeId, changeId), gt(event.seq, after)))
      .orderBy(asc(event.seq))
      .limit(limit)
      .all();
  }

  findMergeCheck({ leftId, rightId }: PairParams): MergeCheckRecord | null {
    return (
      this.db
        .select()
        .from(mergeCheck)
        .where(and(eq(mergeCheck.leftId, leftId), eq(mergeCheck.rightId, rightId)))
        .get() ?? null
    );
  }

  saveMergeCheck(record: MergeCheckRecord): void {
    this.db
      .insert(mergeCheck)
      .values(record)
      .onConflictDoUpdate({
        target: [mergeCheck.leftId, mergeCheck.rightId],
        set: {
          leftHead: record.leftHead,
          rightHead: record.rightHead,
          outcome: record.outcome,
          conflicts: record.conflicts
        }
      })
      .run();
  }

  deleteMergeCheck({ leftId, rightId }: PairParams): void {
    this.db
      .delete(mergeCheck)
      .where(and(eq(mergeCheck.leftId, leftId), eq(mergeCheck.rightId, rightId)))
      .run();
  }

  checkedPartners(changeId: string): string[] {
    return this.db
      .select({ leftId: mergeCheck.leftId, rightId: mergeCheck.rightId })
      .from(mergeCheck)
      .where(or(eq(mergeCheck.leftId, changeId), eq(mergeCheck.rightId, changeId)))
      .all()
      .map((row) => (row.leftId === changeId ? row.rightId : row.leftId));
  }

  // Merge results for the current heads of two active changes. A result for older heads is not current.
  currentMergeChecks(changeId: string): MergeCheckRecord[] {
    const left = alias(change, 'left_change');
    const right = alias(change, 'right_change');
    return this.db
      .select(getColumns(mergeCheck))
      .from(mergeCheck)
      .innerJoin(
        left,
        and(
          eq(left.id, mergeCheck.leftId),
          eq(left.headCommit, mergeCheck.leftHead),
          inArray(left.state, ACTIVE_STATES)
        )
      )
      .innerJoin(
        right,
        and(
          eq(right.id, mergeCheck.rightId),
          eq(right.headCommit, mergeCheck.rightHead),
          inArray(right.state, ACTIVE_STATES)
        )
      )
      .where(or(eq(mergeCheck.leftId, changeId), eq(mergeCheck.rightId, changeId)))
      .all();
  }

  insertBatch({ approver, trunkBefore }: NewBatchParams): string {
    const row = this.db
      .update(project)
      .set({ batchCount: sql`${project.batchCount} + 1` })
      .returning({ batchCount: project.batchCount })
      .get();
    if (row === undefined) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    const batchId = `b-${row.batchCount}`;
    this.db.insert(batch).values({ id: batchId, approver, state: 'landing', trunkBefore, createdAt: now() }).run();
    return batchId;
  }

  findBatch(batchId: string): BatchRecord | null {
    return this.db.select().from(batch).where(eq(batch.id, batchId)).get() ?? null;
  }

  landingBatch(): BatchRecord | null {
    return this.db.select().from(batch).where(eq(batch.state, 'landing')).get() ?? null;
  }

  batchChangeIds(batchId: string): string[] {
    return this.db
      .select({ id: change.id })
      .from(change)
      .where(eq(change.batchId, batchId))
      .orderBy(asc(change.number))
      .all()
      .map((row) => row.id);
  }

  finishBatch({ batchId, state }: FinishBatchParams): void {
    this.db.update(batch).set({ state }).where(eq(batch.id, batchId)).run();
  }

  // Queuing a job again resets its attempts, makes it due, and raises its version.
  queueJob({ kind, target, partner, runAfter }: QueueJobParams): void {
    const key = partner === undefined ? `${kind}:${target}` : `${kind}:${target}:${partner}`;
    this.db
      .insert(job)
      .values({ key, kind, target, partner: partner ?? null, version: 1, attempts: 0, runAfter })
      .onConflictDoUpdate({
        target: job.key,
        set: { version: sql`${job.version} + 1`, attempts: 0, runAfter }
      })
      .run();
  }

  dueJob(time: number): JobRecord | null {
    return this.db.select().from(job).where(lte(job.runAfter, time)).orderBy(asc(job.runAfter)).limit(1).get() ?? null;
  }

  nextJobTime(): number | null {
    return (
      this.db
        .select({ runAfter: min(job.runAfter) })
        .from(job)
        .get()?.runAfter ?? null
    );
  }

  // Both apply only to the version that ran, so a job queued again in the meantime keeps its new state.
  finishJob({ key, version }: FinishJobParams): void {
    this.db
      .delete(job)
      .where(and(eq(job.key, key), eq(job.version, version)))
      .run();
  }

  retryJob({ key, version, attempts, runAfter }: RetryJobParams): void {
    this.db
      .update(job)
      .set({ attempts, runAfter })
      .where(and(eq(job.key, key), eq(job.version, version)))
      .run();
  }
}

function now(): string {
  return new Date().toISOString();
}

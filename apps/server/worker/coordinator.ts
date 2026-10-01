import { z } from '@hono/zod-openapi';
import { DurableObject } from 'cloudflare:workers';

import type { MeetingPair } from './footprint';
import type { ChangeRef, IssuedToken } from './repos';
import type { MergeResult, MergeSide } from './runner';
import type { Change, ChangeEvent, Overlap } from './schemas';

import { HEAD_MOVED } from './runner';
import { logError, log } from './log';
import { mergeOnRunnerPool } from './runner-pool';
import { diffCommits, meetingPairs } from './footprint';
import { artifactsErrorCode, errorCodeOf } from './errors';
import { changeEventSchema, waitRequestSchema } from './schemas';
import { changeRepoName, issueReadToken, issueWriteToken } from './repos';

const TRUNK_BRANCH = 'main';
const READY_POLLS_MAX = 50;
const READY_POLL_INTERVAL_MS = 100;
const EVENTS_REPLAY_MAX = 100;
const SOCKET_REPLAYED = 'replayed';
const WEBSOCKET_NORMAL_CLOSURE = 1_000;
const WEBSOCKET_POLICY_VIOLATION = 1_008;
// Retries wait 10, 20, 40, 80, then 160 seconds, which outlasts a container that stops answering for a few minutes.
const MERGE_ATTEMPTS_MAX = 6;
const MERGE_RETRY_BASE_DELAY_MS = 10_000;
const MERGE_RETRY_BACKOFF_FACTOR = 2;
const EVENTS_PATH_PATTERN = /^\/api\/projects\/[^/]+\/changes\/(c-[1-9][0-9]{0,8})\/events$/;

const eventPayloadSchema = z.record(z.string(), z.unknown());

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  change_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change (
  id TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  state TEXT NOT NULL,
  base_commit TEXT,
  head_commit TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS footprint (
  change_id TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (change_id, source, path)
);
CREATE TABLE IF NOT EXISTS reported_overlap (
  change_id TEXT NOT NULL,
  other_change_id TEXT NOT NULL,
  path TEXT NOT NULL,
  other_path TEXT NOT NULL,
  PRIMARY KEY (change_id, other_change_id, path, other_path)
);
CREATE TABLE IF NOT EXISTS event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS merge_check (
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  left_head TEXT NOT NULL,
  right_head TEXT NOT NULL,
  outcome TEXT NOT NULL,
  conflicts TEXT NOT NULL,
  PRIMARY KEY (left_id, right_id)
);
CREATE TABLE IF NOT EXISTS pending_merge (
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  run_after INTEGER NOT NULL,
  PRIMARY KEY (left_id, right_id)
);
`;

type ChangeRow = {
  id: string;
  intent: string;
  state: string;
  base_commit: string | null;
  head_commit: string | null;
  created_at: string;
};

type FootprintRow = {
  change_id: string;
  intent: string;
  path: string;
};

type EventRow = {
  seq: number;
  change_id: string;
  at: string;
  type: string;
  payload: string;
};

type MergeCheckRow = {
  left_id: string;
  right_id: string;
  left_head: string;
  right_head: string;
  outcome: string;
};

type PendingMergeRow = {
  left_id: string;
  right_id: string;
  attempts: number;
};

// A change with commits of its own: the only kind a merge check can compare.
type PushedChange = ChangeRow & {
  base_commit: string;
  head_commit: string;
};

type OtherChange = {
  intent: string;
  paths: string[];
};

type StartChangeParams = {
  projectId: string;
  intent: string;
  paths: string[];
};

type ChangeStarted = IssuedToken & {
  changeId: string;
  baseCommit: string;
  overlaps: Overlap[];
};

type ForkedChange = {
  baseCommit: string;
  writeToken: IssuedToken;
};

type PairsParams = {
  changeId: string;
  otherChangeId: string;
  pairs: MeetingPair[];
};

type RecordOverlapsParams = {
  changeId: string;
  isPush: boolean;
};

type FootprintOfParams = {
  changeId: string;
  source: 'declared' | 'pushed';
};

type EventPayload =
  | {
      type: 'overlap_found';
      overlap: Overlap;
    }
  | {
      type: 'merge_checked';
      otherChange: {
        changeId: string;
        intent: string;
      };
      outcome: 'parallel' | 'sequenced';
      landsFirst: string | null;
      conflicts: string[];
    };

type EmitParams = {
  changeId: string;
  payload: EventPayload;
};

type PushedPair = {
  left: PushedChange;
  right: PushedChange;
};

type QueueMergeChecksParams = {
  changeId: string;
  overlaps: Overlap[];
};

type PairIds = {
  leftId: string;
  rightId: string;
};

type ReadSideParams = ChangeRef & {
  head: string;
};

type AnnounceParams = PushedPair & {
  result: MergeResult;
};

// One coordinator per project. It owns the life of each change, the footprint index, and the event stream that
// agents wait on.
export class Coordinator extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly pushReads = new Map<string, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  async createProject(projectId: string): Promise<IssuedToken> {
    if (this.hasProject()) {
      throw new Error('PROJECT_EXISTS');
    }
    const created = await this.createTrunk(projectId);
    using trunk = await this.env.ARTIFACTS.get(projectId);
    const writeToken = await issueWriteToken(trunk);
    await trunk.revokeToken(created.token);
    this.sql.exec('INSERT INTO project (id, change_count, created_at) VALUES (?, 0, ?)', projectId, now());
    log({ event: 'project_created', projectId });
    return writeToken;
  }

  async startChange({ projectId, intent, paths }: StartChangeParams): Promise<ChangeStarted> {
    if (!this.hasProject()) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    const changeId = this.allocateChange({ intent, paths });
    let forked: ForkedChange;
    try {
      forked = await this.forkTrunk({ projectId, changeId });
    } catch (error) {
      this.removeChange(changeId);
      logError({ event: 'change_start_failed', projectId, changeId, error });
      throw new Error(errorCodeOf(error) === 'TRUNK_EMPTY' ? 'TRUNK_EMPTY' : 'FORK_FAILED', { cause: error });
    }
    this.sql.exec(
      "UPDATE change SET state = 'open', base_commit = ?, head_commit = ? WHERE id = ?",
      forked.baseCommit,
      forked.baseCommit,
      changeId
    );
    const overlaps = this.recordOverlaps({ changeId, isPush: false });
    log({ event: 'change_started', projectId, changeId, overlaps: overlaps.length });
    return { changeId, baseCommit: forked.baseCommit, overlaps, ...forked.writeToken };
  }

  getChange(changeId: string): Change {
    const change = this.findChange(changeId);
    if (change === null || change.state !== 'open' || change.base_commit === null || change.head_commit === null) {
      throw new Error('CHANGE_NOT_FOUND');
    }
    return {
      changeId,
      intent: change.intent,
      baseCommit: change.base_commit,
      headCommit: change.head_commit,
      declaredPaths: this.footprintOf({ changeId, source: 'declared' }),
      footprint: this.footprintOf({ changeId, source: 'pushed' }),
      overlaps: this.currentOverlaps(changeId),
      ...this.landingOrder(changeId),
      createdAt: change.created_at
    };
  }

  // Pushes to one change are read one at a time, so a slow read cannot overwrite the result of a newer push.
  async recordPush(change: ChangeRef): Promise<void> {
    const previous = this.pushReads.get(change.changeId) ?? Promise.resolve();
    const current = previous.then(() => this.readPush(change));
    this.pushReads.set(
      change.changeId,
      current.catch(() => undefined)
    );
    await current;
  }

  override fetch(request: Request): Response {
    const changeId = EVENTS_PATH_PATTERN.exec(new URL(request.url).pathname)?.[1];
    if (changeId === undefined || this.findChange(changeId)?.state !== 'open') {
      return Response.json({ error: 'CHANGE_NOT_FOUND' }, { status: 404 });
    }
    if (request.headers.get('upgrade') !== 'websocket') {
      return Response.json({ error: 'WEBSOCKET_REQUIRED' }, { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [changeId]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // A waiting client sends {"after": <seq>} once it is connected. The coordinator replays the events it missed, and
  // later events arrive as they happen. A socket gets live events only after its replay, so an older event cannot
  // arrive after a newer one.
  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const [changeId] = this.ctx.getTags(socket);
    const request = waitRequestSchema.safeParse(typeof message === 'string' ? parseJson(message) : null);
    if (changeId === undefined || !request.success) {
      socket.close(WEBSOCKET_POLICY_VIOLATION, 'Send {"after": <seq>} after connecting.');
      return;
    }
    const rows = this.sql.exec<EventRow>(
      'SELECT seq, change_id, at, type, payload FROM event WHERE change_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      changeId,
      request.data.after,
      EVENTS_REPLAY_MAX
    );
    for (const row of rows) {
      socket.send(JSON.stringify(eventFrom(row)));
    }
    socket.serializeAttachment(SOCKET_REPLAYED);
  }

  // A client closes the stream once it has its event. The close handshake needs the server's reply, or the client
  // waits in the closing state. The client's code can be a reserved one, such as 1005, which cannot be sent back.
  override webSocketClose(socket: WebSocket): void {
    socket.close(WEBSOCKET_NORMAL_CLOSURE, 'Closed by the client.');
  }

  // Runs one due merge check per alarm, so a run stays far below the alarm time limit, and sets the next alarm for the
  // next due check.
  override async alarm(): Promise<void> {
    const [job] = this.sql
      .exec<PendingMergeRow>(
        'SELECT left_id, right_id, attempts FROM pending_merge WHERE run_after <= ? ORDER BY run_after LIMIT 1',
        Date.now()
      )
      .toArray();
    if (job !== undefined) {
      await this.runMergeCheck(job);
    }
    const [next] = this.sql
      .exec<{ run_after: number }>('SELECT MIN(run_after) AS run_after FROM pending_merge')
      .toArray();
    if (next?.run_after !== undefined && next.run_after !== null) {
      await this.ctx.storage.setAlarm(Math.max(next.run_after, Date.now()));
    }
  }

  // A push queues a merge check with every change whose footprint meets it, and a new check of every pair that has
  // a result, so a push that removes a conflict also removes its sequence.
  private async queueMergeChecks({ changeId, overlaps }: QueueMergeChecksParams): Promise<void> {
    const checked = this.sql
      .exec<{ other_id: string }>(
        `SELECT CASE WHEN left_id = ? THEN right_id ELSE left_id END AS other_id
         FROM merge_check WHERE left_id = ? OR right_id = ?`,
        changeId,
        changeId,
        changeId
      )
      .toArray()
      .map((row) => row.other_id);
    const others = new Set([...overlaps.map((overlap) => overlap.changeId), ...checked]);
    let queued = 0;
    for (const otherChangeId of others) {
      if (pushedChange(this.findChange(otherChangeId)) === null) {
        continue;
      }
      const [leftId, rightId] = orderedPair({ changeId, otherChangeId });
      queued += this.sql.exec(
        `INSERT INTO pending_merge (left_id, right_id, attempts, run_after) VALUES (?, ?, 0, ?)
         ON CONFLICT (left_id, right_id) DO UPDATE SET attempts = 0, run_after = excluded.run_after`,
        leftId,
        rightId,
        Date.now()
      ).rowsWritten;
    }
    if (queued > 0) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  private async runMergeCheck({ left_id: leftId, right_id: rightId, attempts }: PendingMergeRow): Promise<void> {
    const left = pushedChange(this.findChange(leftId));
    const right = pushedChange(this.findChange(rightId));
    const previous = this.findMergeCheck({ leftId, rightId });
    if (left === null || right === null) {
      this.sql.exec('DELETE FROM pending_merge WHERE left_id = ? AND right_id = ?', leftId, rightId);
      this.sql.exec('DELETE FROM merge_check WHERE left_id = ? AND right_id = ?', leftId, rightId);
      return;
    }
    if (previous?.left_head === left.head_commit && previous.right_head === right.head_commit) {
      this.sql.exec('DELETE FROM pending_merge WHERE left_id = ? AND right_id = ?', leftId, rightId);
      return;
    }

    let result: MergeResult;
    try {
      result = await this.mergeHeads({ left, right });
    } catch (error) {
      logError({ event: 'merge_check_failed', leftId, rightId, attempts: attempts + 1, error });
      if (error instanceof Error && error.message === HEAD_MOVED) {
        await this.rereadHeads({ left, right });
      }
      if (attempts + 1 >= MERGE_ATTEMPTS_MAX) {
        this.sql.exec('DELETE FROM pending_merge WHERE left_id = ? AND right_id = ?', leftId, rightId);
        return;
      }
      this.sql.exec(
        'UPDATE pending_merge SET attempts = ?, run_after = ? WHERE left_id = ? AND right_id = ?',
        attempts + 1,
        Date.now() + MERGE_RETRY_BASE_DELAY_MS * MERGE_RETRY_BACKOFF_FACTOR ** attempts,
        leftId,
        rightId
      );
      return;
    }

    this.sql.exec(
      `INSERT OR REPLACE INTO merge_check (left_id, right_id, left_head, right_head, outcome, conflicts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      leftId,
      rightId,
      left.head_commit,
      right.head_commit,
      result.outcome,
      JSON.stringify(result.conflicts)
    );
    const isCurrent =
      this.findChange(leftId)?.head_commit === left.head_commit &&
      this.findChange(rightId)?.head_commit === right.head_commit;
    if (isCurrent) {
      this.sql.exec('DELETE FROM pending_merge WHERE left_id = ? AND right_id = ?', leftId, rightId);
    }
    if (previous?.outcome !== result.outcome) {
      this.announce({ left, right, result });
    }
    log({ event: 'merge_checked', leftId, rightId, outcome: result.outcome, conflicts: result.conflicts.length });
  }

  // The repository holds a head that the coordinator did not record, for example after a push read failed. Reading
  // the heads again records it and queues the pair for the new head.
  private async rereadHeads({ left, right }: PushedPair): Promise<void> {
    const projectId = this.projectId();
    await this.recordPush({ projectId, changeId: left.id });
    await this.recordPush({ projectId, changeId: right.id });
  }

  private async mergeHeads({ left, right }: PushedPair): Promise<MergeResult> {
    const projectId = this.projectId();
    const [leftSide, rightSide] = await Promise.all([
      this.readSide({ projectId, changeId: left.id, head: left.head_commit }),
      this.readSide({ projectId, changeId: right.id, head: right.head_commit })
    ]);
    return mergeOnRunnerPool({
      env: this.env,
      projectId,
      pairKey: `${left.id}/${right.id}`,
      left: leftSide,
      right: rightSide
    });
  }

  private async readSide({ projectId, changeId, head }: ReadSideParams): Promise<MergeSide> {
    using repo = await this.env.ARTIFACTS.get(changeRepoName({ projectId, changeId }));
    const [info, readToken] = await Promise.all([repo.info(), issueReadToken(repo)]);
    return { remote: info.remote, token: readToken.token, head };
  }

  // A conflict puts the change that started first ahead of the other one. Both sides learn the outcome and the other
  // change's intent.
  private announce({ left, right, result }: AnnounceParams): void {
    const outcome = result.outcome === 'conflict' ? 'sequenced' : 'parallel';
    const landsFirst = outcome === 'sequenced' ? left.id : null;
    for (const [change, other] of [
      [left, right],
      [right, left]
    ] as const) {
      this.emit({
        changeId: change.id,
        payload: {
          type: 'merge_checked',
          otherChange: { changeId: other.id, intent: other.intent },
          outcome,
          landsFirst,
          conflicts: result.conflicts
        }
      });
    }
  }

  // Only a result for the current heads of both changes sets an order; a result for older heads waits for its new check.
  private landingOrder(changeId: string): Pick<Change, 'landsAfter' | 'landsBefore'> {
    const rows = this.sql
      .exec<MergeCheckRow>(
        `SELECT merge_check.left_id, merge_check.right_id, merge_check.left_head, merge_check.right_head, merge_check.outcome
         FROM merge_check
         JOIN change AS left_change ON left_change.id = merge_check.left_id AND left_change.head_commit = merge_check.left_head
         JOIN change AS right_change ON right_change.id = merge_check.right_id AND right_change.head_commit = merge_check.right_head
         WHERE merge_check.outcome = 'conflict' AND (merge_check.left_id = ? OR merge_check.right_id = ?)`,
        changeId,
        changeId
      )
      .toArray();
    return {
      landsAfter: rows.filter((row) => row.right_id === changeId).map((row) => row.left_id),
      landsBefore: rows.filter((row) => row.left_id === changeId).map((row) => row.right_id)
    };
  }

  private findMergeCheck({ leftId, rightId }: PairIds): MergeCheckRow | null {
    const [row] = this.sql
      .exec<MergeCheckRow>(
        'SELECT left_id, right_id, left_head, right_head, outcome FROM merge_check WHERE left_id = ? AND right_id = ?',
        leftId,
        rightId
      )
      .toArray();
    return row ?? null;
  }

  private projectId(): string {
    return this.sql.exec<{ id: string }>('SELECT id FROM project').one().id;
  }

  private hasProject(): boolean {
    return this.sql.exec('SELECT id FROM project').toArray().length > 0;
  }

  private async createTrunk(projectId: string): Promise<ArtifactsCreateRepoResult> {
    try {
      return await this.env.ARTIFACTS.create(projectId, { setDefaultBranch: TRUNK_BRANCH });
    } catch (error) {
      if (artifactsErrorCode(error) === 'ALREADY_EXISTS') {
        throw new Error('PROJECT_EXISTS', { cause: error });
      }
      throw error;
    }
  }

  private allocateChange({ intent, paths }: Omit<StartChangeParams, 'projectId'>): string {
    const { change_count: count } = this.sql
      .exec<{ change_count: number }>('UPDATE project SET change_count = change_count + 1 RETURNING change_count')
      .one();
    const changeId = `c-${count}`;
    this.sql.exec(
      "INSERT INTO change (id, intent, state, created_at) VALUES (?, ?, 'starting', ?)",
      changeId,
      intent,
      now()
    );
    for (const path of paths) {
      this.sql.exec("INSERT INTO footprint (change_id, source, path) VALUES (?, 'declared', ?)", changeId, path);
    }
    return changeId;
  }

  private removeChange(changeId: string): void {
    this.sql.exec('DELETE FROM change WHERE id = ?', changeId);
    this.sql.exec('DELETE FROM footprint WHERE change_id = ?', changeId);
  }

  private async forkTrunk({ projectId, changeId }: ChangeRef): Promise<ForkedChange> {
    const repoName = changeRepoName({ projectId, changeId });
    using trunk = await this.env.ARTIFACTS.get(projectId);
    const forked = await trunk.fork(repoName, { defaultBranchOnly: true });
    try {
      using repo = await this.waitUntilReady(repoName);
      const [head] = await repo.log({ ref: TRUNK_BRANCH, limit: 1 });
      if (head === undefined) {
        throw new Error('TRUNK_EMPTY');
      }
      const writeToken = await issueWriteToken(repo);
      await repo.revokeToken(forked.token);
      return { baseCommit: head.hash, writeToken };
    } catch (error) {
      await this.env.ARTIFACTS.delete(repoName);
      throw error;
    }
  }

  // A fork returns before the new repository serves reads; get() reports FORK_IN_PROGRESS until it does.
  private async waitUntilReady(repoName: string): Promise<ArtifactsRepo> {
    for (let poll = 1; poll <= READY_POLLS_MAX; poll += 1) {
      try {
        return await this.env.ARTIFACTS.get(repoName);
      } catch (error) {
        if (artifactsErrorCode(error) !== 'FORK_IN_PROGRESS') {
          throw error;
        }
      }
      await scheduler.wait(READY_POLL_INTERVAL_MS);
    }
    throw new Error(`Fork ${repoName} was not ready after ${READY_POLLS_MAX} polls.`);
  }

  private async readPush({ projectId, changeId }: ChangeRef): Promise<void> {
    const change = this.findChange(changeId);
    if (change === null || change.state !== 'open' || change.base_commit === null) {
      return;
    }
    using repo = await this.env.ARTIFACTS.get(changeRepoName({ projectId, changeId }));
    const [head] = await repo.log({ ref: TRUNK_BRANCH, limit: 1 });
    if (head === undefined || head.hash === change.head_commit) {
      return;
    }
    const footprint = await diffCommits({ repo, fromCommit: change.base_commit, toCommit: head.hash });
    this.sql.exec("DELETE FROM footprint WHERE change_id = ? AND source = 'pushed'", changeId);
    for (const path of footprint) {
      this.sql.exec("INSERT INTO footprint (change_id, source, path) VALUES (?, 'pushed', ?)", changeId, path);
    }
    this.sql.exec('UPDATE change SET head_commit = ? WHERE id = ?', head.hash, changeId);
    const overlaps = this.recordOverlaps({ changeId, isPush: true });
    await this.queueMergeChecks({ changeId, overlaps });
    log({
      event: 'push_recorded',
      projectId,
      changeId,
      headCommit: head.hash,
      footprintPaths: footprint.length,
      overlaps: overlaps.length
    });
  }

  // Finds every change whose footprint meets this one, and sends one event to each side for pairs it has not been
  // told about. A change that is starting learns its overlaps from the start response instead of an event.
  private recordOverlaps({ changeId, isPush }: RecordOverlapsParams): Overlap[] {
    const change = this.findChange(changeId);
    if (change === null) {
      return [];
    }
    const paths = this.allPathsOf(changeId);
    const overlaps: Overlap[] = [];
    for (const [otherChangeId, other] of this.otherChanges(changeId)) {
      const pairs = meetingPairs({ paths, otherPaths: other.paths });
      if (pairs.length === 0) {
        continue;
      }
      overlaps.push({ changeId: otherChangeId, intent: other.intent, paths: pairs });
      const reversed = meetingPairs({ paths: other.paths, otherPaths: paths });
      if (this.reportPairs({ changeId: otherChangeId, otherChangeId: changeId, pairs: reversed })) {
        this.emit({
          changeId: otherChangeId,
          payload: { type: 'overlap_found', overlap: { changeId, intent: change.intent, paths: reversed } }
        });
      }
      const isNewForChange = this.reportPairs({ changeId, otherChangeId, pairs });
      if (isPush && isNewForChange) {
        this.emit({
          changeId,
          payload: { type: 'overlap_found', overlap: { changeId: otherChangeId, intent: other.intent, paths: pairs } }
        });
      }
    }
    return overlaps;
  }

  private currentOverlaps(changeId: string): Overlap[] {
    const paths = this.allPathsOf(changeId);
    const overlaps: Overlap[] = [];
    for (const [otherChangeId, other] of this.otherChanges(changeId)) {
      const pairs = meetingPairs({ paths, otherPaths: other.paths });
      if (pairs.length > 0) {
        overlaps.push({ changeId: otherChangeId, intent: other.intent, paths: pairs });
      }
    }
    return overlaps;
  }

  private reportPairs({ changeId, otherChangeId, pairs }: PairsParams): boolean {
    let rowsWritten = 0;
    for (const pair of pairs) {
      rowsWritten += this.sql.exec(
        'INSERT OR IGNORE INTO reported_overlap (change_id, other_change_id, path, other_path) VALUES (?, ?, ?, ?)',
        changeId,
        otherChangeId,
        pair.path,
        pair.otherPath
      ).rowsWritten;
    }
    return rowsWritten > 0;
  }

  private emit({ changeId, payload }: EmitParams): void {
    const { type, ...fields } = payload;
    const row = this.sql
      .exec<EventRow>(
        'INSERT INTO event (change_id, at, type, payload) VALUES (?, ?, ?, ?) RETURNING seq, change_id, at, type, payload',
        changeId,
        now(),
        type,
        JSON.stringify(fields)
      )
      .one();
    const message = JSON.stringify(eventFrom(row));
    for (const socket of this.ctx.getWebSockets(changeId)) {
      if (socket.deserializeAttachment() === SOCKET_REPLAYED) {
        socket.send(message);
      }
    }
  }

  private findChange(changeId: string): ChangeRow | null {
    const [row] = this.sql
      .exec<ChangeRow>(
        'SELECT id, intent, state, base_commit, head_commit, created_at FROM change WHERE id = ?',
        changeId
      )
      .toArray();
    return row ?? null;
  }

  private footprintOf({ changeId, source }: FootprintOfParams): string[] {
    return this.sql
      .exec<{ path: string }>(
        'SELECT path FROM footprint WHERE change_id = ? AND source = ? ORDER BY path',
        changeId,
        source
      )
      .toArray()
      .map((row) => row.path);
  }

  private allPathsOf(changeId: string): string[] {
    return this.sql
      .exec<{ path: string }>('SELECT DISTINCT path FROM footprint WHERE change_id = ? ORDER BY path', changeId)
      .toArray()
      .map((row) => row.path);
  }

  // ceiling: compares a footprint with every path of every other change in flight. Debt — index paths by segment
  // when one project holds thousands of changes in flight, which the post-demo scale benchmark measures.
  private otherChanges(changeId: string): Map<string, OtherChange> {
    const rows = this.sql.exec<FootprintRow>(
      `SELECT DISTINCT footprint.change_id, change.intent, footprint.path
       FROM footprint JOIN change ON change.id = footprint.change_id
       WHERE footprint.change_id != ? AND change.state = 'open'
       ORDER BY footprint.change_id, footprint.path`,
      changeId
    );
    const others = new Map<string, OtherChange>();
    for (const row of rows) {
      const other = others.get(row.change_id) ?? { intent: row.intent, paths: [] };
      other.paths.push(row.path);
      others.set(row.change_id, other);
    }
    return others;
  }
}

function eventFrom(row: EventRow): ChangeEvent {
  return changeEventSchema.parse({
    ...eventPayloadSchema.parse(parseJson(row.payload)),
    seq: row.seq,
    type: row.type,
    changeId: row.change_id,
    at: row.at
  });
}

function pushedChange(change: ChangeRow | null): PushedChange | null {
  if (
    change === null ||
    change.state !== 'open' ||
    change.base_commit === null ||
    change.head_commit === null ||
    change.head_commit === change.base_commit
  ) {
    return null;
  }
  return { ...change, base_commit: change.base_commit, head_commit: change.head_commit };
}

type OrderedPairParams = {
  changeId: string;
  otherChangeId: string;
};

// A pair is stored with the change that started first on the left.
function orderedPair({ changeId, otherChangeId }: OrderedPairParams): [string, string] {
  return changeNumber(changeId) < changeNumber(otherChangeId) ? [changeId, otherChangeId] : [otherChangeId, changeId];
}

function changeNumber(changeId: string): number {
  return Number(changeId.slice('c-'.length));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function now(): string {
  return new Date().toISOString();
}

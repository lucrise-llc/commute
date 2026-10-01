import { DurableObject } from 'cloudflare:workers';

import type { MeetingPair } from './footprint';
import type { ChangeRef, WriteToken } from './repos';
import type { Change, ChangeEvent, Overlap } from './schemas';

import { logError, log } from './log';
import { diffCommits, meetingPairs } from './footprint';
import { changeRepoName, issueWriteToken } from './repos';
import { artifactsErrorCode, errorCodeOf } from './errors';
import { overlapSchema, waitRequestSchema } from './schemas';

const TRUNK_BRANCH = 'main';
const READY_POLLS_MAX = 50;
const READY_POLL_INTERVAL_MS = 100;
const EVENTS_REPLAY_MAX = 100;
const SOCKET_REPLAYED = 'replayed';
const WEBSOCKET_NORMAL_CLOSURE = 1_000;
const WEBSOCKET_POLICY_VIOLATION = 1_008;
const EVENTS_PATH_PATTERN = /^\/api\/projects\/[^/]+\/changes\/(c-[1-9][0-9]{0,8})\/events$/;

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
  overlap TEXT NOT NULL
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
  overlap: string;
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

type ChangeStarted = WriteToken & {
  changeId: string;
  baseCommit: string;
  overlaps: Overlap[];
};

type ForkedChange = {
  baseCommit: string;
  writeToken: WriteToken;
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

type EmitParams = {
  changeId: string;
  overlap: Overlap;
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

  async createProject(projectId: string): Promise<WriteToken> {
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
      'SELECT seq, change_id, at, overlap FROM event WHERE change_id = ? AND seq > ? ORDER BY seq LIMIT ?',
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
        this.emit({ changeId: otherChangeId, overlap: { changeId, intent: change.intent, paths: reversed } });
      }
      const isNewForChange = this.reportPairs({ changeId, otherChangeId, pairs });
      if (isPush && isNewForChange) {
        this.emit({ changeId, overlap: { changeId: otherChangeId, intent: other.intent, paths: pairs } });
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

  private emit({ changeId, overlap }: EmitParams): void {
    const row = this.sql
      .exec<EventRow>(
        'INSERT INTO event (change_id, at, overlap) VALUES (?, ?, ?) RETURNING seq, change_id, at, overlap',
        changeId,
        now(),
        JSON.stringify(overlap)
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
  return {
    seq: row.seq,
    type: 'overlap_found',
    changeId: row.change_id,
    at: row.at,
    overlap: overlapSchema.parse(JSON.parse(row.overlap))
  };
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

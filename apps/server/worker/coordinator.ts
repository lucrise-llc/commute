import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';

import type { ConflictResolution } from './resolver';
import type { ChangeRef, IssuedToken } from './repos';
import type { CheckRun, LandingChange, LandResult, MergeResult, RepoHead, RestackResult } from './runner';
import type { Change, ChangeEvent, ChangeListItem, Landing, Overlap, OverlapPage, WaitReason } from './schemas';
import type { ChangeCheckRecord, ChangeRecord, EventRecord, JobRecord, ProjectRecord } from './db/project-store';

import { log, logError } from './log';
import { onRunnerPool } from './runner-pool';
import { resolveConflicts } from './resolver';
import migrations from '../drizzle/migrations';
import { ProjectStore } from './db/project-store';
import { HEAD_MOVED, LAND_CONFLICT } from './runner';
import { diffCommits, meetingPairs } from './footprint';
import { resultKey, subtreeHashes } from './check-keys';
import { artifactsErrorCode, errorCodeOf } from './errors';
import { changeEventSchema, waitRequestSchema } from './schemas';
import { CHECKS_INVALID, readProjectFile } from './project-file';
import { changeRepoName, issueAgentToken, issueJobToken } from './repos';

const TRUNK_BRANCH = 'main';
const READY_POLLS_MAX = 50;
const READY_POLL_INTERVAL_MS = 100;
const FORK_ATTEMPTS_MAX = 3;
const FORK_RETRY_DELAY_MS = 500;
const EVENTS_REPLAY_MAX = 100;
const SOCKET_REPLAYED = 'replayed';
const WEBSOCKET_NORMAL_CLOSURE = 1_000;
const WEBSOCKET_POLICY_VIOLATION = 1_008;
const EVENTS_PATH_PATTERN = /^\/api\/projects\/[^/]+\/changes\/(c-[1-9][0-9]{0,8})\/events$/;
const PROJECT_EVENTS_PATH_PATTERN = /^\/api\/projects\/[^/]+\/events$/;
// The tag of a socket that receives the events of every change in the project, such as the console's.
const PROJECT_SOCKET_TAG = 'project';
const TRUNK_REF = 'trunk';
const CHANGES_LIST_MAX = 500;
// A failed job retries after 10, 20, 40, 80, then 160 seconds, which outlasts a container that stops answering for a
// few minutes.
const JOB_ATTEMPTS_MAX = 6;
const JOB_RETRY_BASE_DELAY_MS = 10_000;
const JOB_RETRY_BACKOFF_FACTOR = 2;
// Jobs run in order of their due time. A landing is due at time zero, so it runs before queued merge checks and
// restacks, which wait for it anyway.
const LANDING_RUNS_FIRST = 0;

type StartChangeParams = {
  projectId: string;
  intent: string;
  owner: string | null;
  paths: string[];
};

type ChangeStarted = IssuedToken & {
  changeId: string;
  baseCommit: string;
  overlaps: Overlap[];
};

type ApproveBatchParams = {
  changeIds: string[];
  approver: string;
};

type ForkedChange = {
  baseCommit: string;
  agentToken: IssuedToken;
};

// A change with commits of its own: the only kind a merge check compares.
type RefHead = {
  repoName: string;
  head: string;
  base: string | null;
};

type PushedChange = ChangeRecord & {
  baseCommit: string;
  headCommit: string;
};

type PushedPair = {
  left: PushedChange;
  right: PushedChange;
};

// An event as the coordinator emits it. The event store adds the sequence number, the change, and the time.
type Unsequenced<Event> = Event extends unknown ? Omit<Event, 'seq' | 'changeId' | 'at'> : never;
type EventPayload = Unsequenced<ChangeEvent>;

type EmitParams = {
  changeId: string;
  payload: EventPayload;
};

// 'again' keeps the job due now, for state that moved while it ran.
type JobOutcome = 'done' | 'again';

type QueueMergeChecksParams = {
  changeId: string;
  overlaps: Overlap[];
};

type AnnounceMergeParams = PushedPair & {
  result: MergeResult;
};

type ApplyRestackParams = {
  projectId: string;
  change: ChangeRecord;
  trunkHead: string;
  result: RestackResult;
  resolution: ConflictResolution | null;
};

type HoldRestackParams = {
  projectId: string;
  changeId: string;
  trunkHead: string;
  conflicts: string[];
  reason: string;
};

type AnnounceResolutionParams = PushedPair & {
  conflicts: string[];
  resolution: ConflictResolution;
};

type ApplyLandingParams = {
  batchId: string;
  approver: string;
  result: LandResult;
};

type RepoSideParams = {
  repoName: string;
  head: string;
  scope: 'read' | 'write';
};

type ChangeBaseParams = {
  changeId: string;
  baseCommit: string;
};

type BatchApproved = {
  batchId: string;
};

type JobParams = {
  job: JobRecord;
  projectId: string;
};

type RecordOverlapsParams = {
  changeId: string;
  isPush: boolean;
};

type MergeJobParams = {
  projectId: string;
  jobKey: string;
  leftId: string;
  rightId: string;
};

type RestackJobParams = ChangeRef & {
  jobKey: string;
};

type CheckJobParams = ChangeRef & {
  jobKey: string;
  name: string;
};

type ChecksAtHeadParams = {
  changeId: string;
  repo: ArtifactsRepo;
  head: string;
};

type LandJobParams = {
  projectId: string;
  jobKey: string;
  batchId: string;
};

type LandingChangeParams = {
  projectId: string;
  change: PushedChange;
  batchId: string;
  approver: string;
};

// One coordinator per project. It owns the life of each change: its footprint and overlaps, the merge checks of its
// pairs, the checks of its head, its batch, its landing on trunk, and the restacks that follow. It also holds the event
// stream that agents wait on.
export class Coordinator extends DurableObject<Env> {
  private readonly store: ProjectStore;
  private readonly pushReads = new Map<string, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db: DrizzleSqliteDODatabase = drizzle(ctx.storage);
    this.store = new ProjectStore(db);
    // The migrator runs synchronously, and the constructor ends before the coordinator handles any request.
    migrate(db, migrations);
  }

  async createProject(projectId: string): Promise<IssuedToken> {
    if (this.store.project() !== null) {
      throw new Error('PROJECT_EXISTS');
    }
    const created = await this.createTrunk(projectId);
    using trunk = await this.env.ARTIFACTS.get(projectId);
    const agentToken = await issueAgentToken(trunk);
    await trunk.revokeToken(created.token);
    this.store.insertProject(projectId);
    log({ event: 'project_created', projectId });
    return agentToken;
  }

  async startChange({ projectId, intent, owner, paths }: StartChangeParams): Promise<ChangeStarted> {
    if (this.store.project() === null) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    const number = this.store.nextChangeNumber();
    const changeId = `c-${number}`;
    this.store.insertStartingChange({ changeId, number, intent, owner, paths });
    let forked: ForkedChange;
    try {
      forked = await this.forkTrunk({ projectId, changeId });
    } catch (error) {
      this.store.removeChange(changeId);
      logError({ event: 'change_start_failed', projectId, changeId, error });
      throw new Error(errorCodeOf(error) === 'TRUNK_EMPTY' ? 'TRUNK_EMPTY' : 'FORK_FAILED', { cause: error });
    }
    this.store.openChange({ changeId, commit: forked.baseCommit });
    await this.alignWithTrunk({ changeId, baseCommit: forked.baseCommit });
    const overlaps = this.recordOverlaps({ changeId, isPush: false });
    log({ event: 'change_started', projectId, changeId, owner, overlaps: overlaps.length });
    return { changeId, baseCommit: forked.baseCommit, overlaps, ...forked.agentToken };
  }

  // After the first change, trunk moves only through landings. A fork that began before a landing finished has the
  // older trunk as its base, so it restacks like every other open change.
  private async alignWithTrunk({ changeId, baseCommit }: ChangeBaseParams): Promise<void> {
    const trunkHead = this.store.project()?.trunkHead ?? null;
    if (trunkHead === null) {
      this.store.setTrunkHead(baseCommit);
      return;
    }
    if (trunkHead !== baseCommit) {
      this.store.queueJob({ kind: 'restack', target: changeId, runAfter: Date.now() });
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  getChange(changeId: string): Change {
    const change = this.store.findChange(changeId);
    if (change === null || change.state === 'starting' || change.baseCommit === null || change.headCommit === null) {
      throw new Error('CHANGE_NOT_FOUND');
    }
    return {
      changeId,
      intent: change.intent,
      owner: change.owner,
      state: change.state,
      baseCommit: change.baseCommit,
      headCommit: change.headCommit,
      declaredPaths: this.store.footprint({ changeId, source: 'declared' }),
      footprint: this.store.footprint({ changeId, source: 'pushed' }),
      overlaps: change.state === 'landed' ? [] : this.currentOverlaps(changeId),
      ...this.landingOrder(changeId),
      waitsFor: change.state === 'landed' ? [] : this.waitReasons(change),
      checks: this.store.changeChecks(changeId).map((check) => this.checkView(check)),
      checksError: change.checksError,
      resolvedConflicts: change.resolvedConflicts,
      batchId: change.batchId,
      landedCommit: change.landedCommit,
      createdAt: change.createdAt
    };
  }

  listChanges(): ChangeListItem[] {
    this.requireProject();
    const items: ChangeListItem[] = [];
    for (const change of this.store.listedChanges(CHANGES_LIST_MAX)) {
      if (change.state === 'starting') {
        continue;
      }
      const checks = this.store.changeChecks(change.id);
      const pushed = this.store.footprint({ changeId: change.id, source: 'pushed' });
      items.push({
        changeId: change.id,
        intent: change.intent,
        owner: change.owner,
        state: change.state,
        footprint: pushed.length > 0 ? pushed : this.store.footprint({ changeId: change.id, source: 'declared' }),
        checks: {
          kept: checks.filter((check) => check.kept).length,
          ran: checks.filter((check) => !check.kept && check.outcome !== 'pending').length,
          pending: checks.filter((check) => check.outcome === 'pending').length,
          failed: checks.filter((check) => check.outcome === 'fail').length
        },
        waitsFor: change.state === 'landed' ? [] : this.waitReasons(change),
        landsAfter: this.landingOrder(change.id).landsAfter,
        resolvedConflicts: change.resolvedConflicts?.length ?? 0,
        createdAt: change.createdAt
      });
    }
    return items;
  }

  getOverlap({ changeId, otherChangeId }: OrderedPairParams): OverlapPage {
    const [leftId, rightId] = orderedPair({ changeId, otherChangeId });
    const check = this.store.findMergeCheck({ leftId, rightId });
    return {
      left: this.overlapSide(leftId),
      right: this.overlapSide(rightId),
      merge: check === null ? null : { outcome: check.outcome, conflicts: check.conflicts },
      resolution: check?.resolution ?? null
    };
  }

  // The repository and head of a ref, for reads through the Artifacts binding. A change also names its base.
  getRef(ref: string): RefHead {
    const project = this.requireProject();
    if (ref === TRUNK_REF) {
      if (project.trunkHead === null) {
        throw new Error('REF_NOT_FOUND');
      }
      return { repoName: project.id, head: project.trunkHead, base: null };
    }
    const change = this.store.findChange(ref);
    if (change === null || change.baseCommit === null || change.headCommit === null) {
      throw new Error('REF_NOT_FOUND');
    }
    return {
      repoName: changeRepoName({ projectId: project.id, changeId: ref }),
      head: change.headCommit,
      base: change.baseCommit
    };
  }

  // The next batch is every ready change. Two ready changes that overlap have a clean merge result, because a
  // conflict makes the later change wait for the earlier one, so the batch commutes inside and with trunk.
  getLanding(): Landing {
    const project = this.requireProject();
    const ready: Landing['ready'] = [];
    const waiting: Landing['waiting'] = [];
    for (const change of this.store.activeChanges()) {
      const summary = { changeId: change.id, intent: change.intent, owner: change.owner };
      const waitsFor = this.waitReasons(change);
      if (waitsFor.length === 0) {
        ready.push(summary);
      } else {
        waiting.push({ ...summary, waitsFor });
      }
    }
    const batch = this.store.landingBatch();
    return {
      trunkHead: project.trunkHead,
      ready,
      waiting,
      batch:
        batch === null
          ? null
          : { batchId: batch.id, changeIds: this.store.batchChangeIds(batch.id), approver: batch.approver }
    };
  }

  async approveBatch({ changeIds, approver }: ApproveBatchParams): Promise<BatchApproved> {
    const landing = this.getLanding();
    if (landing.batch !== null) {
      throw new Error('LANDING_IN_PROGRESS');
    }
    const ready = new Set(landing.ready.map((change) => change.changeId));
    if (changeIds.some((changeId) => !ready.has(changeId))) {
      throw new Error('BATCH_NOT_READY');
    }
    // A ready change sits on trunk, so the trunk head is known once any change is ready.
    const trunkHead = landing.trunkHead;
    if (trunkHead === null) {
      throw new Error('A ready change exists, but the project has no trunk head.');
    }
    const batchId = this.store.insertBatch({ approver, trunkBefore: trunkHead });
    this.store.setLanding({ changeIds, batchId });
    this.store.queueJob({ kind: 'land', target: batchId, runAfter: LANDING_RUNS_FIRST });
    await this.ctx.storage.setAlarm(Date.now());
    log({ event: 'batch_approved', batchId, approver, changeIds });
    return { batchId };
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
    const path = new URL(request.url).pathname;
    const changeId = EVENTS_PATH_PATTERN.exec(path)?.[1];
    let tag: string;
    if (PROJECT_EVENTS_PATH_PATTERN.test(path)) {
      if (this.store.project() === null) {
        return Response.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
      }
      tag = PROJECT_SOCKET_TAG;
    } else {
      const change = changeId === undefined ? null : this.store.findChange(changeId);
      if (changeId === undefined || change === null || change.state === 'starting') {
        return Response.json({ error: 'CHANGE_NOT_FOUND' }, { status: 404 });
      }
      tag = changeId;
    }
    if (request.headers.get('upgrade') !== 'websocket') {
      return Response.json({ error: 'WEBSOCKET_REQUIRED' }, { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [tag]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // A waiting client sends {"after": <seq>} once it is connected. The coordinator replays the events it missed, and
  // later events arrive as they happen. A socket gets live events only after its replay, so an older event cannot
  // arrive after a newer one.
  // A project socket replays the newest events instead, because the console shows recent activity.
  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const [tag] = this.ctx.getTags(socket);
    const request = waitRequestSchema.safeParse(typeof message === 'string' ? parseJson(message) : null);
    if (tag === undefined || !request.success) {
      socket.close(WEBSOCKET_POLICY_VIOLATION, 'Send {"after": <seq>} after connecting.');
      return;
    }
    const replay =
      tag === PROJECT_SOCKET_TAG
        ? this.store.latestEventsAfter({ after: request.data.after, limit: EVENTS_REPLAY_MAX })
        : this.store.eventsAfter({ changeId: tag, after: request.data.after, limit: EVENTS_REPLAY_MAX });
    for (const record of replay) {
      socket.send(JSON.stringify(eventFrom(record)));
    }
    socket.serializeAttachment(SOCKET_REPLAYED);
  }

  // A client closes the stream once it has its event. The close handshake needs the server's reply, or the client
  // waits in the closing state. The client's code can be a reserved one, such as 1005, which cannot be sent back.
  override webSocketClose(socket: WebSocket): void {
    socket.close(WEBSOCKET_NORMAL_CLOSURE, 'Closed by the client.');
  }

  // Runs one due job per alarm, so a run stays far below the alarm time limit, and sets the alarm for the next one.
  override async alarm(): Promise<void> {
    const job = this.store.dueJob(Date.now());
    if (job !== null) {
      await this.runJob(job);
    }
    const next = this.store.nextJobTime();
    if (next !== null) {
      await this.ctx.storage.setAlarm(Math.max(next, Date.now()));
    }
  }

  // A job that fails retries with backoff, and a job whose state moved runs again at once. Both count against the
  // attempt limit.
  private async runJob(job: JobRecord): Promise<void> {
    const projectId = this.requireProject().id;
    let runAfter: number;
    try {
      const outcome = await this.jobOutcome({ job, projectId });
      if (outcome === 'done') {
        this.store.finishJob(job);
        return;
      }
      runAfter = Date.now();
    } catch (error) {
      logError({ event: 'job_failed', jobKey: job.key, attempts: job.attempts + 1, error });
      runAfter = Date.now() + JOB_RETRY_BASE_DELAY_MS * JOB_RETRY_BACKOFF_FACTOR ** job.attempts;
    }
    if (job.attempts + 1 >= JOB_ATTEMPTS_MAX) {
      this.store.finishJob(job);
      this.abandonJob(job);
      return;
    }
    this.store.retryJob({ key: job.key, version: job.version, attempts: job.attempts + 1, runAfter });
  }

  private jobOutcome({ job, projectId }: JobParams): Promise<JobOutcome> {
    if (job.kind === 'merge') {
      if (job.partner === null) {
        throw new Error(`Merge job ${job.key} has no partner.`);
      }
      return this.runMergeJob({ projectId, jobKey: job.key, leftId: job.target, rightId: job.partner });
    }
    if (job.kind === 'restack') {
      return this.runRestackJob({ projectId, jobKey: job.key, changeId: job.target });
    }
    if (job.kind === 'evaluate') {
      return this.runEvaluateJob({ projectId, changeId: job.target });
    }
    if (job.kind === 'check') {
      if (job.partner === null) {
        throw new Error(`Check job ${job.key} has no check name.`);
      }
      return this.runCheckJob({ projectId, jobKey: job.key, changeId: job.target, name: job.partner });
    }
    return this.runLandJob({ projectId, jobKey: job.key, batchId: job.target });
  }

  // A landing that runs out of attempts gives its changes back to the queue of ready work.
  private abandonJob(job: JobRecord): void {
    logError({ event: 'job_abandoned', jobKey: job.key, error: 'attempts exhausted' });
    if (job.kind === 'land') {
      this.failBatch(job.target);
    }
  }

  private overlapSide(changeId: string): OverlapPage['left'] {
    const change = this.store.findChange(changeId);
    if (change === null || change.state === 'starting') {
      throw new Error('CHANGE_NOT_FOUND');
    }
    const pushed = this.store.footprint({ changeId, source: 'pushed' });
    return {
      changeId,
      intent: change.intent,
      owner: change.owner,
      state: change.state,
      footprint: pushed.length > 0 ? pushed : this.store.footprint({ changeId, source: 'declared' })
    };
  }

  private requireProject(): ProjectRecord {
    const project = this.store.project();
    if (project === null) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    return project;
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

  // Artifacts answered INTERNAL_ERROR to 2 of about 50 forks during verification runs, so such a fork runs again.
  private async forkTrunk(change: ChangeRef): Promise<ForkedChange> {
    for (let attempt = 1; attempt < FORK_ATTEMPTS_MAX; attempt += 1) {
      try {
        return await this.forkTrunkOnce(change);
      } catch (error) {
        if (artifactsErrorCode(error) !== 'INTERNAL_ERROR') {
          throw error;
        }
        logError({ event: 'fork_retry', ...change, attempt, error });
        await scheduler.wait(FORK_RETRY_DELAY_MS * attempt);
      }
    }
    return this.forkTrunkOnce(change);
  }

  // A fork that fails at any step leaves no repository behind, so the next attempt can use the same name.
  private async forkTrunkOnce({ projectId, changeId }: ChangeRef): Promise<ForkedChange> {
    const repoName = changeRepoName({ projectId, changeId });
    using trunk = await this.env.ARTIFACTS.get(projectId);
    try {
      const forked = await trunk.fork(repoName, { defaultBranchOnly: true });
      using repo = await this.waitUntilReady(repoName);
      const [head] = await repo.log({ ref: TRUNK_BRANCH, limit: 1 });
      if (head === undefined) {
        throw new Error('TRUNK_EMPTY');
      }
      const agentToken = await issueAgentToken(repo);
      await repo.revokeToken(forked.token);
      return { baseCommit: head.hash, agentToken };
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
    const change = this.store.findChange(changeId);
    if (change === null || change.state !== 'open' || change.baseCommit === null) {
      return;
    }
    using repo = await this.env.ARTIFACTS.get(changeRepoName({ projectId, changeId }));
    const [head] = await repo.log({ ref: TRUNK_BRANCH, limit: 1 });
    if (head === undefined || head.hash === change.headCommit) {
      return;
    }
    const footprint = await diffCommits({ repo, fromCommit: change.baseCommit, toCommit: head.hash });
    this.store.replacePushedFootprint({ changeId, paths: footprint });
    this.store.setHead({ changeId, commit: head.hash });
    const overlaps = this.recordOverlaps({ changeId, isPush: true });
    await this.queueMergeChecks({ changeId, overlaps });
    await this.queueChecks(changeId);
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
    const change = this.store.findChange(changeId);
    if (change === null) {
      return [];
    }
    const paths = this.store.allPaths(changeId);
    const overlaps: Overlap[] = [];
    for (const [otherChangeId, other] of this.store.otherActiveFootprints(changeId)) {
      const pairs = meetingPairs({ paths, otherPaths: other.paths });
      if (pairs.length === 0) {
        continue;
      }
      overlaps.push({ changeId: otherChangeId, intent: other.intent, paths: pairs });
      const reversed = meetingPairs({ paths: other.paths, otherPaths: paths });
      if (this.store.reportPairs({ changeId: otherChangeId, otherChangeId: changeId, pairs: reversed })) {
        this.emit({
          changeId: otherChangeId,
          payload: { type: 'overlap_found', overlap: { changeId, intent: change.intent, paths: reversed } }
        });
      }
      const isNewForChange = this.store.reportPairs({ changeId, otherChangeId, pairs });
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
    const paths = this.store.allPaths(changeId);
    const overlaps: Overlap[] = [];
    for (const [otherChangeId, other] of this.store.otherActiveFootprints(changeId)) {
      const pairs = meetingPairs({ paths, otherPaths: other.paths });
      if (pairs.length > 0) {
        overlaps.push({ changeId: otherChangeId, intent: other.intent, paths: pairs });
      }
    }
    return overlaps;
  }

  // A push queues a merge check with every change whose footprint meets it, and a new check of every pair that has
  // a result, so a push that removes a conflict also removes its sequence.
  private async queueMergeChecks({ changeId, overlaps }: QueueMergeChecksParams): Promise<void> {
    const others = new Set([...overlaps.map((overlap) => overlap.changeId), ...this.store.checkedPartners(changeId)]);
    let queued = 0;
    for (const otherChangeId of others) {
      if (pushedChange(this.store.findChange(otherChangeId)) === null) {
        continue;
      }
      const [leftId, rightId] = orderedPair({ changeId, otherChangeId });
      this.store.queueJob({ kind: 'merge', target: leftId, partner: rightId, runAfter: Date.now() });
      queued += 1;
    }
    if (queued > 0) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  private async runMergeJob({ projectId, jobKey, leftId, rightId }: MergeJobParams): Promise<JobOutcome> {
    const left = pushedChange(this.store.findChange(leftId));
    const right = pushedChange(this.store.findChange(rightId));
    if (left === null || right === null) {
      this.store.deleteMergeCheck({ leftId, rightId });
      return 'done';
    }
    const previous = this.store.findMergeCheck({ leftId, rightId });
    if (previous?.leftHead === left.headCommit && previous.rightHead === right.headCommit) {
      return 'done';
    }

    let result: MergeResult;
    try {
      const [leftSide, rightSide] = await Promise.all([
        this.repoSide({
          repoName: changeRepoName({ projectId, changeId: left.id }),
          head: left.headCommit,
          scope: 'read'
        }),
        this.repoSide({
          repoName: changeRepoName({ projectId, changeId: right.id }),
          head: right.headCommit,
          scope: 'read'
        })
      ]);
      result = await onRunnerPool({
        env: this.env,
        projectId,
        jobKey,
        task: (runner) => runner.mergeCheck({ left: leftSide, right: rightSide })
      });
    } catch (error) {
      if (isError(error, HEAD_MOVED)) {
        await this.recordPush({ projectId, changeId: leftId });
        await this.recordPush({ projectId, changeId: rightId });
        return 'again';
      }
      throw error;
    }

    this.store.saveMergeCheck({
      leftId,
      rightId,
      leftHead: left.headCommit,
      rightHead: right.headCommit,
      outcome: result.outcome,
      conflicts: result.conflicts,
      resolution: null
    });
    if (previous?.outcome !== result.outcome) {
      this.announceMerge({ left, right, result });
    }
    if (result.outcome === 'conflict') {
      await this.resolveAhead({ left, right, result });
    }
    log({ event: 'merge_checked', leftId, rightId, outcome: result.outcome, conflicts: result.conflicts.length });
    const isCurrent =
      this.store.findChange(leftId)?.headCommit === left.headCommit &&
      this.store.findChange(rightId)?.headCommit === right.headCommit;
    return isCurrent ? 'done' : 'again';
  }

  // A conflict puts the change that started first ahead of the other one. Both sides learn the outcome and the other
  // change's intent.
  private announceMerge({ left, right, result }: AnnounceMergeParams): void {
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

  // Resolves the conflict while both changes are in flight. The resolution is stored, and it applies when the right
  // change restacks onto the left one. When the resolver fails here, the restack asks it again.
  private async resolveAhead({ left, right, result }: AnnounceMergeParams): Promise<void> {
    let resolution: ConflictResolution;
    try {
      resolution = await resolveConflicts({
        ai: this.env.AI,
        store: this.store,
        conflicts: result.conflicts,
        texts: result.texts,
        oursIntent: right.intent,
        theirsIntents: [left.intent]
      });
    } catch (error) {
      logError({ event: 'resolution_failed', leftId: left.id, rightId: right.id, error });
      return;
    }
    this.store.setMergeResolution({
      leftId: left.id,
      rightId: right.id,
      overlapResolution: {
        outcome: resolution.outcome,
        reason: resolution.outcome === 'needs_owner' ? resolution.reason : null,
        hunks: resolution.hunks
      }
    });
    this.announceResolution({ left, right, conflicts: result.conflicts, resolution });
  }

  private announceResolution({ left, right, conflicts, resolution }: AnnounceResolutionParams): void {
    this.emit({
      changeId: right.id,
      payload: {
        type: 'resolution',
        otherChange: { changeId: left.id, intent: left.intent },
        outcome: resolution.outcome,
        conflicts,
        reason: resolution.outcome === 'needs_owner' ? resolution.reason : null
      }
    });
    log({
      event: 'conflict_resolution',
      projectId: this.requireProject().id,
      leftId: left.id,
      rightId: right.id,
      outcome: resolution.outcome,
      reused: resolution.reused,
      chosen: resolution.chosen
    });
  }

  private async runLandJob({ projectId, jobKey, batchId }: LandJobParams): Promise<JobOutcome> {
    const batch = this.store.findBatch(batchId);
    if (batch?.state !== 'landing') {
      return 'done';
    }
    const landing = this.store.batchChangeIds(batchId).map((changeId) => {
      const change = pushedChange(this.store.findChange(changeId));
      if (change === null) {
        throw new Error(`Change ${changeId} of batch ${batchId} has no commits to land.`);
      }
      return change;
    });

    let result: LandResult;
    try {
      const plan = {
        trunk: await this.repoSide({ repoName: projectId, head: batch.trunkBefore, scope: 'write' }),
        changes: await Promise.all(
          landing.map((change) => this.landingChange({ projectId, change, batchId, approver: batch.approver }))
        )
      };
      result = await onRunnerPool({
        env: this.env,
        projectId,
        jobKey,
        task: (runner) => runner.land(plan)
      });
    } catch (error) {
      if (isError(error, HEAD_MOVED) || isError(error, LAND_CONFLICT)) {
        logError({ event: 'landing_stopped', batchId, error });
        this.failBatch(batchId);
        return 'done';
      }
      throw error;
    }
    await this.applyLanding({ batchId, approver: batch.approver, result });
    return 'done';
  }

  private async applyLanding({ batchId, approver, result }: ApplyLandingParams): Promise<void> {
    for (const { changeId, commit } of result.landed) {
      this.store.setLanded({ changeId, commit });
      this.emit({ changeId, payload: { type: 'landed', batchId, landedCommit: commit, approver } });
    }
    this.store.finishBatch({ batchId, state: 'landed' });
    this.store.setTrunkHead(result.trunkHead);
    for (const change of this.store.activeChanges()) {
      this.store.queueJob({ kind: 'restack', target: change.id, runAfter: Date.now() });
    }
    await this.ctx.storage.setAlarm(Date.now());
    log({ event: 'batch_landed', batchId, trunkHead: result.trunkHead, changes: result.landed.length });
  }

  private failBatch(batchId: string): void {
    const batch = this.store.findBatch(batchId);
    if (batch?.state !== 'landing') {
      return;
    }
    const changeIds = this.store.batchChangeIds(batchId);
    this.store.reopen(changeIds);
    this.store.finishBatch({ batchId, state: 'failed' });
    for (const changeId of changeIds) {
      this.emit({ changeId, payload: { type: 'landing_failed', batchId } });
    }
  }

  // Each change becomes one trunk commit. Its message is the intent, and its note records the change, the intent,
  // the owner, and the approver.
  private async landingChange({ projectId, change, batchId, approver }: LandingChangeParams): Promise<LandingChange> {
    const side = await this.repoSide({
      repoName: changeRepoName({ projectId, changeId: change.id }),
      head: change.headCommit,
      scope: 'read'
    });
    const owner = change.owner ?? 'unknown';
    const resolvedPaths = (change.resolvedConflicts ?? []).map((conflict) => conflict.path);
    return {
      ...side,
      changeId: change.id,
      base: change.baseCommit,
      message: `${change.intent}\n\nCommute-Change: ${change.id}`,
      note: [
        `change: ${change.id}`,
        `intent: ${change.intent}`,
        `owner: ${owner}`,
        `approved-by: ${approver}`,
        `batch: ${batchId}`,
        ...(resolvedPaths.length > 0 ? [`resolved-by: commute (${resolvedPaths.join(', ')})`] : [])
      ].join('\n'),
      authorName: owner,
      authorEmail: `${change.id}@agents.commute.invalid`
    };
  }

  // Brings a change onto the current trunk. A change that is already on it has nothing to do.
  private async runRestackJob({ projectId, jobKey, changeId }: RestackJobParams): Promise<JobOutcome> {
    const change = this.store.findChange(changeId);
    const trunkHead = this.store.project()?.trunkHead ?? null;
    if (
      change?.state !== 'open' ||
      change.baseCommit === null ||
      change.headCommit === null ||
      trunkHead === null ||
      change.baseCommit === trunkHead
    ) {
      return 'done';
    }

    let result: RestackResult;
    let resolution: ConflictResolution | null = null;
    try {
      const [changeSide, trunkSide] = await Promise.all([
        this.repoSide({ repoName: changeRepoName({ projectId, changeId }), head: change.headCommit, scope: 'write' }),
        this.repoSide({ repoName: projectId, head: trunkHead, scope: 'read' })
      ]);
      const plan = { change: changeSide, trunk: trunkSide, resolved: [] };
      result = await onRunnerPool({ env: this.env, projectId, jobKey, task: (runner) => runner.restack(plan) });
      if (result.outcome === 'conflict') {
        resolution = await resolveConflicts({
          ai: this.env.AI,
          store: this.store,
          conflicts: result.conflicts,
          texts: result.texts,
          oursIntent: change.intent,
          theirsIntents: this.store.landedIntents(result.conflicts)
        });
        if (resolution.outcome === 'needs_owner') {
          this.holdRestack({ projectId, changeId, trunkHead, conflicts: result.conflicts, reason: resolution.reason });
          return 'done';
        }
        const resolvedPlan = { ...plan, resolved: resolution.resolved };
        result = await onRunnerPool({
          env: this.env,
          projectId,
          jobKey,
          task: (runner) => runner.restack(resolvedPlan)
        });
      }
    } catch (error) {
      if (isError(error, HEAD_MOVED)) {
        await this.recordPush({ projectId, changeId });
        return 'again';
      }
      throw error;
    }
    await this.applyRestack({ projectId, change, trunkHead, result, resolution });
    return 'done';
  }

  // A conflict that Commute cannot resolve keeps the change on its old base until its owner pushes a merge.
  private holdRestack({ projectId, changeId, trunkHead, conflicts, reason }: HoldRestackParams): void {
    this.store.setRestackConflicts({ changeId, conflicts });
    this.emit({ changeId, payload: { type: 'restack_conflict', trunkCommit: trunkHead, conflicts, reason } });
    log({ event: 'restack_conflict', projectId, changeId, conflicts: conflicts.length, reason });
  }

  private async applyRestack({ projectId, change, trunkHead, result, resolution }: ApplyRestackParams): Promise<void> {
    const changeId = change.id;
    if (result.headCommit === null) {
      throw new Error(`The restack of ${changeId} ended in ${result.outcome} without a head commit.`);
    }
    this.store.setRestacked({ changeId, baseCommit: trunkHead, headCommit: result.headCommit });
    const resolvedPaths: string[] = [];
    if (resolution?.outcome === 'ready') {
      this.store.addResolvedConflicts({ changeId, conflicts: resolution.files });
      resolvedPaths.push(...resolution.files.map((file) => file.path));
    }
    using repo = await this.env.ARTIFACTS.get(changeRepoName({ projectId, changeId }));
    const footprint = await diffCommits({ repo, fromCommit: trunkHead, toCommit: result.headCommit });
    this.store.replacePushedFootprint({ changeId, paths: footprint });
    const overlaps = this.recordOverlaps({ changeId, isPush: true });
    await this.queueMergeChecks({ changeId, overlaps });
    this.emit({
      changeId,
      payload: { type: 'restacked', trunkCommit: trunkHead, headCommit: result.headCommit, resolvedPaths }
    });
    await this.queueChecks(changeId);
    log({
      event: 'change_restacked',
      projectId,
      changeId,
      outcome: result.outcome,
      trunkHead,
      resolvedReused: resolution?.reused ?? 0,
      resolvedChosen: resolution?.chosen ?? 0
    });
  }

  private async queueChecks(changeId: string): Promise<void> {
    this.store.queueJob({ kind: 'evaluate', target: changeId, runAfter: Date.now() });
    await this.ctx.storage.setAlarm(Date.now());
  }

  // Reads the checks that the head declares in commute.json and keys each one to the subtrees it reads. A key with a
  // result is kept; a key without one queues a run. A project file that does not parse, or checks that read too much,
  // keep the change waiting with the reason.
  private async runEvaluateJob({ projectId, changeId }: ChangeRef): Promise<JobOutcome> {
    const change = this.store.findChange(changeId);
    if (change?.state !== 'open' || change.headCommit === null) {
      return 'done';
    }
    const head = change.headCommit;
    using repo = await this.env.ARTIFACTS.get(changeRepoName({ projectId, changeId }));
    let checks: ChangeCheckRecord[];
    try {
      checks = await this.checksAtHead({ changeId, repo, head });
    } catch (error) {
      if (isError(error, CHECKS_INVALID)) {
        const reason = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
        this.store.replaceChangeChecks({ changeId, head, checks: [], error: reason });
        log({ event: 'checks_invalid', projectId, changeId, head, reason });
        return 'done';
      }
      throw error;
    }
    this.store.replaceChangeChecks({ changeId, head, checks, error: null });

    const pending = checks.filter((check) => check.outcome === 'pending');
    for (const check of pending) {
      this.store.queueJob({ kind: 'check', target: changeId, partner: check.name, runAfter: Date.now() });
    }
    if (pending.length > 0) {
      await this.ctx.storage.setAlarm(Date.now());
    } else if (checks.length > 0) {
      this.announceChecks(changeId);
    }
    log({ event: 'checks_evaluated', projectId, changeId, head, checks: checks.length, pending: pending.length });
    return 'done';
  }

  private async checksAtHead({ changeId, repo, head }: ChecksAtHeadParams): Promise<ChangeCheckRecord[]> {
    const previous = new Map(this.store.changeChecks(changeId).map((check) => [check.name, check]));
    const checks: ChangeCheckRecord[] = [];
    for (const declaration of await readProjectFile({ repo, commit: head })) {
      const reads = await subtreeHashes({ repo, commit: head, paths: declaration.reads });
      const key = await resultKey({ check: declaration, hashes: reads });
      const result = this.store.findCheckResult(key);
      // previousReads describes the head before this one, so evaluating the same head again keeps it.
      const before = previous.get(declaration.name);
      let previousReads = before?.reads ?? null;
      if (before?.head === head) {
        previousReads = before.previousReads;
      }
      checks.push({
        changeId,
        name: declaration.name,
        head,
        key,
        command: declaration.command,
        reads,
        previousReads,
        kept: result !== null,
        outcome: result?.outcome ?? 'pending'
      });
    }
    return checks;
  }

  private async runCheckJob({ projectId, jobKey, changeId, name }: CheckJobParams): Promise<JobOutcome> {
    const check = this.store.findChangeCheck({ changeId, name });
    const change = this.store.findChange(changeId);
    if (check?.outcome !== 'pending' || change?.headCommit !== check.head) {
      return 'done';
    }
    let result = this.store.findCheckResult(check.key);
    if (result === null) {
      let run: CheckRun;
      try {
        const side = await this.repoSide({
          repoName: changeRepoName({ projectId, changeId }),
          head: check.head,
          scope: 'read'
        });
        run = await onRunnerPool({
          env: this.env,
          projectId,
          jobKey,
          task: (runner) => runner.runCheck({ change: side, command: check.command })
        });
      } catch (error) {
        if (isError(error, HEAD_MOVED)) {
          await this.recordPush({ projectId, changeId });
          return 'again';
        }
        throw error;
      }
      result = {
        key: check.key,
        outcome: run.exitCode === 0 ? 'pass' : 'fail',
        exitCode: run.exitCode,
        output: run.output,
        ranAt: new Date().toISOString()
      };
      this.store.saveCheckResult(result);
      log({ event: 'check_ran', projectId, changeId, name, exitCode: run.exitCode });
    }
    for (const waitingChangeId of this.store.resolveChangeChecks({ key: check.key, outcome: result.outcome })) {
      if (this.store.changeChecks(waitingChangeId).every((waiting) => waiting.outcome !== 'pending')) {
        this.announceChecks(waitingChangeId);
      }
    }
    return 'done';
  }

  private announceChecks(changeId: string): void {
    const checks = this.store.changeChecks(changeId);
    this.emit({
      changeId,
      payload: {
        type: 'checks_done',
        kept: checks.filter((check) => check.kept).length,
        ran: checks.filter((check) => !check.kept).length,
        failed: checks.filter((check) => check.outcome === 'fail').map((check) => check.name)
      }
    });
  }

  private checkView(check: ChangeCheckRecord): Change['checks'][number] {
    const result = check.outcome === 'pending' ? null : this.store.findCheckResult(check.key);
    return {
      name: check.name,
      outcome: check.outcome,
      kept: check.kept,
      reads: check.reads,
      previousReads: check.previousReads,
      exitCode: result?.exitCode ?? null,
      output: result?.output ?? null
    };
  }

  // Why a change is not in the next batch. An empty list means the change is ready.
  private waitReasons(change: ChangeRecord): WaitReason[] {
    if (change.state === 'landing') {
      return [{ code: 'LANDING', changeIds: [] }];
    }
    const trunkHead = this.store.project()?.trunkHead ?? null;
    if (change.headCommit === change.baseCommit) {
      return [{ code: 'NO_COMMITS', changeIds: [] }];
    }
    if (change.restackConflicts !== null) {
      return [{ code: 'RESTACK_CONFLICT', changeIds: [] }];
    }
    if (change.baseCommit !== trunkHead) {
      return [{ code: 'RESTACKING', changeIds: [] }];
    }
    const reasons: WaitReason[] = [];
    const checks = this.store.changeChecks(change.id);
    if (change.checksHead !== change.headCommit || checks.some((check) => check.outcome === 'pending')) {
      reasons.push({ code: 'CHECKS_PENDING', changeIds: [] });
    } else if (change.checksError !== null) {
      reasons.push({ code: 'CHECKS_INVALID', changeIds: [] });
    } else if (checks.some((check) => check.outcome === 'fail')) {
      reasons.push({ code: 'CHECKS_FAILED', changeIds: [] });
    }
    const { landsAfter } = this.landingOrder(change.id);
    if (landsAfter.length > 0) {
      reasons.push({ code: 'LANDS_AFTER', changeIds: landsAfter });
    }
    const checked = new Set(
      this.store
        .currentMergeChecks(change.id)
        .map((check) => (check.leftId === change.id ? check.rightId : check.leftId))
    );
    const unchecked = this.currentOverlaps(change.id)
      .map((overlap) => overlap.changeId)
      .filter(
        (otherChangeId) => !checked.has(otherChangeId) && pushedChange(this.store.findChange(otherChangeId)) !== null
      );
    if (unchecked.length > 0) {
      reasons.push({ code: 'CHECKING', changeIds: unchecked });
    }
    return reasons;
  }

  // A conflict puts the left change, the one that started first, ahead of the right one.
  private landingOrder(changeId: string): Pick<Change, 'landsAfter' | 'landsBefore'> {
    const conflicts = this.store.currentMergeChecks(changeId).filter((check) => check.outcome === 'conflict');
    return {
      landsAfter: conflicts.filter((check) => check.rightId === changeId).map((check) => check.leftId),
      landsBefore: conflicts.filter((check) => check.leftId === changeId).map((check) => check.rightId)
    };
  }

  // The remote of a repository with a short token for one runner job. Trunk's repository name is the project ID.
  private async repoSide({ repoName, head, scope }: RepoSideParams): Promise<RepoHead> {
    using repo = await this.env.ARTIFACTS.get(repoName);
    const [info, jobToken] = await Promise.all([repo.info(), issueJobToken({ repo, scope })]);
    return { remote: info.remote, token: jobToken.token, head };
  }

  private emit({ changeId, payload }: EmitParams): void {
    const { type, ...fields } = payload;
    const record = this.store.insertEvent({ changeId, type, payload: fields });
    const message = JSON.stringify(eventFrom(record));
    for (const socket of [...this.ctx.getWebSockets(changeId), ...this.ctx.getWebSockets(PROJECT_SOCKET_TAG)]) {
      if (socket.deserializeAttachment() === SOCKET_REPLAYED) {
        socket.send(message);
      }
    }
  }
}

function eventFrom(record: EventRecord): ChangeEvent {
  return changeEventSchema.parse({
    ...record.payload,
    seq: record.seq,
    type: record.type,
    changeId: record.changeId,
    at: record.at
  });
}

function pushedChange(change: ChangeRecord | null): PushedChange | null {
  if (
    change === null ||
    (change.state !== 'open' && change.state !== 'landing') ||
    change.baseCommit === null ||
    change.headCommit === null ||
    change.headCommit === change.baseCommit
  ) {
    return null;
  }
  return { ...change, baseCommit: change.baseCommit, headCommit: change.headCommit };
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

function isError(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

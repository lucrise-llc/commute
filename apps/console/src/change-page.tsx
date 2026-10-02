import type { Change, ChangeEvent, Diff } from '@commute/api-client';

import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { getChange, getDiff, listCommits } from '@commute/api-client';

import { DiffView } from './diff-view';
import { useEvents } from './use-events';
import { CommitList } from './commits-page';
import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { CheckIcon, CheckOutcomeIcon, ClockIcon, EventIcon, OverlapIcon, ResolveIcon, StateIcon } from './icons';
import { countChecks, describeCheck, describeEvent, describeWait, ownerName, shortCommit, timeAgo } from './describe';

const TABS = [
  { name: 'activity', label: 'Activity' },
  { name: 'commits', label: 'Commits' },
  { name: 'checks', label: 'Checks' },
  { name: 'files', label: 'Files changed' }
] as const;

const STATE_LABELS = { open: 'Open', landing: 'Landing', landed: 'Landed' } as const;

export function ChangePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { changeId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const tab = TABS.find((candidate) => candidate.name === searchParams.get('tab'))?.name ?? 'activity';
  const change = useQuery({
    queryKey: [projectId, 'change', changeId],
    queryFn: async () => (await getChange({ path: { projectId, changeId }, throwOnError: true })).data
  });
  const commits = useQuery({
    queryKey: [projectId, 'commits', changeId],
    queryFn: async () => (await listCommits({ path: { projectId, ref: changeId }, throwOnError: true })).data
  });
  const diff = useQuery({
    queryKey: [projectId, 'diff', changeId],
    queryFn: async () => (await getDiff({ path: { projectId, changeId }, throwOnError: true })).data
  });
  const events = useEvents({ projectId, changeId });
  if (change.error !== null) {
    return <p>The change {changeId} was not found.</p>;
  }
  if (change.data === undefined) {
    return <p className="meta">Loading {changeId}…</p>;
  }
  const data = change.data;
  const commitCount = commits.data?.commits.length;
  const counts = {
    activity: events.length,
    commits: commitCount,
    checks: data.checks.length,
    files: diff.data?.files.length
  };
  const owner = ownerName(data.owner);
  return (
    <>
      <h1 className="title">
        {data.intent} <span className="id">{changeId}</span>
      </h1>
      <div className="subtitle">
        <span className={`pill ${data.state}`}>
          <StateIcon state={data.state} />
          {STATE_LABELS[data.state]}
        </span>
        {data.state === 'landed' ? (
          <span>
            <strong>{owner}</strong>'s change landed on <strong>trunk</strong> as{' '}
            <code>{shortCommit(data.landedCommit ?? '')}</code>
          </span>
        ) : (
          <span>
            <strong>{owner}</strong> wants to land {commitCount ?? '…'} commits into <strong>trunk</strong> from{' '}
            <Link to={`/p/${projectId}/tree/${changeId}`}>{changeId}</Link>
          </span>
        )}
      </div>
      <nav className="subtabs">
        {TABS.map(({ name, label }) => (
          <Link key={name} to={`?tab=${name}`} className={name === tab ? 'active' : ''}>
            {label} <span className="counter">{counts[name] ?? '…'}</span>
          </Link>
        ))}
      </nav>
      <div className="with-sidebar">
        <div>
          {tab === 'activity' ? <Activity change={data} events={events} /> : null}
          {tab === 'commits' ? <CommitList repoRef={changeId} /> : null}
          {tab === 'checks' ? <Checks change={data} /> : null}
          {tab === 'files' ? <Files diff={diff.data} /> : null}
          {data.state === 'landed' ? null : <LandingBox change={data} />}
        </div>
        <Sidebar change={data} />
      </div>
    </>
  );
}

type ChangeProps = {
  change: Change;
};

type ActivityProps = ChangeProps & {
  events: ChangeEvent[];
};

function Activity({ change, events }: ActivityProps): React.JSX.Element {
  const { projectId } = useProject();
  return (
    <>
      <div className="box description">
        <div className="box-header">
          <span>
            <strong>{ownerName(change.owner)}</strong> <span className="meta">started this change</span>
          </span>
        </div>
        <div className="box-body">{change.intent}</div>
      </div>
      <div className="timeline">
        {events.map((event) => (
          <div className="timeline-item" key={event.seq}>
            <span className="dot">
              <EventIcon event={event} />
            </span>
            {describeEvent(event)} <span className="meta">{timeAgo(event.at)}</span>
            {event.type === 'merge_checked' || event.type === 'resolution' ? (
              <>
                {' · '}
                <Link to={`/p/${projectId}/overlaps/${change.changeId}/${event.otherChange.changeId}`}>
                  View the overlap
                </Link>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Checks({ change }: ChangeProps): React.JSX.Element {
  if (change.checksError !== null) {
    return <div className="notice icon-fail">commute.json is not valid: {change.checksError}</div>;
  }
  if (change.checks.length === 0) {
    return <div className="notice">The project declares no checks.</div>;
  }
  return (
    <div className="box">
      {change.checks.map((check) => (
        <div className="box-row" key={check.name}>
          <CheckOutcomeIcon outcome={check.outcome} />
          <details className="grow">
            <summary>
              <strong>{check.name}</strong> <span className="meta">{describeCheck(check)}</span>
            </summary>
            <table className="reads">
              <thead>
                <tr>
                  <th>Reads</th>
                  <th>Hash now</th>
                  <th>Hash before the last restack</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(check.reads).map(([path, hash]) => (
                  <tr key={path}>
                    <td className="mono">{path}</td>
                    <td className="mono">{shortCommit(hash)}</td>
                    <td className="mono">{shortCommit(check.previousReads?.[path] ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {check.output === null ? null : <pre className="box-body">{check.output}</pre>}
          </details>
        </div>
      ))}
    </div>
  );
}

type FilesProps = {
  diff: Diff | undefined;
};

function Files({ diff }: FilesProps): React.JSX.Element {
  if (diff === undefined) {
    return <p className="meta">Loading the diff…</p>;
  }
  return (
    <>
      <p className="meta">
        {diff.files.length} files changed against trunk {shortCommit(diff.baseCommit)}
        {diff.isTruncated ? `; the list stops at ${diff.files.length} files` : ''}
      </p>
      {diff.files.map((file) => (
        <div className="box" key={file.path}>
          <div className="box-header mono">{file.path}</div>
          {file.isText ? (
            <DiffView before={file.before} after={file.after} />
          ) : (
            <div className="box-body meta">Binary or large file.</div>
          )}
        </div>
      ))}
    </>
  );
}

function Sidebar({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  const checks = countChecks(change.checks);
  return (
    <aside>
      <div className="sidebar-section">
        <h3>Owner</h3>
        {ownerName(change.owner)}
      </div>
      <div className="sidebar-section">
        <h3>Footprint</h3>
        {change.footprint.length === 0
          ? change.declaredPaths.map((path) => (
              <div className="mono" key={path}>
                {path} <span className="meta">(declared)</span>
              </div>
            ))
          : change.footprint.map((path) => (
              <div className="mono" key={path}>
                {path}
              </div>
            ))}
      </div>
      <div className="sidebar-section">
        <h3>Overlaps</h3>
        {change.overlaps.length === 0 ? <span className="meta">None</span> : null}
        {change.overlaps.map((overlap) => (
          <div key={overlap.changeId}>
            <Link to={`/p/${projectId}/overlaps/${change.changeId}/${overlap.changeId}`}>{overlap.changeId}</Link>{' '}
            <span className="meta">{overlap.intent}</span>
          </div>
        ))}
      </div>
      <div className="sidebar-section">
        <h3>Checks</h3>
        {checks.kept} kept, {checks.ran} ran{checks.pending > 0 ? `, ${checks.pending} running` : ''}
      </div>
      <div className="sidebar-section">
        <h3>Base on trunk</h3>
        <code>{shortCommit(change.baseCommit)}</code>
      </div>
    </aside>
  );
}

// Where a Git host puts its merge button: whether the change commutes, what it waits for, whether its results match
// its content, and the batch to approve. There is no action to update the base; the coordinator restacks.
function LandingBox({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  const { kept, ran, pending } = countChecks(change.checks);
  const isReady = change.waitsFor.length === 0;
  return (
    <>
      <div className="box landing-box">
        <div className="box-row">
          {change.overlaps.length === 0 ? (
            <CheckIcon className="icon-open" />
          ) : (
            <OverlapIcon className="icon-landing" />
          )}
          <span className="grow">
            {change.overlaps.length === 0 ? (
              'Commutes with every change in flight.'
            ) : (
              <>
                Overlaps{' '}
                {change.overlaps.map((overlap) => (
                  <Link key={overlap.changeId} to={`/p/${projectId}/overlaps/${change.changeId}/${overlap.changeId}`}>
                    {overlap.changeId}{' '}
                  </Link>
                ))}
                {change.landsAfter.length > 0
                  ? `and lands after ${change.landsAfter.join(', ')}.`
                  : 'and merges cleanly.'}
              </>
            )}
          </span>
        </div>
        <div className="box-row">
          {pending === 0 ? <CheckIcon className="icon-open" /> : <ClockIcon className="icon-landing" />}
          <span className="grow">
            {pending === 0
              ? `Every check result matches the current content: ${kept} kept, ${ran} ran.`
              : `${pending} checks are running on the current content.`}
          </span>
        </div>
        {change.resolvedConflicts === null ? null : (
          <div className="box-row">
            <ResolveIcon className="icon-open" />
            <span className="grow">
              Commute resolved the conflict in {change.resolvedConflicts.map((conflict) => conflict.path).join(', ')}
              {change.resolvedConflicts.some((conflict) => conflict.dropped.length > 0)
                ? `, dropping ${change.resolvedConflicts.flatMap((conflict) => conflict.dropped.map((drop) => `"${drop.text}" (${drop.reason})`)).join(', ')}.`
                : ', keeping every line of both changes.'}
            </span>
          </div>
        )}
        <div className="box-row">
          {isReady ? <CheckIcon className="icon-open" /> : <ClockIcon className="icon-landing" />}
          <strong className="grow">
            {isReady
              ? 'Ready to land with the next batch.'
              : `Waiting: ${change.waitsFor.map(describeWait).join('; ')}.`}
          </strong>
        </div>
      </div>
      <div className="spaced">
        <ApproveBatch />
      </div>
    </>
  );
}

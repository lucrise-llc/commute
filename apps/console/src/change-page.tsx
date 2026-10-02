import type { Change } from '@commute/api-client';

import { useQuery } from '@tanstack/react-query';
import { getChange, getDiff } from '@commute/api-client';
import { Link, useParams, useSearchParams } from 'react-router';

import { DiffView } from './diff-view';
import { useEvents } from './use-events';
import { CommitList } from './commits-page';
import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { describeEvent, describeWait, shortCommit } from './describe';

const TABS = ['activity', 'commits', 'checks', 'files'] as const;

export function ChangePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { changeId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const tab = TABS.find((candidate) => candidate === searchParams.get('tab')) ?? 'activity';
  const change = useQuery({
    queryKey: [projectId, 'change', changeId],
    queryFn: async () => (await getChange({ path: { projectId, changeId }, throwOnError: true })).data
  });
  if (change.error !== null) {
    return <p>The change {changeId} was not found.</p>;
  }
  if (change.data === undefined) {
    return <p>Loading {changeId}…</p>;
  }
  const data = change.data;
  return (
    <>
      <h2>
        {data.intent} <small>{changeId}</small>
      </h2>
      <p>
        {data.state} · owner {data.owner ?? 'unknown'} · base {shortCommit(data.baseCommit)} · head{' '}
        {shortCommit(data.headCommit)} · <Link to={`/p/${projectId}/tree/${changeId}`}>Browse the repository</Link>
      </p>
      <nav>
        {TABS.map((name) => (
          <span key={name}>{name === tab ? <strong>{name}</strong> : <Link to={`?tab=${name}`}>{name}</Link>} </span>
        ))}
      </nav>
      <hr />
      {tab === 'activity' ? <Activity change={data} /> : null}
      {tab === 'commits' ? <CommitList repoRef={changeId} /> : null}
      {tab === 'checks' ? <Checks change={data} /> : null}
      {tab === 'files' ? <Files changeId={changeId} /> : null}
      <hr />
      <LandingBox change={data} />
    </>
  );
}

type ChangeProps = {
  change: Change;
};

function Activity({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  const events = useEvents({ projectId, changeId: change.changeId });
  return (
    <>
      <p>{change.intent}</p>
      <ol>
        {events.map((event) => (
          <li key={event.seq}>
            {new Date(event.at).toLocaleTimeString()} {describeEvent(event)}
            {event.type === 'merge_checked' || event.type === 'resolution' ? (
              <>
                {' '}
                <Link to={`/p/${projectId}/overlaps/${change.changeId}/${event.otherChange.changeId}`}>Overlap</Link>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

type ChangeIdProps = {
  changeId: string;
};

function Checks({ change }: ChangeProps): React.JSX.Element {
  if (change.checksError !== null) {
    return <p>commute.json is not valid: {change.checksError}</p>;
  }
  if (change.checks.length === 0) {
    return <p>The project declares no checks.</p>;
  }
  return (
    <>
      {change.checks.map((check) => (
        <section key={check.name}>
          <h4>
            {check.name}: {check.outcome}, {check.kept ? 'kept from an earlier run' : 'ran for this content'}
          </h4>
          <table>
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
                  <td>{path}</td>
                  <td>
                    <code>{shortCommit(hash)}</code>
                  </td>
                  <td>
                    <code>{shortCommit(check.previousReads?.[path] ?? '')}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.output === null ? null : <pre>{check.output}</pre>}
        </section>
      ))}
    </>
  );
}

function Files({ changeId }: ChangeIdProps): React.JSX.Element {
  const { projectId } = useProject();
  const diff = useQuery({
    queryKey: [projectId, 'diff', changeId],
    queryFn: async () => (await getDiff({ path: { projectId, changeId }, throwOnError: true })).data
  });
  if (diff.data === undefined) {
    return <p>Loading the diff…</p>;
  }
  return (
    <>
      <p>
        {diff.data.files.length} files changed against trunk {shortCommit(diff.data.baseCommit)}
        {diff.data.isTruncated ? ' (truncated)' : ''}
      </p>
      {diff.data.files.map((file) => (
        <section key={file.path}>
          <h4>{file.path}</h4>
          {file.isText ? <DiffView before={file.before} after={file.after} /> : <p>Binary or large file.</p>}
        </section>
      ))}
    </>
  );
}

// What a Git host shows next to its merge button: whether the change commutes, what it waits for, whether its
// results match its content, and the batch to approve. There is no action to update the base; the coordinator
// restacks.
function LandingBox({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  if (change.state === 'landed') {
    return <p>Landed on trunk as {shortCommit(change.landedCommit ?? '')}.</p>;
  }
  const pending = change.checks.filter((check) => check.outcome === 'pending').length;
  return (
    <section>
      <h3>Landing</h3>
      <ul>
        <li>
          {change.overlaps.length === 0
            ? 'Commutes with every change in flight.'
            : `Overlaps ${change.overlaps.map((overlap) => overlap.changeId).join(', ')}.`}{' '}
          {change.overlaps.map((overlap) => (
            <Link key={overlap.changeId} to={`/p/${projectId}/overlaps/${change.changeId}/${overlap.changeId}`}>
              {overlap.changeId}{' '}
            </Link>
          ))}
        </li>
        <li>
          {change.waitsFor.length === 0 ? 'Ready to land.' : `Waits: ${change.waitsFor.map(describeWait).join('; ')}.`}
        </li>
        <li>
          {pending === 0
            ? `Every check result matches the current content (${change.checks.length} checks).`
            : `${pending} checks are running on the current content.`}
        </li>
        {change.resolvedConflicts === null ? null : (
          <li>
            Commute resolved conflicts in {change.resolvedConflicts.map((conflict) => conflict.path).join(', ')}
            {change.resolvedConflicts.some((conflict) => conflict.dropped.length > 0)
              ? `, dropping: ${change.resolvedConflicts.flatMap((conflict) => conflict.dropped.map((drop) => `"${drop.text}" (${drop.reason})`)).join(', ')}`
              : ', keeping every line of both changes'}
            .
          </li>
        )}
      </ul>
      <ApproveBatch />
    </section>
  );
}

import type { OverlapPage as Overlap } from '@commute/api-client';

import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getChange, getOverlap } from '@commute/api-client';

import { useProject } from './project-context';

// Two changes side by side: intents, footprints, the merge result, the conflicting hunk with its resolution, and the
// checks of the later change after its restack.
export function OverlapPage(): React.JSX.Element {
  const { projectId } = useProject();
  const { changeId = '', otherChangeId = '' } = useParams();
  const overlap = useQuery({
    queryKey: [projectId, 'overlap', changeId, otherChangeId],
    queryFn: async () => (await getOverlap({ path: { projectId, changeId, otherChangeId }, throwOnError: true })).data
  });
  if (overlap.data === undefined) {
    return <p>Loading the overlap…</p>;
  }
  const { left, right, merge, resolution } = overlap.data;
  return (
    <>
      <h2>
        Overlap of {left.changeId} and {right.changeId}
      </h2>
      <table>
        <thead>
          <tr>
            <th>{left.changeId} (lands first)</th>
            <th>{right.changeId}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{left.intent}</td>
            <td>{right.intent}</td>
          </tr>
          <tr>
            <td>
              owner {left.owner ?? 'unknown'}, {left.state}
            </td>
            <td>
              owner {right.owner ?? 'unknown'}, {right.state}
            </td>
          </tr>
          <tr>
            <td>{left.footprint.join(', ')}</td>
            <td>{right.footprint.join(', ')}</td>
          </tr>
        </tbody>
      </table>
      <p>
        {merge === null && 'No merge result for the current heads yet.'}
        {merge?.outcome === 'clean' && 'The two changes merge cleanly, so they land in any order.'}
        {merge?.outcome === 'conflict' &&
          `The two changes conflict on ${merge.conflicts.join(', ')}, so ${right.changeId} lands after ${left.changeId}.`}
      </p>
      {resolution === null ? null : <Resolution left={left} right={right} resolution={resolution} />}
      <LaterChecks changeId={right.changeId} />
      <p>
        <Link to={`/p/${projectId}/changes/${left.changeId}`}>{left.changeId}</Link> ·{' '}
        <Link to={`/p/${projectId}/changes/${right.changeId}`}>{right.changeId}</Link>
      </p>
    </>
  );
}

type ResolutionProps = Pick<Overlap, 'left' | 'right'> & {
  resolution: NonNullable<Overlap['resolution']>;
};

function Resolution({ left, right, resolution }: ResolutionProps): React.JSX.Element {
  return (
    <section>
      <h3>Resolution</h3>
      <p>
        {resolution.outcome === 'ready'
          ? `Commute resolved the conflict by choosing lines that both changes wrote. It applies when ${right.changeId} restacks after ${left.changeId} lands.`
          : `The conflict needs the owner of ${right.changeId}: ${resolution.reason ?? ''}`}
      </p>
      {resolution.hunks.map((hunk, index) => (
        <section key={`${hunk.path}-${index}`}>
          <h4>{hunk.path}</h4>
          <table>
            <thead>
              <tr>
                <th>Before both</th>
                <th>
                  {left.changeId}: {left.intent}
                </th>
                <th>
                  {right.changeId}: {right.intent}
                </th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <pre>{hunk.base.join('\n')}</pre>
                </td>
                <td>
                  <pre>{hunk.theirs.join('\n')}</pre>
                </td>
                <td>
                  <pre>{hunk.ours.join('\n')}</pre>
                </td>
                <td>
                  <pre>{hunk.lines === null ? '(needs the owner)' : hunk.lines.join('\n')}</pre>
                </td>
              </tr>
            </tbody>
          </table>
          {hunk.dropped.length === 0 ? null : (
            <ul>
              {hunk.dropped.map((drop) => (
                <li key={drop.text}>
                  Dropped "{drop.text}": {drop.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </section>
  );
}

type LaterChecksProps = {
  changeId: string;
};

function LaterChecks({ changeId }: LaterChecksProps): React.JSX.Element {
  const { projectId } = useProject();
  const change = useQuery({
    queryKey: [projectId, 'change', changeId],
    queryFn: async () => (await getChange({ path: { projectId, changeId }, throwOnError: true })).data
  });
  const checks = change.data?.checks ?? [];
  return (
    <section>
      <h3>Checks of {changeId} now</h3>
      <ul>
        {checks.map((check) => (
          <li key={check.name}>
            {check.name}: {check.outcome}, {check.kept ? 'kept' : 'ran'}
          </li>
        ))}
      </ul>
    </section>
  );
}

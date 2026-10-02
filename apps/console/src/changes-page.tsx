import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listChanges } from '@commute/api-client';

import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { describeEvent, describeWait } from './describe';

const FEED_EVENTS_SHOWN = 30;

export function ChangesPage(): React.JSX.Element {
  const { projectId, personName, events } = useProject();
  const [isMineOnly, setMineOnly] = useState(false);
  const changes = useQuery({
    queryKey: [projectId, 'changes'],
    queryFn: async () => (await listChanges({ path: { projectId }, throwOnError: true })).data
  });
  const me = personName.trim();
  const rows = (changes.data ?? []).filter((change) => !isMineOnly || change.owner === me);
  const overlaps = events.filter((event) => event.type === 'merge_checked' && event.outcome === 'sequenced');
  const kept = rows.reduce((sum, change) => sum + change.checks.kept, 0);
  const ran = rows.reduce((sum, change) => sum + change.checks.ran, 0);
  return (
    <>
      <h2>Changes</h2>
      <p>
        <label>
          <input type="checkbox" checked={isMineOnly} onChange={(event) => setMineOnly(event.target.checked)} /> Mine
          {me === '' ? ' (type your name above)' : ` (${me})`}
        </label>
      </p>
      <p>
        Checks of the current heads: {kept} kept from earlier runs, {ran} ran.
      </p>
      <table>
        <thead>
          <tr>
            <th>Change</th>
            <th>Intent</th>
            <th>Owner</th>
            <th>State</th>
            <th>Checks</th>
            <th>Waits for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((change) => (
            <tr key={change.changeId}>
              <td>
                <Link to={`/p/${projectId}/changes/${change.changeId}`}>{change.changeId}</Link>
              </td>
              <td>{change.intent}</td>
              <td>{change.owner ?? ''}</td>
              <td>
                {change.state}
                {change.resolvedConflicts > 0 ? ', resolved by Commute' : ''}
              </td>
              <td>
                {change.checks.kept} kept, {change.checks.ran} ran
                {change.checks.pending > 0 ? `, ${change.checks.pending} running` : ''}
                {change.checks.failed > 0 ? `, ${change.checks.failed} failed` : ''}
              </td>
              <td>{change.state === 'landed' ? '' : change.waitsFor.map(describeWait).join('; ') || 'ready'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <aside>
        <ApproveBatch />
        <section>
          <h3>Overlaps</h3>
          <ul>
            {overlaps.map((event) =>
              event.type === 'merge_checked' ? (
                <li key={event.seq}>
                  <Link to={`/p/${projectId}/overlaps/${event.changeId}/${event.otherChange.changeId}`}>
                    {event.changeId} and {event.otherChange.changeId}
                  </Link>{' '}
                  on {event.conflicts.join(', ')}
                </li>
              ) : null
            )}
          </ul>
        </section>
        <section>
          <h3>Events</h3>
          <ol reversed>
            {events
              .slice(-FEED_EVENTS_SHOWN)
              .toReversed()
              .map((event) => (
                <li key={event.seq}>
                  <Link to={`/p/${projectId}/changes/${event.changeId}`}>{event.changeId}</Link> {describeEvent(event)}
                </li>
              ))}
          </ol>
        </section>
      </aside>
    </>
  );
}

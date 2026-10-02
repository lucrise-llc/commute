import type { ChangeListItem } from '@commute/api-client';

import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listChanges } from '@commute/api-client';

import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { describeEvent, describeWait } from './describe';
import { ChangeLandedIcon, ChangeOpenIcon, EventIcon, StateIcon } from './icons';

const FEED_EVENTS_SHOWN = 12;

export function ChangesPage(): React.JSX.Element {
  const { projectId, personName, events } = useProject();
  const [isMineOnly, setMineOnly] = useState(false);
  const [isLandedShown, setLandedShown] = useState(false);
  const changes = useQuery({
    queryKey: [projectId, 'changes'],
    queryFn: async () => (await listChanges({ path: { projectId }, throwOnError: true })).data
  });
  const me = personName.trim();
  const mine = (changes.data ?? []).filter((change) => !isMineOnly || change.owner === me);
  const inFlight = mine.filter((change) => change.state !== 'landed');
  const landed = mine.filter((change) => change.state === 'landed');
  const rows = isLandedShown ? landed : inFlight;
  const kept = mine.reduce((sum, change) => sum + change.checks.kept, 0);
  const ran = mine.reduce((sum, change) => sum + change.checks.ran, 0);
  // The sequenced pairs in flight, as the coordinator reports them in each change's landsAfter.
  const sequences = (changes.data ?? []).flatMap((change) =>
    change.landsAfter.map((earlierChangeId) => ({ changeId: change.changeId, earlierChangeId }))
  );
  return (
    <div className="with-sidebar">
      <div>
        <div className="toolbar">
          <label>
            <input type="checkbox" checked={isMineOnly} onChange={(event) => setMineOnly(event.target.checked)} /> Mine
            {me === '' ? '' : ` (${me})`}
          </label>
          <span className="meta">
            Checks of the current heads: {kept} kept from earlier runs, {ran} ran
          </span>
        </div>
        <div className="box">
          <div className="box-header">
            <a
              href="#in-flight"
              className={isLandedShown ? 'meta' : 'row-title'}
              onClick={(event) => {
                event.preventDefault();
                setLandedShown(false);
              }}
            >
              <ChangeOpenIcon className="icon-open" /> {inFlight.length} In flight
            </a>
            <a
              href="#landed"
              className={isLandedShown ? 'row-title' : 'meta'}
              onClick={(event) => {
                event.preventDefault();
                setLandedShown(true);
              }}
            >
              <ChangeLandedIcon className="icon-landed" /> {landed.length} Landed
            </a>
          </div>
          {rows.length === 0 ? <div className="box-body meta">No changes here.</div> : null}
          {rows.map((change) => (
            <ChangeRow key={change.changeId} change={change} />
          ))}
        </div>
      </div>
      <aside>
        <ApproveBatch />
        <div className="box">
          <div className="box-header">
            <strong>Sequenced</strong>
          </div>
          {sequences.length === 0 ? <div className="box-body meta">No change waits for another.</div> : null}
          {sequences.map(({ changeId, earlierChangeId }) => (
            <div className="box-row" key={`${changeId}-${earlierChangeId}`}>
              <Link to={`/p/${projectId}/overlaps/${changeId}/${earlierChangeId}`}>
                {changeId} lands after {earlierChangeId}
              </Link>
            </div>
          ))}
        </div>
        <div className="box">
          <div className="box-header">
            <strong>Activity</strong>
          </div>
          {events
            .slice(-FEED_EVENTS_SHOWN)
            .toReversed()
            .map((event) => (
              <div className="box-row" key={event.seq}>
                <EventIcon event={event} />
                <span className="grow">
                  <Link to={`/p/${projectId}/changes/${event.changeId}`}>{event.changeId}</Link>{' '}
                  <span className="meta">{describeEvent(event)}</span>
                </span>
              </div>
            ))}
        </div>
      </aside>
    </div>
  );
}

type ChangeRowProps = {
  change: ChangeListItem;
};

function ChangeRow({ change }: ChangeRowProps): React.JSX.Element {
  const { projectId } = useProject();
  const waiting = change.waitsFor.map(describeWait).join('; ');
  let status = 'landed';
  if (change.state !== 'landed') {
    status = waiting === '' ? 'ready to land' : waiting;
  }
  return (
    <div className="box-row">
      <StateIcon state={change.state} />
      <div className="grow">
        <Link className="row-title" to={`/p/${projectId}/changes/${change.changeId}`}>
          {change.intent}
        </Link>{' '}
        {change.resolvedConflicts > 0 ? <span className="label">resolved by Commute</span> : null}
        <div className="meta">
          {change.changeId} by {change.owner ?? 'unknown'} · {status} · checks {change.checks.kept} kept,{' '}
          {change.checks.ran} ran
          {change.checks.pending > 0 ? `, ${change.checks.pending} running` : ''}
          {change.checks.failed > 0 ? `, ${change.checks.failed} failed` : ''}
        </div>
      </div>
    </div>
  );
}

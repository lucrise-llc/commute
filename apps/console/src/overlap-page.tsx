import type { OverlapPage as Overlap } from '@commute/api-client';

import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getChange, getOverlap } from '@commute/api-client';

import { useProject } from './project-context';
import { describeCheck, ownerName } from './describe';
import { CheckOutcomeIcon, OverlapIcon, ResolveIcon, StateIcon } from './icons';

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
    return <p className="meta">Loading the overlap…</p>;
  }
  const { left, right, merge, resolution } = overlap.data;
  return (
    <>
      <h1 className="title">
        Overlap of {left.changeId} and {right.changeId}
      </h1>
      <div className="side-by-side spaced">
        <ChangeCard side={left} note={noteFor({ outcome: merge?.outcome, isFirst: true })} />
        <ChangeCard side={right} note={noteFor({ outcome: merge?.outcome, isFirst: false })} />
      </div>
      <div className="notice">
        <OverlapIcon className="icon-landing" />
        {merge === null && 'No merge result for the current heads yet.'}
        {merge?.outcome === 'clean' && 'The two changes merge cleanly, so they land in any order.'}
        {merge?.outcome === 'conflict' &&
          `The two changes conflict on ${merge.conflicts.join(', ')}, so ${right.changeId} lands after ${left.changeId}.`}
      </div>
      {resolution === null ? null : <Resolution left={left} right={right} resolution={resolution} />}
      <LaterChecks changeId={right.changeId} />
    </>
  );
}

type NoteForParams = {
  outcome: 'clean' | 'conflict' | undefined;
  isFirst: boolean;
};

function noteFor({ outcome, isFirst }: NoteForParams): string {
  if (outcome === undefined) {
    return 'merge check pending';
  }
  if (outcome === 'clean') {
    return 'lands in any order';
  }
  return isFirst ? 'lands first' : 'lands after it';
}

type ChangeCardProps = {
  side: Overlap['left'];
  note: string;
};

function ChangeCard({ side, note }: ChangeCardProps): React.JSX.Element {
  const { projectId } = useProject();
  return (
    <div className="box">
      <div className="box-header">
        <StateIcon state={side.state} />
        <strong className="grow">{side.changeId}</strong>
        <span className="meta">{note}</span>
      </div>
      <div className="box-body">
        <Link className="row-title" to={`/p/${projectId}/changes/${side.changeId}`}>
          {side.intent}
        </Link>
        <div className="meta">
          by {ownerName(side.owner)} · {side.state}
        </div>
        <div className="mono spaced">{side.footprint.join(', ')}</div>
      </div>
    </div>
  );
}

type ResolutionProps = Pick<Overlap, 'left' | 'right'> & {
  resolution: NonNullable<Overlap['resolution']>;
};

function Resolution({ left, right, resolution }: ResolutionProps): React.JSX.Element {
  return (
    <div className="box">
      <div className="box-header">
        <ResolveIcon className={resolution.outcome === 'ready' ? 'icon-open' : 'icon-fail'} />
        <strong className="grow">Resolution</strong>
        <span className="label">{resolution.outcome === 'ready' ? 'chosen from both changes' : 'needs the owner'}</span>
      </div>
      <div className="box-body">
        {resolution.outcome === 'ready'
          ? `Commute kept the lines that both changes wrote, in an order that serves both intents. The resolution applies when ${right.changeId} restacks after ${left.changeId} lands.`
          : `The conflict needs the owner of ${right.changeId}: ${resolution.reason ?? ''}`}
      </div>
      {resolution.hunks.map((hunk, index) => (
        <div key={`${hunk.path}-${index}`}>
          <div className="box-header mono">{hunk.path}</div>
          <div className="hunk-grid">
            <div className="head">Before both</div>
            <div className="head">
              {left.changeId}: {left.intent}
            </div>
            <div className="head">
              {right.changeId}: {right.intent}
            </div>
            <div className="head">Resolution</div>
            <pre>{hunk.base.join('\n')}</pre>
            <pre>{hunk.theirs.join('\n')}</pre>
            <pre>{hunk.ours.join('\n')}</pre>
            <pre className="resolution">{hunk.lines === null ? '(needs the owner)' : hunk.lines.join('\n')}</pre>
          </div>
          {hunk.dropped.map((drop) => (
            <div className="box-row meta" key={drop.text}>
              Dropped "{drop.text}": {drop.reason}
            </div>
          ))}
        </div>
      ))}
    </div>
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
    <div className="box">
      <div className="box-header">
        <strong>Checks of {changeId} now</strong>
      </div>
      {checks.map((check) => (
        <div className="box-row" key={check.name}>
          <CheckOutcomeIcon outcome={check.outcome} />
          <strong>{check.name}</strong>
          <span className="meta">{describeCheck(check)}</span>
        </div>
      ))}
    </div>
  );
}

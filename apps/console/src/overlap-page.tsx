import type { OverlapPage as Overlap } from '@commute/api-client';

import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getChange, getOverlap } from '@commute/api-client';
import { ArrowsMergeIcon, IntersectIcon } from '@phosphor-icons/react';
import { Badge, Banner, cn, Code, Table, Text } from '@cloudflare/kumo';

import { Box, BoxRow } from './box';
import { Loading } from './loading';
import { RouterLink } from './router-link';
import { useProject } from './project-context';
import { describeCheck, ownerName } from './describe';
import { CheckOutcomeIcon, ICON_CLASS, StateIcon } from './icons';

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
    return <Loading text="Loading the overlap…" />;
  }
  const { left, right, merge, resolution } = overlap.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-normal">
        Overlap of {left.changeId} and {right.changeId}
      </h1>
      <div className="grid grid-cols-2 gap-4">
        <ChangeCard side={left} note={noteFor({ outcome: merge?.outcome, isFirst: true })} />
        <ChangeCard side={right} note={noteFor({ outcome: merge?.outcome, isFirst: false })} />
      </div>
      <Banner
        variant={merge?.outcome === 'conflict' ? 'alert' : 'secondary'}
        icon={<IntersectIcon weight="bold" className={ICON_CLASS} />}
      >
        {merge === null && 'No merge result for the current heads yet.'}
        {merge?.outcome === 'clean' && 'The two changes merge cleanly, so they land in any order.'}
        {merge?.outcome === 'conflict' &&
          `The two changes conflict on ${merge.conflicts.join(', ')}, so ${right.changeId} lands after ${left.changeId}.`}
      </Banner>
      {resolution === null ? null : <Resolution left={left} right={right} resolution={resolution} />}
      <LaterChecks changeId={right.changeId} />
    </div>
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
    <Box
      header={
        <span className="flex grow items-center gap-2">
          <StateIcon state={side.state} />
          <strong className="grow">{side.changeId}</strong>
          <span className="text-xs font-normal text-kumo-subtle">{note}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <RouterLink
          className="font-semibold text-kumo-default hover:text-kumo-link hover:underline"
          href={`/p/${projectId}/changes/${side.changeId}`}
        >
          {side.intent}
        </RouterLink>
        <Text variant="secondary" size="xs">
          by {ownerName(side.owner)} · {side.state}
        </Text>
        <Text variant="mono-secondary">{side.footprint.join(', ')}</Text>
      </div>
    </Box>
  );
}

type ResolutionProps = Pick<Overlap, 'left' | 'right'> & {
  resolution: NonNullable<Overlap['resolution']>;
};

function Resolution({ left, right, resolution }: ResolutionProps): React.JSX.Element {
  const isReady = resolution.outcome === 'ready';
  return (
    <Box
      header={
        <span className="flex grow items-center gap-2">
          <ArrowsMergeIcon className={cn(ICON_CLASS, isReady ? 'text-kumo-success' : 'text-kumo-danger')} />
          <strong className="grow">Resolution</strong>
          <Badge variant={isReady ? 'success' : 'error'}>
            {isReady ? 'chosen from both changes' : 'needs the owner'}
          </Badge>
        </span>
      }
    >
      <p className="px-4 py-3">
        {isReady
          ? `Commute kept the lines that both changes wrote, in an order that serves both intents. The resolution applies when ${right.changeId} restacks after ${left.changeId} lands.`
          : `The conflict needs the owner of ${right.changeId}: ${resolution.reason ?? ''}`}
      </p>
      {resolution.hunks.map((hunk, index) => (
        <div key={`${hunk.path}-${index}`}>
          <div className="border-b border-kumo-hairline bg-kumo-elevated px-4 py-2 font-mono text-xs">{hunk.path}</div>
          <Table layout="fixed">
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>Before both</Table.Head>
                <Table.Head>
                  {left.changeId}: {left.intent}
                </Table.Head>
                <Table.Head>
                  {right.changeId}: {right.intent}
                </Table.Head>
                <Table.Head>Resolution</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row className="align-top">
                <Table.Cell>
                  <HunkLines lines={hunk.base} />
                </Table.Cell>
                <Table.Cell>
                  <HunkLines lines={hunk.theirs} />
                </Table.Cell>
                <Table.Cell>
                  <HunkLines lines={hunk.ours} />
                </Table.Cell>
                <Table.Cell className="bg-kumo-success-tint">
                  <HunkLines lines={hunk.lines ?? ['(needs the owner)']} />
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table>
          {hunk.dropped.map((drop) => (
            <BoxRow key={drop.text} className="border-t border-kumo-hairline">
              <Text variant="secondary" size="sm">
                Dropped "{drop.text}": {drop.reason}
              </Text>
            </BoxRow>
          ))}
        </div>
      ))}
    </Box>
  );
}

type HunkLinesProps = {
  lines: string[];
};

function HunkLines({ lines }: HunkLinesProps): React.JSX.Element {
  return <Code code={lines.join('\n')} className="whitespace-pre-wrap text-kumo-default" />;
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
    <Box header={`Checks of ${changeId} now`}>
      {checks.map((check) => (
        <BoxRow key={check.name} className="items-center">
          <CheckOutcomeIcon outcome={check.outcome} />
          <strong>{check.name}</strong>
          <span className="text-sm text-kumo-subtle">{describeCheck(check)}</span>
        </BoxRow>
      ))}
    </Box>
  );
}

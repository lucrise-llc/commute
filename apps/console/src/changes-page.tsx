import type { ChangeListItem } from '@commute/api-client';

import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listChanges } from '@commute/api-client';
import { GitPullRequestIcon } from '@phosphor-icons/react';
import { Badge, Checkbox, cn, Empty, Link, Text } from '@cloudflare/kumo';

import { Box, BoxRow } from './box';
import { RouterLink } from './router-link';
import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { EventIcon, StateIcon } from './icons';
import { describeEvent, describeWait, ownerName } from './describe';

const FEED_EVENTS_SHOWN = 12;

export function ChangesPage(): React.JSX.Element {
  const { projectId, personName, events } = useProject();
  const [isMineOnly, setMineOnly] = useState(false);
  const [searchParams] = useSearchParams();
  const isLandedShown = searchParams.get('state') === 'landed';
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
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Checkbox
            label={me === '' ? 'Mine' : `Mine (${me})`}
            checked={isMineOnly}
            onCheckedChange={(checked) => setMineOnly(checked)}
          />
          <Text variant="secondary" size="xs">
            Checks of the current heads: {kept} kept from earlier runs, {ran} ran
          </Text>
        </div>
        <Box
          header={
            <span className="flex items-center gap-4">
              <FilterLink href={`/p/${projectId}/changes`} isActive={!isLandedShown}>
                <StateIcon state="open" className={isLandedShown ? 'text-current' : undefined} />
                {inFlight.length} In flight
              </FilterLink>
              <FilterLink href={`/p/${projectId}/changes?state=landed`} isActive={isLandedShown}>
                <StateIcon state="landed" className={isLandedShown ? undefined : 'text-current'} />
                {landed.length} Landed
              </FilterLink>
            </span>
          }
        >
          {rows.length === 0 ? (
            <Empty
              size="sm"
              icon={<GitPullRequestIcon className="size-8 text-kumo-inactive" />}
              title="No changes here."
            />
          ) : null}
          {rows.map((change) => (
            <ChangeRow key={change.changeId} change={change} />
          ))}
        </Box>
      </div>
      <aside className="flex flex-col gap-4">
        <ApproveBatch />
        <Box header="Sequenced">
          {sequences.length === 0 ? (
            <BoxRow>
              <Text variant="secondary" size="sm">
                No change waits for another.
              </Text>
            </BoxRow>
          ) : null}
          {sequences.map(({ changeId, earlierChangeId }) => (
            <BoxRow key={`${changeId}-${earlierChangeId}`}>
              <Link variant="plain" href={`/p/${projectId}/overlaps/${changeId}/${earlierChangeId}`}>
                {changeId} lands after {earlierChangeId}
              </Link>
            </BoxRow>
          ))}
        </Box>
        <Box header="Activity">
          {events
            .slice(-FEED_EVENTS_SHOWN)
            .toReversed()
            .map((event) => (
              <BoxRow key={event.seq} className="py-2.5">
                <span className="mt-0.5">
                  <EventIcon event={event} />
                </span>
                <p className="min-w-0 grow text-sm">
                  <Link variant="plain" href={`/p/${projectId}/changes/${event.changeId}`}>
                    {event.changeId}
                  </Link>{' '}
                  <span className="text-kumo-subtle">{describeEvent(event)}</span>
                </p>
              </BoxRow>
            ))}
        </Box>
      </aside>
    </div>
  );
}

type FilterLinkProps = {
  href: string;
  isActive: boolean;
  children: React.ReactNode;
};

// A filter of a Git host list: bold while it applies, muted otherwise.
function FilterLink({ href, isActive, children }: FilterLinkProps): React.JSX.Element {
  return (
    <RouterLink
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 hover:text-kumo-default',
        isActive ? 'font-semibold text-kumo-default' : 'text-kumo-subtle'
      )}
    >
      {children}
    </RouterLink>
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
    <BoxRow>
      <span className="mt-0.5">
        <StateIcon state={change.state} />
      </span>
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-2">
          <RouterLink
            className="font-semibold text-kumo-default hover:text-kumo-link hover:underline"
            href={`/p/${projectId}/changes/${change.changeId}`}
          >
            {change.intent}
          </RouterLink>
          {change.resolvedConflicts > 0 ? <Badge variant="outline">resolved by Commute</Badge> : null}
        </div>
        <Text variant="secondary" size="xs">
          {change.changeId} by {ownerName(change.owner)} · {status} · checks {change.checks.kept} kept,{' '}
          {change.checks.ran} ran
          {change.checks.pending > 0 ? `, ${change.checks.pending} running` : ''}
          {change.checks.failed > 0 ? `, ${change.checks.failed} failed` : ''}
        </Text>
      </div>
    </BoxRow>
  );
}

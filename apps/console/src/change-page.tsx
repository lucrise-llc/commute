import type { BadgeVariant } from '@cloudflare/kumo';
import type { Change, ChangeEvent, Diff } from '@commute/api-client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { getChange, getDiff, listCommits } from '@commute/api-client';
import { ArrowsMergeIcon, CheckCircleIcon, ClockIcon, IntersectIcon } from '@phosphor-icons/react';
import { Badge, Banner, cn, Code, Collapsible, Link, Loader, Table, Tabs, Text } from '@cloudflare/kumo';

import { Box, BoxRow } from './box';
import { Loading } from './loading';
import { DiffView } from './diff-view';
import { useEvents } from './use-events';
import { RouterLink } from './router-link';
import { CommitList } from './commits-page';
import { ApproveBatch } from './approve-batch';
import { useProject } from './project-context';
import { SidebarSection } from './sidebar-section';
import { ShortCommit, TimeAgo } from './hover-details';
import { CheckOutcomeIcon, EventIcon, ICON_CLASS, StateIcon } from './icons';
import { countChecks, describeCheck, describeEvent, describeWait, ownerName } from './describe';

const TABS = [
  { name: 'activity', label: 'Activity' },
  { name: 'commits', label: 'Commits' },
  { name: 'checks', label: 'Checks' },
  { name: 'files', label: 'Files changed' }
] as const;

const STATE_LABELS = { open: 'Open', landing: 'Landing', landed: 'Landed' } as const;

const STATE_BADGES: Record<Change['state'], BadgeVariant> = { open: 'green', landing: 'orange', landed: 'blue' };

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
    return <Banner variant="error">The change {changeId} was not found.</Banner>;
  }
  if (change.data === undefined) {
    return <Loading text={`Loading ${changeId}…`} />;
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
      <h1 className="text-3xl font-normal">
        {data.intent} <span className="font-light text-kumo-subtle">{changeId}</span>
      </h1>
      <div className="mt-2 flex items-center gap-2 text-kumo-subtle">
        <Badge variant={STATE_BADGES[data.state]} className="px-3 py-1 text-sm">
          <StateIcon state={data.state} className="text-current" />
          {STATE_LABELS[data.state]}
        </Badge>
        {data.state === 'landed' ? (
          <span>
            <strong className="text-kumo-default">{owner}</strong>'s change landed on{' '}
            <strong className="text-kumo-default">trunk</strong> as <ShortCommit commit={data.landedCommit ?? ''} />
          </span>
        ) : (
          <span>
            <strong className="text-kumo-default">{owner}</strong> wants to land {commitCount ?? '…'} commits into{' '}
            <strong className="text-kumo-default">trunk</strong> from{' '}
            <Link variant="plain" href={`/p/${projectId}/tree/${changeId}`}>
              {changeId}
            </Link>
          </span>
        )}
      </div>
      <Tabs
        variant="underline"
        value={tab}
        className="mt-4 mb-6"
        listClassName="h-auto pb-0"
        tabs={TABS.map(({ name, label }) => ({
          value: name,
          label: (
            <span className="flex items-center gap-2">
              {label}
              <Badge variant="secondary">{counts[name] ?? '…'}</Badge>
            </span>
          ),
          render: <RouterLink href={`?tab=${name}`} />,
          nativeButton: false
        }))}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-4">
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
      <Box
        header={
          <span>
            <strong>{ownerName(change.owner)}</strong>{' '}
            <span className="font-normal text-kumo-subtle">started this change</span>
          </span>
        }
      >
        <p className="px-4 py-3">{change.intent}</p>
      </Box>
      {events.length === 0 ? null : (
        <ol className="ml-4 border-l-2 border-kumo-hairline pl-6">
          {events.map((event) => (
            <li className="relative py-2" key={event.seq}>
              <span className="absolute top-1.5 -left-[38px] grid size-7 place-items-center rounded-full bg-kumo-elevated ring ring-kumo-hairline">
                <EventIcon event={event} />
              </span>
              {describeEvent(event)}{' '}
              <span className="text-sm text-kumo-subtle">
                <TimeAgo iso={event.at} />
              </span>
              {event.type === 'merge_checked' || event.type === 'resolution' ? (
                <>
                  <span className="text-kumo-subtle"> · </span>
                  <Link
                    variant="plain"
                    href={`/p/${projectId}/overlaps/${change.changeId}/${event.otherChange.changeId}`}
                  >
                    View the overlap
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Checks({ change }: ChangeProps): React.JSX.Element {
  if (change.checksError !== null) {
    return <Banner variant="error">commute.json is not valid: {change.checksError}</Banner>;
  }
  if (change.checks.length === 0) {
    return <Banner variant="secondary">The project declares no checks.</Banner>;
  }
  return (
    <Box>
      {change.checks.map((check) => (
        <BoxRow key={check.name}>
          <span className="mt-0.5">
            <CheckOutcomeIcon outcome={check.outcome} />
          </span>
          <Collapsible.Root className="min-w-0 grow">
            <Collapsible.DefaultTrigger>
              <span className="flex items-center gap-2">
                <strong>{check.name}</strong>
                <span className="font-normal text-kumo-subtle">{describeCheck(check)}</span>
              </span>
            </Collapsible.DefaultTrigger>
            <Collapsible.DefaultPanel>
              <Table className="text-sm">
                <Table.Header variant="compact">
                  <Table.Row>
                    <Table.Head>Reads</Table.Head>
                    <Table.Head>Hash now</Table.Head>
                    <Table.Head>Hash before the last restack</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {Object.entries(check.reads).map(([path, hash]) => (
                    <Table.Row key={path}>
                      <Table.Cell className="font-mono">{path}</Table.Cell>
                      <Table.Cell>
                        <ShortCommit commit={hash} />
                      </Table.Cell>
                      <Table.Cell>
                        <ShortCommit commit={check.previousReads?.[path] ?? ''} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
              {check.output === null ? null : (
                <Code code={check.output} className="whitespace-pre-wrap text-kumo-default" />
              )}
            </Collapsible.DefaultPanel>
          </Collapsible.Root>
        </BoxRow>
      ))}
    </Box>
  );
}

type FilesProps = {
  diff: Diff | undefined;
};

function Files({ diff }: FilesProps): React.JSX.Element {
  if (diff === undefined) {
    return <Loading text="Loading the diff…" />;
  }
  return (
    <>
      <Text variant="secondary" size="sm">
        {diff.files.length} files changed against trunk <ShortCommit commit={diff.baseCommit} />
        {diff.isTruncated ? `; the list stops at ${diff.files.length} files` : ''}
      </Text>
      {diff.files.map((file) => (
        <Box key={file.path} header={<span className="font-mono text-sm">{file.path}</span>}>
          {file.isText ? (
            <DiffView before={file.before} after={file.after} />
          ) : (
            <p className="px-4 py-3 text-sm text-kumo-subtle">Binary or large file.</p>
          )}
        </Box>
      ))}
    </>
  );
}

function Sidebar({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  const checks = countChecks(change.checks);
  return (
    <aside>
      <SidebarSection title="Owner">{ownerName(change.owner)}</SidebarSection>
      <SidebarSection title="Footprint">
        {change.footprint.length === 0
          ? change.declaredPaths.map((path) => (
              <div className="font-mono text-sm" key={path}>
                {path} <span className="font-sans text-kumo-subtle">(declared)</span>
              </div>
            ))
          : change.footprint.map((path) => (
              <div className="font-mono text-sm" key={path}>
                {path}
              </div>
            ))}
      </SidebarSection>
      <SidebarSection title="Overlaps">
        {change.overlaps.length === 0 ? <span className="text-kumo-subtle">None</span> : null}
        {change.overlaps.map((overlap) => (
          <div key={overlap.changeId}>
            <Link variant="plain" href={`/p/${projectId}/overlaps/${change.changeId}/${overlap.changeId}`}>
              {overlap.changeId}
            </Link>{' '}
            <span className="text-kumo-subtle">{overlap.intent}</span>
          </div>
        ))}
      </SidebarSection>
      <SidebarSection title="Checks">
        {checks.kept} kept, {checks.ran} ran{checks.pending > 0 ? `, ${checks.pending} running` : ''}
      </SidebarSection>
      <SidebarSection title="Base on trunk">
        <ShortCommit commit={change.baseCommit} />
      </SidebarSection>
    </aside>
  );
}

type MergeRowProps = {
  icon: React.ReactNode;
  isStrong?: boolean;
  children: React.ReactNode;
};

function MergeRow({ icon, isStrong = false, children }: MergeRowProps): React.JSX.Element {
  return (
    <BoxRow className="items-center">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-kumo-elevated">{icon}</span>
      <span className={cn('min-w-0 grow', isStrong && 'font-semibold')}>{children}</span>
    </BoxRow>
  );
}

// Where a Git host puts its merge button: whether the change commutes, what it waits for, whether its results match
// its content, and the batch to approve. There is no action to update the base; the coordinator restacks.
function LandingBox({ change }: ChangeProps): React.JSX.Element {
  const { projectId } = useProject();
  const { kept, ran } = countChecks(change.checks);
  const isChecking = change.waitsFor.some((reason) => reason.code === 'CHECKS_PENDING');
  const isReady = change.waitsFor.length === 0;
  const passIcon = <CheckCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-success')} />;
  return (
    <>
      <Box className="mt-2">
        <MergeRow
          icon={
            change.overlaps.length === 0 ? passIcon : <IntersectIcon className={cn(ICON_CLASS, 'text-kumo-warning')} />
          }
        >
          {change.overlaps.length === 0 ? (
            'Commutes with every change in flight.'
          ) : (
            <>
              Overlaps{' '}
              {change.overlaps.map((overlap) => (
                <span key={overlap.changeId}>
                  <Link variant="plain" href={`/p/${projectId}/overlaps/${change.changeId}/${overlap.changeId}`}>
                    {overlap.changeId}
                  </Link>{' '}
                </span>
              ))}
              {change.landsAfter.length > 0
                ? `and lands after ${change.landsAfter.join(', ')}.`
                : 'and merges cleanly.'}
            </>
          )}
        </MergeRow>
        <MergeRow icon={isChecking ? <Loader size="sm" className="text-kumo-warning" /> : passIcon}>
          {isChecking
            ? 'Checks are running on the current content.'
            : `Every check result matches the current content: ${kept} kept, ${ran} ran.`}
        </MergeRow>
        {change.resolvedConflicts === null ? null : (
          <MergeRow icon={<ArrowsMergeIcon className={cn(ICON_CLASS, 'text-kumo-success')} />}>
            Commute resolved the conflict in {change.resolvedConflicts.map((conflict) => conflict.path).join(', ')}
            {change.resolvedConflicts.some((conflict) => conflict.dropped.length > 0)
              ? `, dropping ${change.resolvedConflicts.flatMap((conflict) => conflict.dropped.map((drop) => `"${drop.text}" (${drop.reason})`)).join(', ')}.`
              : ', keeping every line of both changes.'}
          </MergeRow>
        )}
        <MergeRow isStrong icon={isReady ? passIcon : <ClockIcon className={cn(ICON_CLASS, 'text-kumo-warning')} />}>
          {isReady ? 'Ready to land with the next batch.' : `Waiting: ${change.waitsFor.map(describeWait).join('; ')}.`}
        </MergeRow>
      </Box>
      <ApproveBatch />
    </>
  );
}

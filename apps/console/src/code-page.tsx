import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { getBlob, getTree, listChanges, listCommits } from '@commute/api-client';
import { Breadcrumbs, cn, Code, Empty, Link, Select, Text } from '@cloudflare/kumo';
import { BookOpenIcon, FileIcon, FolderIcon, GitBranchIcon } from '@phosphor-icons/react';

import { Box, BoxRow } from './box';
import { ownerName } from './describe';
import { RouterLink } from './router-link';
import { useProject } from './project-context';
import { ICON_CLASS, StateIcon } from './icons';
import { SidebarSection } from './sidebar-section';
import { ShortCommit, TimeAgo } from './short-forms';

const README_NAME = 'README.md';
const TRUNK_REF = 'trunk';

// Trunk at its last landing, or the repository of a change. Each folder lists the changes in flight that touch it.
export function CodePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = TRUNK_REF, '*': splat = '' } = useParams();
  const path = splat.replace(/\/$/, '');
  const navigate = useNavigate();
  const tree = useQuery({
    queryKey: [projectId, 'tree', ref, path],
    queryFn: async () =>
      (await getTree({ path: { projectId, ref }, query: path === '' ? {} : { path }, throwOnError: true })).data
  });
  const commits = useQuery({
    queryKey: [projectId, 'commits', ref],
    queryFn: async () => (await listCommits({ path: { projectId, ref }, throwOnError: true })).data
  });
  const changes = useQuery({
    queryKey: [projectId, 'changes'],
    queryFn: async () => (await listChanges({ path: { projectId }, throwOnError: true })).data
  });
  const inFlight = (changes.data ?? []).filter((change) => change.state !== 'landed');
  const touching = inFlight.filter((change) =>
    change.footprint.some(
      (footprintPath) =>
        path === '' ||
        footprintPath === path ||
        footprintPath.startsWith(`${path}/`) ||
        path.startsWith(`${footprintPath}/`)
    )
  );
  const readme = tree.data?.entries.find((entry) => entry.name === README_NAME && entry.type === 'blob');
  const latest = commits.data?.commits[0];
  const switchRef = async (next: string): Promise<void> => {
    await navigate(`/p/${projectId}/tree/${next}`);
  };
  const refItems = [
    { value: TRUNK_REF, label: TRUNK_REF },
    ...inFlight.map((change) => ({ value: change.changeId, label: `${change.changeId}: ${change.intent}` }))
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3">
          <Select
            aria-label="Repository"
            className="max-w-72"
            value={ref}
            items={refItems}
            renderValue={(value) => (
              <span className="flex min-w-0 items-center gap-1.5">
                <GitBranchIcon className={ICON_CLASS} />
                <span className="truncate">{value}</span>
              </span>
            )}
            onValueChange={(next) => {
              if (next !== null) {
                switchRef(next).catch(reportError);
              }
            }}
          />
          <PathBreadcrumbs repoRef={ref} path={path} />
        </div>
        <Box
          header={
            latest === undefined ? (
              <span className="font-normal text-kumo-subtle">No commits yet</span>
            ) : (
              <span className="flex min-w-0 grow items-center gap-3">
                <strong>{latest.author}</strong>
                <span className="min-w-0 grow truncate font-normal">{latest.message.split('\n')[0]}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-kumo-subtle">
                  <ShortCommit commit={latest.hash} /> · <TimeAgo iso={latest.authoredAt} /> ·{' '}
                  <Link variant="plain" href={`/p/${projectId}/commits/${ref}`}>
                    History
                  </Link>
                </span>
              </span>
            )
          }
        >
          {tree.error === null ? null : (
            <Empty size="sm" icon={<FolderIcon className="size-8 text-kumo-inactive" />} title="Nothing here yet." />
          )}
          {(tree.data?.entries ?? []).map((entry) => (
            <BoxRow key={entry.path} className="items-center py-2">
              {entry.type === 'tree' ? (
                <FolderIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-info')} />
              ) : (
                <FileIcon className={cn(ICON_CLASS, 'text-kumo-subtle')} />
              )}
              <RouterLink
                className="text-kumo-default hover:text-kumo-link hover:underline"
                href={`/p/${projectId}/${entry.type === 'tree' ? 'tree' : 'blob'}/${ref}/${entry.path}`}
              >
                {entry.name}
              </RouterLink>
            </BoxRow>
          ))}
        </Box>
        {readme === undefined ? null : <Readme repoRef={ref} path={readme.path} />}
      </div>
      <aside>
        <SidebarSection title="About">
          {ref === TRUNK_REF ? 'Trunk at its last landing.' : `The repository of change ${ref}.`}
        </SidebarSection>
        <SidebarSection title="Changes in flight here">
          {touching.length === 0 ? <span className="text-kumo-subtle">None</span> : null}
          {touching.map((change) => (
            <div key={change.changeId} className="flex items-start gap-2 py-1">
              <span className="mt-0.5">
                <StateIcon state={change.state} />
              </span>
              <span className="min-w-0 grow">
                <Link variant="plain" href={`/p/${projectId}/changes/${change.changeId}`}>
                  {change.intent}
                </Link>
                <Text variant="secondary" size="xs">
                  {change.changeId} by {ownerName(change.owner)}
                </Text>
              </span>
            </div>
          ))}
        </SidebarSection>
      </aside>
    </div>
  );
}

type RefPathProps = {
  repoRef: string;
  path: string;
};

// The project, then each folder of the path as a link, then the last segment as the current page.
export function PathBreadcrumbs({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const segments = path === '' ? [] : path.split('/');
  const current = segments.at(-1);
  const crumbs: React.ReactNode[] = [];
  if (current === undefined) {
    crumbs.push(<Breadcrumbs.Current key="project">{projectId}</Breadcrumbs.Current>);
  } else {
    crumbs.push(
      <Breadcrumbs.Link key="project" href={`/p/${projectId}/tree/${ref}`}>
        {projectId}
      </Breadcrumbs.Link>
    );
  }
  segments.forEach((segment, index) => {
    const segmentPath = segments.slice(0, index + 1).join('/');
    crumbs.push(<Breadcrumbs.Separator key={`separator-${segmentPath}`} />);
    if (index === segments.length - 1) {
      crumbs.push(<Breadcrumbs.Current key={segmentPath}>{segment}</Breadcrumbs.Current>);
    } else {
      crumbs.push(
        <Breadcrumbs.Link key={segmentPath} href={`/p/${projectId}/tree/${ref}/${segmentPath}`}>
          {segment}
        </Breadcrumbs.Link>
      );
    }
  });
  return (
    <Breadcrumbs size="sm" className="h-auto grow-0">
      {crumbs}
    </Breadcrumbs>
  );
}

function Readme({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  return (
    <Box
      header={
        <span className="flex items-center gap-2">
          <BookOpenIcon className={ICON_CLASS} />
          {README_NAME}
        </span>
      }
    >
      <Code code={blob.data?.text ?? ''} className="px-4 py-3 whitespace-pre-wrap text-kumo-default" />
    </Box>
  );
}

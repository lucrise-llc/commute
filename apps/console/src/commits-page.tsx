import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listCommits } from '@commute/api-client';
import { GitCommitIcon } from '@phosphor-icons/react';
import { cn, Empty, Link, Text } from '@cloudflare/kumo';

import { Box, BoxRow } from './box';
import { ICON_CLASS } from './icons';
import { useProject } from './project-context';
import { ShortCommit, TimeAgo } from './short-forms';

export function CommitsPage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <Text variant="heading" size="lg" as="h2">
        Commits on{' '}
        <Link variant="plain" href={`/p/${projectId}/tree/${ref}`}>
          {ref}
        </Link>
      </Text>
      <CommitList repoRef={ref} />
    </div>
  );
}

type CommitListProps = {
  repoRef: string;
};

// The newest commits of trunk, or the commits of a change since its base.
export function CommitList({ repoRef }: CommitListProps): React.JSX.Element {
  const { projectId } = useProject();
  const commits = useQuery({
    queryKey: [projectId, 'commits', repoRef],
    queryFn: async () => (await listCommits({ path: { projectId, ref: repoRef }, throwOnError: true })).data
  });
  const list = commits.data?.commits ?? [];
  return (
    <Box>
      {list.length === 0 ? (
        <Empty size="sm" icon={<GitCommitIcon className="size-8 text-kumo-inactive" />} title="No commits yet." />
      ) : null}
      {list.map((commit) => (
        <BoxRow key={commit.hash}>
          <GitCommitIcon className={cn(ICON_CLASS, 'mt-0.5 text-kumo-subtle')} />
          <div className="min-w-0 grow">
            <p className="font-semibold">{commit.message.split('\n')[0]}</p>
            <Text variant="secondary" size="xs">
              {commit.author} committed <TimeAgo iso={commit.authoredAt} />
            </Text>
          </div>
          <ShortCommit commit={commit.hash} />
        </BoxRow>
      ))}
    </Box>
  );
}

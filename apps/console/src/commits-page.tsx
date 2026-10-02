import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listCommits } from '@commute/api-client';

import { shortCommit } from './describe';
import { useProject } from './project-context';

export function CommitsPage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk' } = useParams();
  return (
    <>
      <h2>
        Commits of <Link to={`/p/${projectId}/tree/${ref}`}>{ref}</Link>
      </h2>
      <CommitList repoRef={ref} />
    </>
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
  return (
    <ul>
      {(commits.data?.commits ?? []).map((commit) => (
        <li key={commit.hash}>
          <code>{shortCommit(commit.hash)}</code> {commit.message.split('\n')[0]} · {commit.author} ·{' '}
          {new Date(commit.authoredAt).toLocaleString()}
        </li>
      ))}
    </ul>
  );
}

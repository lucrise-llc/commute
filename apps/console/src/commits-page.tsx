import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listCommits } from '@commute/api-client';

import { shortCommit } from './describe';
import { useProject } from './project-context';

export function CommitsPage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk' } = useParams();
  const commits = useQuery({
    queryKey: [projectId, 'commits', ref],
    queryFn: async () => (await listCommits({ path: { projectId, ref }, throwOnError: true })).data
  });
  return (
    <>
      <h2>
        Commits of <Link to={`/p/${projectId}/tree/${ref}`}>{ref}</Link>
      </h2>
      <ul>
        {(commits.data?.commits ?? []).map((commit) => (
          <li key={commit.hash}>
            <code>{shortCommit(commit.hash)}</code> {commit.message.split('\n')[0]} · {commit.author} ·{' '}
            {new Date(commit.authoredAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </>
  );
}

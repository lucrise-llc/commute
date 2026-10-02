import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listCommits } from '@commute/api-client';

import { CommitIcon } from './icons';
import { useProject } from './project-context';
import { shortCommit, timeAgo } from './describe';

export function CommitsPage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk' } = useParams();
  return (
    <>
      <div className="toolbar">
        <h2>
          Commits on <Link to={`/p/${projectId}/tree/${ref}`}>{ref}</Link>
        </h2>
      </div>
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
  const list = commits.data?.commits ?? [];
  return (
    <div className="box">
      {list.length === 0 ? <div className="box-body meta">No commits yet.</div> : null}
      {list.map((commit) => (
        <div className="box-row" key={commit.hash}>
          <CommitIcon className="icon-muted" />
          <span className="grow">
            <span className="row-title">{commit.message.split('\n')[0]}</span>
            <div className="meta">
              {commit.author} committed {timeAgo(commit.authoredAt)}
            </div>
          </span>
          <code>{shortCommit(commit.hash)}</code>
        </div>
      ))}
    </div>
  );
}

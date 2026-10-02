import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { getBlob, getTree, listChanges, listCommits } from '@commute/api-client';

import { useProject } from './project-context';
import { FileIcon, FolderIcon, StateIcon } from './icons';
import { ownerName, shortCommit, timeAgo } from './describe';

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
  return (
    <div className="with-sidebar">
      <div>
        <div className="toolbar">
          <select
            aria-label="Repository"
            value={ref}
            onChange={(event) => switchRef(event.target.value).catch(reportError)}
          >
            <option value={TRUNK_REF}>trunk</option>
            {inFlight.map((change) => (
              <option key={change.changeId} value={change.changeId}>
                {change.changeId}: {change.intent}
              </option>
            ))}
          </select>
          <Breadcrumbs repoRef={ref} path={path} />
        </div>
        <div className="box">
          <div className="box-header">
            {latest === undefined ? (
              <span className="meta">No commits yet</span>
            ) : (
              <>
                <strong>{latest.author}</strong>
                <span className="grow">{latest.message.split('\n')[0]}</span>
                <span className="meta">
                  <code>{shortCommit(latest.hash)}</code> · {timeAgo(latest.authoredAt)} ·{' '}
                  <Link to={`/p/${projectId}/commits/${ref}`}>History</Link>
                </span>
              </>
            )}
          </div>
          {tree.error === null ? null : <div className="box-body meta">Nothing here yet.</div>}
          {(tree.data?.entries ?? []).map((entry) => (
            <div className="box-row" key={entry.path}>
              {entry.type === 'tree' ? <FolderIcon className="icon-muted" /> : <FileIcon className="icon-muted" />}
              <Link
                className="grow"
                to={`/p/${projectId}/${entry.type === 'tree' ? 'tree' : 'blob'}/${ref}/${entry.path}`}
              >
                {entry.name}
              </Link>
            </div>
          ))}
        </div>
        {readme === undefined ? null : <Readme repoRef={ref} path={readme.path} />}
      </div>
      <aside>
        <div className="sidebar-section">
          <h3>About</h3>
          {ref === TRUNK_REF ? 'Trunk at its last landing.' : `The repository of change ${ref}.`}
        </div>
        <div className="sidebar-section">
          <h3>Changes in flight here</h3>
          {touching.length === 0 ? <span className="meta">None</span> : null}
          {touching.map((change) => (
            <div key={change.changeId} className="compact-row">
              <StateIcon state={change.state} />
              <span className="grow">
                <Link to={`/p/${projectId}/changes/${change.changeId}`}>{change.intent}</Link>
                <div className="meta">
                  {change.changeId} by {ownerName(change.owner)}
                </div>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

type RefPathProps = {
  repoRef: string;
  path: string;
};

export function Breadcrumbs({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const segments = path === '' ? [] : path.split('/');
  return (
    <span>
      <Link to={`/p/${projectId}/tree/${ref}`}>
        <strong>{projectId}</strong>
      </Link>
      {segments.map((segment, index) => (
        <span key={segments.slice(0, index + 1).join('/')}>
          {' / '}
          <Link to={`/p/${projectId}/tree/${ref}/${segments.slice(0, index + 1).join('/')}`}>{segment}</Link>
        </span>
      ))}
    </span>
  );
}

function Readme({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  return (
    <div className="box">
      <div className="box-header">
        <FileIcon className="icon-muted" /> <strong>{README_NAME}</strong>
      </div>
      <pre className="box-body">{blob.data?.text ?? ''}</pre>
    </div>
  );
}

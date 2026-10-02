import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { getBlob, getTree, listChanges } from '@commute/api-client';

import { useProject } from './project-context';

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
  const changes = useQuery({
    queryKey: [projectId, 'changes'],
    queryFn: async () => (await listChanges({ path: { projectId }, throwOnError: true })).data
  });
  const inFlight = (changes.data ?? []).filter((change) => change.state !== 'landed');
  const touching = inFlight.filter((change) =>
    change.footprint.some(
      (footprintPath) => path === '' || footprintPath === path || footprintPath.startsWith(`${path}/`)
    )
  );
  const readme = tree.data?.entries.find((entry) => entry.name === README_NAME && entry.type === 'blob');
  const switchRef = async (next: string): Promise<void> => {
    await navigate(`/p/${projectId}/tree/${next}`);
  };
  return (
    <>
      <p>
        <label>
          Repository{' '}
          <select value={ref} onChange={(event) => switchRef(event.target.value).catch(reportError)}>
            <option value={TRUNK_REF}>trunk</option>
            {inFlight.map((change) => (
              <option key={change.changeId} value={change.changeId}>
                {change.changeId}: {change.intent}
              </option>
            ))}
          </select>
        </label>{' '}
        · <Link to={`/p/${projectId}/commits/${ref}`}>Commits</Link>
      </p>
      <Breadcrumbs repoRef={ref} path={path} />
      {tree.error === null ? null : <p>Nothing here yet: {tree.error.message}</p>}
      <table>
        <tbody>
          {(tree.data?.entries ?? []).map((entry) => (
            <tr key={entry.path}>
              <td>
                <Link to={`/p/${projectId}/${entry.type === 'tree' ? 'tree' : 'blob'}/${ref}/${entry.path}`}>
                  {entry.name}
                  {entry.type === 'tree' ? '/' : ''}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section>
        <h3>Changes in flight here</h3>
        {touching.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {touching.map((change) => (
              <li key={change.changeId}>
                <Link to={`/p/${projectId}/changes/${change.changeId}`}>{change.changeId}</Link> {change.intent} (
                {change.owner ?? 'no owner'})
              </li>
            ))}
          </ul>
        )}
      </section>
      {readme === undefined ? null : <Readme repoRef={ref} path={readme.path} />}
    </>
  );
}

type RefPathProps = {
  repoRef: string;
  path: string;
};

function Breadcrumbs({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const segments = path === '' ? [] : path.split('/');
  return (
    <p>
      <Link to={`/p/${projectId}/tree/${ref}`}>{ref}</Link>
      {segments.map((segment, index) => (
        <span key={segments.slice(0, index + 1).join('/')}>
          {' / '}
          <Link to={`/p/${projectId}/tree/${ref}/${segments.slice(0, index + 1).join('/')}`}>{segment}</Link>
        </span>
      ))}
    </p>
  );
}

function Readme({ repoRef: ref, path }: RefPathProps): React.JSX.Element {
  const { projectId } = useProject();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  return (
    <section>
      <h3>{path}</h3>
      <pre>{blob.data?.text ?? ''}</pre>
    </section>
  );
}

import { useQuery } from '@tanstack/react-query';
import { listChanges } from '@commute/api-client';
import { Link, Outlet, useMatch, useParams } from 'react-router';

import { MarkIcon } from './icons';
import { useEvents } from './use-events';
import { usePersonName } from './person-name';
import { ProjectContext } from './project-context';

// The header of a repository page on a familiar Git host: the project path, then the Code and Changes tabs.
export function ProjectLayout(): React.JSX.Element {
  const { projectId = '' } = useParams();
  const [personName, setPersonName] = usePersonName();
  const events = useEvents({ projectId });
  const changes = useQuery({
    queryKey: [projectId, 'changes'],
    queryFn: async () => (await listChanges({ path: { projectId }, throwOnError: true })).data
  });
  const inFlight = (changes.data ?? []).filter((change) => change.state !== 'landed').length;
  // Change pages and overlap pages belong to the Changes tab; every other page is Code.
  const changesMatch = useMatch('/p/:projectId/changes/*');
  const overlapsMatch = useMatch('/p/:projectId/overlaps/*');
  const isChangesTab = changesMatch !== null || overlapsMatch !== null;
  return (
    <ProjectContext value={{ projectId, personName, events }}>
      <header className="topbar">
        <span className="mark">
          <MarkIcon />
        </span>
        <span className="path">
          <Link to="/">Commute</Link> / <strong>{projectId}</strong>
        </span>
        <label className="person">
          Your name{' '}
          <input value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="alice" />
        </label>
      </header>
      <nav className="tabs">
        <Link to={`/p/${projectId}`} className={isChangesTab ? '' : 'active'}>
          Code
        </Link>
        <Link to={`/p/${projectId}/changes`} className={isChangesTab ? 'active' : ''}>
          Changes <span className="counter">{inFlight}</span>
        </Link>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </ProjectContext>
  );
}

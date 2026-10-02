import { Link, NavLink, Outlet, useParams } from 'react-router';

import { useEvents } from './use-events';
import { usePersonName } from './person-name';
import { ProjectContext } from './project-context';

export function ProjectLayout(): React.JSX.Element {
  const { projectId = '' } = useParams();
  const [personName, setPersonName] = usePersonName();
  const events = useEvents(`/api/projects/${projectId}/events`, projectId);
  return (
    <ProjectContext value={{ projectId, personName, events }}>
      <header>
        <p>
          <Link to="/">Commute</Link> / <strong>{projectId}</strong>
        </p>
        <nav>
          <NavLink to={`/p/${projectId}`} end>
            Code
          </NavLink>{' '}
          | <NavLink to={`/p/${projectId}/changes`}>Changes</NavLink>
        </nav>
        <p>
          <label>
            Your name{' '}
            <input value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="alice" />
          </label>
        </p>
      </header>
      <hr />
      <main>
        <Outlet />
      </main>
    </ProjectContext>
  );
}

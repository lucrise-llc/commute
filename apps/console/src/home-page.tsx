import { useState } from 'react';
import { useNavigate } from 'react-router';

export function HomePage(): React.JSX.Element {
  const [projectId, setProjectId] = useState('');
  const navigate = useNavigate();
  const open = async (): Promise<void> => {
    await navigate(`/p/${projectId.trim()}`);
  };
  return (
    <main>
      <h1>Commute</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          open().catch(reportError);
        }}
      >
        <label>
          Project <input value={projectId} onChange={(event) => setProjectId(event.target.value)} required />
        </label>{' '}
        <button type="submit">Open</button>
      </form>
    </main>
  );
}

import { useState } from 'react';
import { approveBatch, getLanding } from '@commute/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useProject } from './project-context';

// The ready batch and its approval. Any team member approves with the name they typed.
export function ApproveBatch(): React.JSX.Element {
  const { projectId, personName } = useProject();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const landing = useQuery({
    queryKey: [projectId, 'landing'],
    queryFn: async () => (await getLanding({ path: { projectId }, throwOnError: true })).data
  });
  if (landing.data === undefined) {
    return <p>Loading the batch…</p>;
  }
  const { ready, batch } = landing.data;
  const approver = personName.trim();
  const approve = async (): Promise<void> => {
    setError(null);
    const result = await approveBatch({
      path: { projectId },
      body: { changeIds: ready.map((change) => change.changeId), approver }
    });
    if (result.error !== undefined) {
      setError(result.error.error);
    }
    await queryClient.invalidateQueries({ queryKey: [projectId] });
  };
  return (
    <section>
      <h3>Landing batch</h3>
      {batch === null ? null : (
        <p>
          Landing {batch.batchId}: {batch.changeIds.join(', ')}, approved by {batch.approver}.
        </p>
      )}
      {ready.length === 0 ? (
        <p>No change is ready.</p>
      ) : (
        <ul>
          {ready.map((change) => (
            <li key={change.changeId}>
              {change.changeId} "{change.intent}" ({change.owner ?? 'no owner'})
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={ready.length === 0 || batch !== null || approver === ''}
        onClick={() => {
          approve().catch(reportError);
        }}
      >
        Approve {ready.length} as {approver === '' ? '(type your name)' : approver}
      </button>
      {error === null ? null : <p>Approval failed: {error}</p>}
    </section>
  );
}

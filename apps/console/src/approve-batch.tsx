import { useState } from 'react';
import { approveBatch, getLanding } from '@commute/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useProject } from './project-context';

// The ready batch and its approval. Every ready change is in the batch until a person unchecks it. Any team member
// approves with the name they typed.
export function ApproveBatch(): React.JSX.Element {
  const { projectId, personName } = useProject();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set());
  const landing = useQuery({
    queryKey: [projectId, 'landing'],
    queryFn: async () => (await getLanding({ path: { projectId }, throwOnError: true })).data
  });
  if (landing.data === undefined) {
    return <p>Loading the batch…</p>;
  }
  const { ready, batch } = landing.data;
  const approver = personName.trim();
  const chosen = ready.filter((change) => !leftOut.has(change.changeId));
  const toggle = (changeId: string): void => {
    const next = new Set(leftOut);
    if (next.has(changeId)) {
      next.delete(changeId);
    } else {
      next.add(changeId);
    }
    setLeftOut(next);
  };
  const approve = async (): Promise<void> => {
    setError(null);
    const result = await approveBatch({
      path: { projectId },
      body: { changeIds: chosen.map((change) => change.changeId), approver }
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
              <label>
                <input
                  type="checkbox"
                  checked={!leftOut.has(change.changeId)}
                  onChange={() => toggle(change.changeId)}
                  data-change-id={change.changeId}
                />{' '}
                {change.changeId} "{change.intent}" ({change.owner ?? 'no owner'})
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={chosen.length === 0 || batch !== null || approver === ''}
        onClick={() => {
          approve().catch(reportError);
        }}
      >
        Approve {chosen.length} as {approver === '' ? '(type your name)' : approver}
      </button>
      {error === null ? null : <p>Approval failed: {error}</p>}
    </section>
  );
}

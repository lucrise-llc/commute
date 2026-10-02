import { useState } from 'react';
import { approveBatch, getLanding } from '@commute/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ownerName } from './describe';
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
    return <div className="box box-body meta">Loading the batch…</div>;
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
    <div className="box">
      <div className="box-header">
        <strong>Landing batch</strong>
      </div>
      {batch === null ? null : (
        <div className="box-body meta">
          Landing {batch.batchId} ({batch.changeIds.join(', ')}), approved by {batch.approver}.
        </div>
      )}
      {ready.length === 0 && batch === null ? <div className="box-body meta">No change is ready.</div> : null}
      {ready.map((change) => (
        <label className="box-row" key={change.changeId}>
          <input
            type="checkbox"
            checked={!leftOut.has(change.changeId)}
            onChange={() => toggle(change.changeId)}
            data-change-id={change.changeId}
          />
          <span className="grow">
            {change.intent}
            <div className="meta">
              {change.changeId} by {ownerName(change.owner)}
            </div>
          </span>
        </label>
      ))}
      <div className="box-body">
        <button
          type="button"
          className="button-primary"
          disabled={chosen.length === 0 || batch !== null || approver === ''}
          onClick={() => {
            approve().catch(reportError);
          }}
        >
          Approve {chosen.length} as {approver === '' ? '(type your name)' : approver}
        </button>
        {error === null ? null : <div className="meta icon-fail">Approval failed: {error}</div>}
      </div>
    </div>
  );
}

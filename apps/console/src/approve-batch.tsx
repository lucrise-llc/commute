import { useState } from 'react';
import { approveBatch, getLanding } from '@commute/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Checkbox, Text } from '@cloudflare/kumo';

import { Box, BoxRow } from './box';
import { Loading } from './loading';
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
    return (
      <Box header="Landing batch">
        <BoxRow>
          <Loading text="Loading the batch…" />
        </BoxRow>
      </Box>
    );
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
    <Box header="Landing batch">
      {batch === null ? null : (
        <BoxRow>
          <Text variant="secondary" size="sm">
            Landing {batch.batchId} ({batch.changeIds.join(', ')}), approved by {batch.approver}.
          </Text>
        </BoxRow>
      )}
      {ready.length === 0 && batch === null ? (
        <BoxRow>
          <Text variant="secondary" size="sm">
            No change is ready.
          </Text>
        </BoxRow>
      ) : null}
      {ready.map((change) => (
        <BoxRow key={change.changeId}>
          <Checkbox
            checked={!leftOut.has(change.changeId)}
            onCheckedChange={() => toggle(change.changeId)}
            data-change-id={change.changeId}
            label={
              <span className="flex flex-col font-normal">
                <span>{change.intent}</span>
                <Text variant="secondary" size="xs" as="span">
                  {change.changeId} by {ownerName(change.owner)}
                </Text>
              </span>
            }
          />
        </BoxRow>
      ))}
      <div className="flex flex-col gap-2 px-4 py-3">
        <Button
          variant="primary"
          className="self-start"
          disabled={chosen.length === 0 || batch !== null || approver === ''}
          onClick={() => {
            approve().catch(reportError);
          }}
        >
          Approve {chosen.length} as {approver === '' ? '(type your name)' : approver}
        </Button>
        {error === null ? null : (
          <Banner variant="error" size="sm">
            Approval failed: {error}
          </Banner>
        )}
      </div>
    </Box>
  );
}

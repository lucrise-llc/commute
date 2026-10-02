import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input, Text } from '@cloudflare/kumo';

export function HomePage(): React.JSX.Element {
  const [projectId, setProjectId] = useState('');
  const navigate = useNavigate();
  const open = async (): Promise<void> => {
    await navigate(`/p/${projectId.trim()}`);
  };
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <Text variant="heading" size="lg" as="h1">
        Commute
      </Text>
      <Text variant="secondary">Open a project to see its code, its changes in flight, and its landing batches.</Text>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          open().catch(reportError);
        }}
      >
        <Input label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)} required />
        <Button type="submit" variant="primary">
          Open
        </Button>
      </form>
    </main>
  );
}

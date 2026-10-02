import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listChanges } from '@commute/api-client';
import { Outlet, useMatch, useParams } from 'react-router';
import { Badge, Input, Label, Link, Tabs } from '@cloudflare/kumo';
import { CodeIcon, GitPullRequestIcon } from '@phosphor-icons/react';

import { useEvents } from './use-events';
import { RouterLink } from './router-link';
import { usePersonName } from './person-name';
import { ICON_CLASS, MarkIcon } from './icons';
import { ProjectContext } from './project-context';

// The visible label and the input's own name. Kumo's Input asks for a name on the input itself.
const PERSON_LABEL = 'Your name';

// The header of a repository page on a familiar Git host: the project path, then the Code and Changes tabs.
export function ProjectLayout(): React.JSX.Element {
  const { projectId = '' } = useParams();
  const nameInputId = useId();
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
      <header className="border-b border-kumo-hairline bg-kumo-elevated">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-6 pt-4">
          <span className="grid size-7 place-items-center rounded-lg bg-kumo-brand text-white">
            <MarkIcon />
          </span>
          <span className="text-lg">
            <Link variant="plain" href="/">
              Commute
            </Link>
            <span className="px-1 text-kumo-subtle">/</span>
            <strong className="font-semibold">{projectId}</strong>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor={nameInputId} className="font-normal text-kumo-subtle">
              {PERSON_LABEL}
            </Label>
            <Input
              id={nameInputId}
              aria-label={PERSON_LABEL}
              size="sm"
              className="w-44"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              placeholder="alice"
            />
          </div>
        </div>
        <Tabs
          variant="underline"
          value={isChangesTab ? 'changes' : 'code'}
          className="mx-auto max-w-[1280px] px-4"
          listClassName="h-auto border-b-0 pb-0"
          tabs={[
            {
              value: 'code',
              label: (
                <span className="flex items-center gap-2">
                  <CodeIcon className={ICON_CLASS} />
                  Code
                </span>
              ),
              render: <RouterLink href={`/p/${projectId}`} />,
              nativeButton: false
            },
            {
              value: 'changes',
              label: (
                <span className="flex items-center gap-2">
                  <GitPullRequestIcon className={ICON_CLASS} />
                  Changes
                  <Badge variant="secondary">{inFlight}</Badge>
                </span>
              ),
              render: <RouterLink href={`/p/${projectId}/changes`} />,
              nativeButton: false
            }
          ]}
        />
      </header>
      <main className="mx-auto max-w-[1280px] p-6">
        <Outlet />
      </main>
    </ProjectContext>
  );
}

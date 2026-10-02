import { useParams } from 'react-router';
import { getBlob } from '@commute/api-client';
import { useQuery } from '@tanstack/react-query';
import { FileIcon } from '@phosphor-icons/react';
import { Banner, cn, Text } from '@cloudflare/kumo';

import { Box } from './box';
import { ICON_CLASS } from './icons';
import { PathBreadcrumbs } from './code-page';
import { useProject } from './project-context';
import { CodeLines, LineNumber } from './diff-view';

export function FilePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk', '*': path = '' } = useParams();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <PathBreadcrumbs repoRef={ref} path={path} />
        <Text variant="secondary" size="sm">
          on {ref}
        </Text>
      </div>
      {blob.error === null ? null : <Banner variant="alert">This file is not on {ref}.</Banner>}
      {blob.data === undefined ? null : (
        <Box
          header={
            <span className="flex grow items-center gap-2">
              <FileIcon className={cn(ICON_CLASS, 'text-kumo-subtle')} />
              <span className="grow font-mono text-sm">{path}</span>
              <span className="text-xs font-normal text-kumo-subtle">{blob.data.size} bytes</span>
            </span>
          }
        >
          {blob.data.text === null ? (
            <p className="px-4 py-3 text-sm text-kumo-subtle">Binary or large file.</p>
          ) : (
            <CodeLines>
              {blob.data.text
                .replace(/\n$/, '')
                .split('\n')
                .map((line, index) => (
                  <tr key={index}>
                    <LineNumber value={index + 1} />
                    <td className="px-2.5 align-top whitespace-pre-wrap">{line}</td>
                  </tr>
                ))}
            </CodeLines>
          )}
        </Box>
      )}
    </div>
  );
}

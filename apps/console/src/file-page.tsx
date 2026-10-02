import { getBlob } from '@commute/api-client';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { useProject } from './project-context';

export function FilePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk', '*': path = '' } = useParams();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  const folder = path.split('/').slice(0, -1).join('/');
  return (
    <>
      <p>
        <Link to={`/p/${projectId}/tree/${ref}/${folder}`}>
          {ref}/{folder}
        </Link>{' '}
        / <strong>{path.split('/').at(-1)}</strong>
      </p>
      {blob.error === null ? null : <p>Not found: {blob.error.message}</p>}
      {blob.data === undefined ? null : (
        <>
          <p>{blob.data.size} bytes</p>
          {blob.data.text === null ? <p>Binary or large file.</p> : <pre>{blob.data.text}</pre>}
        </>
      )}
    </>
  );
}

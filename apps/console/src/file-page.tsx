import { getBlob } from '@commute/api-client';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { FileIcon } from './icons';
import { useProject } from './project-context';

export function FilePage(): React.JSX.Element {
  const { projectId } = useProject();
  const { ref = 'trunk', '*': path = '' } = useParams();
  const blob = useQuery({
    queryKey: [projectId, 'blob', ref, path],
    queryFn: async () => (await getBlob({ path: { projectId, ref }, query: { path }, throwOnError: true })).data
  });
  const segments = path.split('/');
  return (
    <>
      <div className="toolbar">
        <span>
          <Link to={`/p/${projectId}/tree/${ref}`}>
            <strong>{projectId}</strong>
          </Link>
          {segments.slice(0, -1).map((segment, index) => (
            <span key={segments.slice(0, index + 1).join('/')}>
              {' / '}
              <Link to={`/p/${projectId}/tree/${ref}/${segments.slice(0, index + 1).join('/')}`}>{segment}</Link>
            </span>
          ))}
          {' / '}
          <strong>{segments.at(-1)}</strong>
        </span>
        <span className="meta">on {ref}</span>
      </div>
      {blob.error === null ? null : <div className="notice">This file is not on {ref}.</div>}
      {blob.data === undefined ? null : (
        <div className="box">
          <div className="box-header">
            <FileIcon className="icon-muted" />
            <span className="grow mono">{path}</span>
            <span className="meta">{blob.data.size} bytes</span>
          </div>
          {blob.data.text === null ? (
            <div className="box-body meta">Binary or large file.</div>
          ) : (
            <div className="code-lines mono">
              <table>
                <tbody>
                  {blob.data.text
                    .replace(/\n$/, '')
                    .split('\n')
                    .map((line, index) => (
                      <tr key={index}>
                        <td className="number">{index + 1}</td>
                        <td>{line}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

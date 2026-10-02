import { createBrowserRouter } from 'react-router';

import { HomePage } from './home-page';
import { CodePage } from './code-page';
import { FilePage } from './file-page';
import { ChangePage } from './change-page';
import { ChangesPage } from './changes-page';
import { CommitsPage } from './commits-page';
import { OverlapPage } from './overlap-page';
import { ProjectLayout } from './project-layout';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  {
    path: '/p/:projectId',
    element: <ProjectLayout />,
    children: [
      { index: true, element: <CodePage /> },
      { path: 'tree/:ref/*', element: <CodePage /> },
      { path: 'blob/:ref/*', element: <FilePage /> },
      { path: 'commits/:ref', element: <CommitsPage /> },
      { path: 'changes', element: <ChangesPage /> },
      { path: 'changes/:changeId', element: <ChangePage /> },
      { path: 'overlaps/:changeId/:otherChangeId', element: <OverlapPage /> }
    ]
  }
]);

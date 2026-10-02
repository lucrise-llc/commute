import type { ChangeEvent } from '@commute/api-client';

import { createContext, use } from 'react';

export type ProjectContextValue = {
  projectId: string;
  personName: string;
  events: ChangeEvent[];
};

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = use(ProjectContext);
  if (value === null) {
    throw new Error('useProject runs inside ProjectLayout.');
  }
  return value;
}

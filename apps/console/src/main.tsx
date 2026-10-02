import { StrictMode } from 'react';
import { RouterProvider } from 'react-router';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { router } from './router';
import './styles.css';

// Data changes only when the coordinator sends an event, and each event invalidates the project's queries. No page
// polls.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      retry: false
    }
  }
});

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('ROOT_ELEMENT_MISSING');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);

import { StrictMode } from 'react';
import { RouterProvider } from 'react-router';
import { createRoot } from 'react-dom/client';
import { LinkProvider } from '@cloudflare/kumo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { router } from './router';
import { RouterLink } from './router-link';
import { followSystemColorMode } from './color-mode';
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

followSystemColorMode();

// Kumo popups render into the body. The isolated root keeps them above the console's own stacking contexts.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LinkProvider component={RouterLink}>
        <div className="isolate min-h-screen text-base">
          <RouterProvider router={router} />
        </div>
      </LinkProvider>
    </QueryClientProvider>
  </StrictMode>
);

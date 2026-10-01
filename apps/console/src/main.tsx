import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('ROOT_ELEMENT_MISSING');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

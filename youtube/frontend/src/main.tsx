import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/**
 * Application entry point.
 * Mounts the React application to the DOM with StrictMode enabled
 * for highlighting potential problems in development.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

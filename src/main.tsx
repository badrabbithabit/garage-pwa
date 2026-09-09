import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// register service worker (manual public/sw.js)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/garage-pwa/sw.js').catch(() => {
      /* dev server or non-Pages host — fine */
    });
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing');
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

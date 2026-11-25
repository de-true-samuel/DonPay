import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import App from './App';
import { registerServiceWorker } from './pwa/register';
import './pwa/usePwa'; // captures the install prompt as early as possible
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/pages.css';
import './styles/phase2.css';
import './styles/phase3.css';
import './styles/phase4.css';
import './styles/phase5.css';
import './styles/dashboard.css';
import './styles/shell.css';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './pwa/register';
import './pwa/usePwa'; // captures the install prompt as early as possible
import { initTheme } from './theme/theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/pages.css';
import './styles/phase2.css';
import './styles/phase3.css';
import './styles/phase4.css';
import './styles/dark.css';
import './styles/phase5.css';

initTheme();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

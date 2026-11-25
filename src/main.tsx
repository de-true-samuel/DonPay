import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
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
import './styles/phase5.css';
import './styles/dashboard.css';
import './styles/shell.css';

initTheme();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

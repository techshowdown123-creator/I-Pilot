import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { PilotProvider } from './context/PilotContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PilotProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </PilotProvider>
  </StrictMode>,
);

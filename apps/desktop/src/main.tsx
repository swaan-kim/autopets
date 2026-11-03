import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/style.css';
import './features/tasks/TaskList.css';
import './app/manager.css';
import './features/pets/workspace.css';
import './app/readable-type.css';

const Feedback = import.meta.env.DEV && import.meta.env.VITE_AGENTATION === '1'
  ? React.lazy(() => import('./development/Feedback')) : null;
const browserPreview = !('__TAURI_INTERNALS__' in window) && !new URLSearchParams(location.search).has('pet');
createRoot(document.getElementById('root')!).render(<React.StrictMode><App />{Feedback && browserPreview && <React.Suspense fallback={null}><Feedback /></React.Suspense>}</React.StrictMode>);

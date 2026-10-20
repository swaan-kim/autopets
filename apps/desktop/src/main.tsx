import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/style.css';
import './features/tasks/TaskList.css';
import './app/manager.css';
import './features/pets/workspace.css';
import './app/readable-type.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/roboto-flex/wdth.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/martian-mono';
import './styles/global.css';
import './components/components.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

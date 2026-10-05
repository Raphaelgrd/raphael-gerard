import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/great-vibes/latin-400.css';
import '@fontsource/dancing-script/latin-600.css';
import '@fontsource/caveat/latin-600.css';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

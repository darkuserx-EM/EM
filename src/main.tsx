import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './design/tokens.css';
import './styles.css';
import App from './app/App';
import { AuthGate } from './app/AuthGate';

createRoot(document.getElementById('root')!).render(<StrictMode><AuthGate><App /></AuthGate></StrictMode>);

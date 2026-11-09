import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadConfig } from './server/config';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'pages' ? '/gravy-train/' : '/',
  define: { __SAMPLE_CONFIG__: JSON.stringify(mode === 'pages' ? loadConfig() : null) },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } },
}));

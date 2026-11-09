import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server proxies /api to the backend so the browser sees one origin during
 * development. Deployed origin handling is an open decision (docs/PRD.md
 * section 9), so nothing here assumes a hosting setup.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['minute-positioning-relax-hurricane.trycloudflare.com'],
    proxy: {
      '/api': {
        target: process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

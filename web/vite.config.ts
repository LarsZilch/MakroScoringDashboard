import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: resolve(here, '..', 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5177,
    // Der lokale Server ist der Proxy zu FRED, Yahoo, CNN und AAII —
    // diese Quellen senden keine CORS-Header.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 5178}`,
        changeOrigin: true,
      },
    },
  },
});

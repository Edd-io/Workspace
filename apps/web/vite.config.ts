import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = `http://127.0.0.1:${process.env.WORKSPACE_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    proxy: {
      '/api': serverUrl,
      '/ws': { target: serverUrl, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});

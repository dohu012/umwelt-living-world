import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.UMWELT_BACKEND || 'http://localhost:4001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind all interfaces (0.0.0.0) so other devices on the LAN can reach the dev server
    proxy: {
      '/api': backend,
      '/media': backend,
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
});

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../shared/types') }},
  server: { proxy: { '/api': 'http://localhost:3000' } },
});

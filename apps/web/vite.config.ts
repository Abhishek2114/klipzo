import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Tauri serves the built files from disk, so asset URLs must be relative.
  base: './',
  server: { port: 5173, strictPort: true },
});

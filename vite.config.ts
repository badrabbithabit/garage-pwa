import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages under /garage-pwa/ — base must match the repo name.
export default defineConfig({
  base: '/garage-pwa/',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets' },
});

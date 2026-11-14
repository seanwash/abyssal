import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});

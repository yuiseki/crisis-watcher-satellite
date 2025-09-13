import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/crisis-watcher-satellite/',
  resolve: {
    alias: {
      child_process: path.resolve(__dirname, 'src/shims/child_process.ts')
    }
  }
});

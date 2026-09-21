import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // epub.js / jszip 里用到 Node 风格的 global，浏览器端用 globalThis 顶上。
  define: { global: 'globalThis' },
  server: { port: 5173 },
});

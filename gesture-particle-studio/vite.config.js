import { defineConfig } from 'vite';

// 默认仅允许 localhost；需要反向代理访问时设置 VITE_ALLOWED_HOSTS=.example.com,host2
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean);

export default defineConfig({
  base: './',
  server: { allowedHosts },
  preview: { allowedHosts },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});

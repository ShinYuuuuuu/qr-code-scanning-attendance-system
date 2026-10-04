import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'School Event Attendance',
        short_name: 'Attendance',
        start_url: '/',
        display: 'standalone',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        icons: [],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});

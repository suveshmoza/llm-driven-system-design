import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['whatsapp.svg'],
      manifest: {
        name: 'WhatsApp Clone',
        short_name: 'WhatsApp',
        description: 'Real-time messaging application',
        theme_color: '#075e54',
        background_color: '#111b21',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/whatsapp-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/whatsapp-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/whatsapp-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['host.docker.internal'],
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});

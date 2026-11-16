import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  const appMode = process.env.VITE_APP_MODE || 'hub';

  const modeMeta: Record<
    string,
    {
      id: string;
      name: string;
      shortName: string;
      base: string;
      outDir: string;
      startUrl: string;
      scope: string;
      themeColor: string;
    }
  > = {
    customer: {
      id: '/customer/',
      name: 'وصلها للزبائن - WASELHA CUSTOMER',
      shortName: 'وصلها زبون',
      base: '/customer/',
      outDir: 'dist-customer',
      startUrl: '/customer/',
      scope: '/customer/',
      themeColor: '#0284C7',
    },
    driver: {
      id: '/driver/',
      name: 'وصلها للمندوبين - WASELHA DRIVER',
      shortName: 'وصلها مندوب',
      base: '/driver/',
      outDir: 'dist-driver',
      startUrl: '/driver/',
      scope: '/driver/',
      themeColor: '#0369A1',
    },
    manager: {
      id: '/manager/',
      name: 'وصلها للإدارة - WASELHA MANAGER',
      shortName: 'وصلها إدارة',
      base: '/manager/',
      outDir: 'dist-manager',
      startUrl: '/manager/',
      scope: '/manager/',
      themeColor: '#0F172A',
    },
    hub: {
      id: '/',
      name: 'وصلها - WASELHA',
      shortName: 'وصلها',
      base: '/',
      outDir: 'dist',
      startUrl: '/',
      scope: '/',
      themeColor: '#0284C7',
    },
  };

  const activeMeta = modeMeta[appMode] || modeMeta.hub;
  const base = process.env.VITE_BASE_PATH || activeMeta.base;
  const outDir = process.env.VITE_OUT_DIR || activeMeta.outDir;

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'manifest-customer.json',
          'manifest-driver.json',
          'manifest-manager.json',
        ],
        manifest: {
          id: activeMeta.id,
          name: activeMeta.name,
          short_name: activeMeta.shortName,
          description: 'منصة وصلها للتوصيل الحر السريع في العراق - توصيل الأغراض والطرود للمحلات والأفراد والمندوبين',
          theme_color: activeMeta.themeColor,
          background_color: '#FFFFFF',
          display: 'standalone',
          orientation: 'portrait',
          dir: 'rtl',
          lang: 'ar',
          start_url: activeMeta.startUrl,
          scope: activeMeta.scope,
          icons: [
            {
              src: `${base}pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-maskable-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/downloads\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    build: {
      outDir,
      assetsDir: 'assets',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: false as const,
      ws: false as const,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";

// PACKAGE_VERSION feeds the OTA auto-update flow (useAutoUpdate compares it to the
// server-recorded kioskDeviceVersion). Bumped via check-version.mjs — do not remove.
const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      workbox: {
        // jpg/jpeg: the splash WELCOME photo and textures must be precached so
        // an offline boot still shows them. No image optimizer (CLAUDE.md rule 7).
        globPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,svg,woff2}"],
        cleanupOutdatedCaches: true,
        // Safe ONLY because the app defers the actual reload to the splash screen
        // (PWAUpdateHandler dispatches setAutoUpdateOnNextStartOver; StartScreen reloads).
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            // Splash media + item images live on S3 (cross-origin). Workbox
            // RegExp routes match a cross-origin URL only at index 0, so the
            // old extension regex never cached them; match by destination.
            // StaleWhileRevalidate keeps opaque (status 0) <img> answers and
            // heals a cached error on the next load (CacheFirst would pin an
            // opaque 404 until it expired). Videos (destination "video") stay
            // in the HTTP cache: range requests (206) are not cacheable here.
            // Serialized into sw.js — keep the matcher self-contained.
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                // Chrome pads every opaque entry by MBs of quota.
                purgeOnQuotaError: true,
              },
            },
          },
          {
            urlPattern: /\.(?:js|css)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "static-resources",
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\.(?:json)$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "json-data",
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
      // NOTE (P2): when the manifest icon PNG lands, and if an image-optimizer plugin is
      // added, the icon MUST be excluded from optimization — otherwise the precache
      // manifest hash mismatches and Workbox aborts before attaching any listener,
      // silently disabling the entire service worker (the corbi.png trap in posistKiosk).
      manifest: {
        name: "Taco Bell Kiosk",
        short_name: "TB Kiosk",
        description: "Taco Bell self-service kiosk",
        display: "standalone",
        start_url: "/",
        background_color: "#3d1078",
        theme_color: "#3d1078",
        icons: [],
      },
    }),
  ],
  resolve: {
    // One copy of each singleton library. Load-bearing across repos: the linked
    // @cx-sdk packages resolve from ../posistKiosk-cx-sdk, and without dedupe they
    // would pull a SECOND react/redux copy from that repo's node_modules — breaking
    // hooks and the react-redux context.
    dedupe: [
      "react",
      "react-dom",
      "react-redux",
      "@reduxjs/toolkit",
      "redux-persist",
    ],
  },
  server: {
    fs: {
      // Allow serving the linked @cx-sdk TypeScript source from the sibling repo.
      allow: [".", "../posistKiosk-cx-sdk"],
    },
  },
  define: {
    "process.env.PACKAGE_VERSION": JSON.stringify(packageJson.version),
  },
  build: {
    target: "esnext", // kiosks run a known modern Chromium
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
});

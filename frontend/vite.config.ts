/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The back-end only accepts its own Host and Origin (blocks DNS rebinding and cross-site
// requests), so the dev server presents itself as the back-end when proxying.
const backend = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: backend, changeOrigin: true, headers: { origin: backend } },
      "/ws": { target: backend, changeOrigin: true, ws: true, headers: { origin: backend } },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});

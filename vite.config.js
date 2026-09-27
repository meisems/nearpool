import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
    // The shared activity feed lives in server.mjs. Run `npm run build && npm start`
    // alongside `npm run dev` and point this at it to exercise the feed locally.
    proxy: process.env.NEARPOOL_API_ORIGIN
      ? { "/api": { target: process.env.NEARPOOL_API_ORIGIN, changeOrigin: true } }
      : undefined,
  },
});

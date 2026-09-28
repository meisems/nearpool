import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Build settings live in wrangler.toml's [vars] next to the Worker's runtime
 * vars. Vite only sees process.env, so copy the VITE_* entries across. A value
 * already set in the environment (shell, Workers Builds variables) wins.
 */
function loadWranglerViteVars() {
  let toml;
  try {
    toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  } catch {
    return;
  }
  let inVars = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inVars = line === "[vars]";
      continue;
    }
    const match = inVars && line.match(/^(VITE_[A-Z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = JSON.parse(`"${match[2]}"`);
  }
}
loadWranglerViteVars();

/**
 * Build id, compiled into the app and written to dist/version.json. An open
 * tab compares the two to notice that a newer version has been deployed.
 */
const BUILD_ID = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || `${Date.now()}`;

function versionFile() {
  return {
    name: "nearpool-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), tailwindcss(), versionFile()],
  build: {
    rollupOptions: {
      output: {
        // A prior deployment could have served/cache-poisoned a missing chunk
        // with the SPA's HTML. Give every build fresh URLs, including vendor chunks.
        entryFileNames: `assets/${BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, "_")}/[name]-[hash].js`,
        chunkFileNames: `assets/${BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, "_")}/[name]-[hash].js`,
        assetFileNames: `assets/${BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, "_")}/[name]-[hash][extname]`,
      },
    },
  },
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

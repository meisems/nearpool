import "./polyfills";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installChunkRecovery } from "./lib/chunkRecovery";

// After a redeploy, an open tab may reference chunks that no longer exist.
// Vite reports that as vite:preloadError; reload once to pick up the new build.
installChunkRecovery();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Only register in production: in dev, Vite's own module graph/HMR and a
// service worker fighting over caching the same requests is a recipe for
// "why isn't my change showing up" confusion.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // updateViaCache "none": the browser always re-checks sw.js itself, so a new
    // deploy's worker is picked up on the next visit.
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}

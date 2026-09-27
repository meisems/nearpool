import "./polyfills";
import ReactDOM from "react-dom/client";
import "@near-wallet-selector/modal-ui/styles.css";
import "./index.css";
import App from "./App.tsx";

// After a redeploy, an open tab may reference chunks that no longer exist.
// Vite reports that as vite:preloadError; reload once to pick up the new build.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  try {
    const key = "nearpool.reloaded-for-chunk";
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked — still reload once */
  }
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Only register in production: in dev, Vite's own module graph/HMR and a
// service worker fighting over caching the same requests is a recipe for
// "why isn't my change showing up" confusion.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // updateViaCache "none": the browser always re-checks sw.js itself, so a new
    // deploy's worker is picked up on the next visit.
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((error) => {
      console.error("service worker registration failed", error);
    });
  });
}

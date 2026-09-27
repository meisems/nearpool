import "./polyfills";
import ReactDOM from "react-dom/client";
import "@near-wallet-selector/modal-ui/styles.css";
import "./index.css";
import App from "./App.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Only register in production: in dev, Vite's own module graph/HMR and a
// service worker fighting over caching the same requests is a recipe for
// "why isn't my change showing up" confusion.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("service worker registration failed", error);
    });
  });
}

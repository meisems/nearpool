/** Retry stale chunks once per build, without hiding import failures from callers. */
export function installChunkRecovery() {
  let reloading = false;
  window.addEventListener("vite:preloadError", () => {
    // preventDefault makes Vite resolve failed imports as undefined. Keep the
    // rejection so wallet initialization can show a retry if reloading fails.
    if (reloading) return;
    try {
      const key = "nearpool.reloaded-for-chunk";
      if (sessionStorage.getItem(key) === __BUILD_ID__) return;
      sessionStorage.setItem(key, __BUILD_ID__);
    } catch {
      // Without a persistent guard, automatic reloads could loop indefinitely.
      // The Connect button offers a manual retry instead.
      return;
    }
    reloading = true;
    window.location.reload();
  });
}

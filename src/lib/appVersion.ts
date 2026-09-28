/**
 * Notices when a newer build has been deployed while this tab stays open.
 * The app is a single page, so an open tab keeps running the old code until
 * a full load; App reloads on the next page change once this reports stale
 * (never mid-transaction, which would interrupt a wallet prompt).
 */
const CHECK_EVERY_MS = 5 * 60_000;
let stale = false;
let started = false;

async function check() {
  if (stale) return;
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (build && build !== __BUILD_ID__) stale = true;
  } catch {
    /* offline or not deployed with version.json: keep running */
  }
}

export function watchForNewVersion() {
  if (started || !import.meta.env.PROD) return;
  started = true;
  void check();
  window.setInterval(check, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}

export const newVersionAvailable = () => stale;

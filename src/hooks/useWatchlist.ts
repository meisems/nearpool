import { useCallback, useSyncExternalStore } from "react";

/**
 * Tokens the user tracks, stored per browser. `priceAtAdd` is the pool's
 * spot price when tracking started so the list can show change since then.
 */
export interface TrackedToken {
  tokenId: string;
  poolId: number;
  /** Spot price of the token in the pool's counter token when added. */
  priceAtAdd: number;
  addedAt: number;
}

const KEY = "nearpool.watchlist";
const EVENT = "nearpool:watchlist";
let cache: TrackedToken[] | null = null;

function read(): TrackedToken[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (t): t is TrackedToken =>
            !!t && typeof t.tokenId === "string" && typeof t.poolId === "number" && typeof t.priceAtAdd === "number",
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: TrackedToken[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the list lives for this session only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: TrackedToken[] = [];

export function useWatchlist() {
  const list = useSyncExternalStore(subscribe, read, () => EMPTY);

  const isTracked = useCallback((tokenId: string) => list.some((t) => t.tokenId === tokenId), [list]);

  const track = useCallback((entry: Omit<TrackedToken, "addedAt">) => {
    const current = read().filter((t) => t.tokenId !== entry.tokenId);
    write([{ ...entry, addedAt: Date.now() }, ...current]);
  }, []);

  const untrack = useCallback((tokenId: string) => {
    write(read().filter((t) => t.tokenId !== tokenId));
  }, []);

  /** Keep the tracked pool in sync when the user switches pools. */
  const setPool = useCallback((tokenId: string, poolId: number, price: number) => {
    const current = read();
    if (!current.some((t) => t.tokenId === tokenId && t.poolId !== poolId)) return;
    write(current.map((t) => (t.tokenId === tokenId ? { ...t, poolId, priceAtAdd: price, addedAt: Date.now() } : t)));
  }, []);

  return { list, isTracked, track, untrack, setPool };
}

import { createStore, del, get, set, type UseStore } from "idb-keyval";

/**
 * Browser cache (IndexedDB) for data worth keeping across reloads: the Ref
 * pool list and the React Query cache. Everything here is a speed-up only:
 * reads that fail (private mode, blocked storage) just behave like a miss.
 */

let store: UseStore | null = null;
function db(): UseStore | null {
  if (typeof indexedDB === "undefined") return null;
  try {
    store ??= createStore("nearpool", "cache");
    return store;
  } catch {
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const s = db();
  if (!s) return undefined;
  try {
    return await get<T>(key, s);
  } catch {
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const s = db();
  if (!s) return;
  try {
    await set(key, value, s);
  } catch {
    /* quota or blocked storage: skip caching */
  }
}

export async function cacheDel(key: string): Promise<void> {
  const s = db();
  if (!s) return;
  try {
    await del(key, s);
  } catch {
    /* ignore */
  }
}

/** JSON that round-trips bigint (balances, reserves, shares). */
export const stringifyWithBigInt = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));

export const parseWithBigInt = <T>(text: string): T =>
  JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v.$big === "string" && Object.keys(v).length === 1 ? BigInt(v.$big) : v)) as T;

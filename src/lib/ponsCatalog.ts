import { useEffect, useMemo, useState } from "react";
const PONS_CATALOG_PATH = "/pons-launches.json";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type RawLaunch = {
  factory?: unknown;
  version?: unknown;
  token?: unknown;
  name?: unknown;
  symbol?: unknown;
  logo?: unknown;
};

/** Pons v1 launches use the legacy V3 pool; Pons v2 launches use V4. */
export type PonsLaunchVersion = "V3" | "V4";
const PONS_V1_FACTORY = "0x0c37a24f5d23a486fa692d1500881d698b1f77a4";
const PONS_V2_FACTORY = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb";

export interface PonsLaunchToken {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  logo?: string;
  launchVersion?: PonsLaunchVersion;
}

function normalizeLogo(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${value.slice(7)}`;
  if (value.startsWith("ar://")) return `https://arweave.net/${value.slice(5)}`;
  return value;
}

function detectLaunchVersion(item: RawLaunch): PonsLaunchVersion | undefined {
  const explicit = typeof item.version === "string" ? item.version.toLowerCase() : "";
  if (explicit === "v1" || explicit === "1" || explicit.includes("v3")) return "V3";
  if (explicit === "v2" || explicit === "2" || explicit.includes("v4")) return "V4";

  const factory = typeof item.factory === "string" ? item.factory.toLowerCase() : "";
  if (factory === PONS_V1_FACTORY) return "V3";
  if (factory === PONS_V2_FACTORY) return "V4";
  return undefined;
}

function toTokens(payload: unknown): PonsLaunchToken[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  const seen = new Set<string>();
  const tokens: PonsLaunchToken[] = [];

  for (const item of items as RawLaunch[]) {
    const address = typeof item.token === "string" ? item.token : "";
    const launchVersion = detectLaunchVersion(item);
    const listedSymbol = typeof item.symbol === "string" ? item.symbol.trim() : "";
    // Keep version-known unnamed launches in the lookup table. They may not
    // be useful search results, but pasted v2/v1 addresses still need the
    // correct V4/V3 routing decision.
    if (!ADDRESS_RE.test(address) || (!listedSymbol && !launchVersion)) continue;
    const symbol = listedSymbol || "TOKEN";
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({
      address: address as `0x${string}`,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : symbol,
      symbol,
      decimals: 18,
      logo: normalizeLogo(item.logo),
      launchVersion,
    });
  }
  return tokens;
}

/** Search every token launched through Pons Family from the static catalog. */
export async function searchPonsLaunches(_query: string, signal?: AbortSignal): Promise<PonsLaunchToken[]> {
  const response = await fetch(PONS_CATALOG_PATH, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`Local Pons catalog failed (${response.status})`);
  return toTokens(await response.json());
}

// Shared across every usePonsLaunchToken() instance so the activity feed's
// many rows don't each re-fetch the same catalog file.
let catalogPromise: Promise<PonsLaunchToken[]> | null = null;
function loadPonsCatalogOnce(): Promise<PonsLaunchToken[]> {
  if (!catalogPromise) {
    catalogPromise = searchPonsLaunches("").catch((error) => {
      console.warn("Pons launch catalog unavailable.", error);
      catalogPromise = null;
      return [];
    });
  }
  return catalogPromise;
}

/**
 * Curated name/symbol/logo/version for a token address, sourced from the same
 * Pons Family launch catalog the token picker searches. Returns undefined for
 * tokens that weren't launched through Pons Family.
 */
export function usePonsLaunchToken(address: string | undefined): PonsLaunchToken | undefined {
  const [catalog, setCatalog] = useState<PonsLaunchToken[]>([]);
  useEffect(() => {
    let alive = true;
    loadPonsCatalogOnce().then((tokens) => {
      if (alive) setCatalog(tokens);
    });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    if (!address) return undefined;
    const key = address.toLowerCase();
    return catalog.find((token) => token.address.toLowerCase() === key);
  }, [catalog, address]);
}

/**
 * Returns true after the shared catalog lookup has settled. Consumers that
 * choose between protocol versions should wait for this before falling back to
 * live pool probing; otherwise a pasted Pons v1 address can briefly render as
 * the default v4 engine while the catalog is still loading.
 */
export function usePonsCatalogReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPonsCatalogOnce().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

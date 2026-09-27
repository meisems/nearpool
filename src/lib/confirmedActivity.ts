import type { ContractVersion, InjectionMode, LiquidityDestination } from "../hooks/useContractInjection";

const STORAGE_KEY = "ponspool.confirmed-injections";
const EVENT_NAME = "ponspool:confirmed-injection";

export interface ConfirmedInjection {
  hash: string;
  token: string;
  symbol: string;
  version: ContractVersion;
  mode: InjectionMode;
  ethIn: bigint;
  destination: LiquidityDestination;
  confirmedAt: number;
}

type StoredInjection = Omit<ConfirmedInjection, "ethIn"> & { ethIn: string };

function serialize(item: ConfirmedInjection): StoredInjection {
  return { ...item, ethIn: item.ethIn.toString() };
}
function deserialize(item: StoredInjection): ConfirmedInjection {
  return { ...item, ethIn: BigInt(item.ethIn) };
}

export function listConfirmedInjections(limit = 8): ConfirmedInjection[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredInjection[];
    return raw.slice(0, limit).map(deserialize);
  } catch {
    return [];
  }
}

export function publishConfirmedInjection(item: Omit<ConfirmedInjection, "confirmedAt">): void {
  const next = { ...item, confirmedAt: Date.now() };
  try {
    const rows = [next, ...listConfirmedInjections(20).filter((row) => row.hash !== item.hash)].slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.map(serialize)));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  } catch {
    /* Storage can be unavailable in privacy-restricted browsers. */
  }
}

export function subscribeConfirmedInjections(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  const onLocal = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT_NAME, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT_NAME, onLocal);
  };
}

/** Publish a receipt-confirmed injection to the shared homepage feed. */
export async function publishGlobalInjection(item: Omit<ConfirmedInjection, "confirmedAt">): Promise<void> {
  try {
    const body = JSON.stringify({ ...item, ethIn: item.ethIn.toString() });
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch("/api/activity/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`shared activity publish failed (${response.status})`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
    window.dispatchEvent(new CustomEvent("ponspool:confirmed-injection"));
  } catch (error) {
    // The on-chain transaction remains authoritative; a temporary server
    // outage must never make an already-confirmed wallet flow look failed.
    console.warn("Shared activity publish unavailable.", error);
  }
}

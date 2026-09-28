/**
 * Shared, cross-browser feed of confirmed liquidity additions and locks.
 *
 * The client only submits `{ hash, accountId }`. The server re-reads the
 * transaction from NEAR RPC, checks it's a successful addition or LP lock on Ref
 * Finance signed by that account, and derives every displayed field from
 * chain data — the client can't forge amounts or tokens.
 */

export interface ActivityPost {
  /** Older stored/cached posts without a kind are liquidity additions. */
  kind?: "injection" | "lock";
  hash: string;
  accountId: string;
  poolId: number;
  tokenIds: string[];
  symbols: string[];
  decimals: number[];
  /** Raw amounts added, pool token order; empty for LP locks. */
  amounts: string[];
  shares: string;
  blockHeight: number;
  /** Unix milliseconds of the including block. */
  timestamp: number;
}

function isActivityPost(value: unknown): value is ActivityPost {
  const v = value as Partial<ActivityPost> | null;
  return (
    !!v &&
    typeof v.hash === "string" &&
    typeof v.accountId === "string" &&
    typeof v.poolId === "number" &&
    Array.isArray(v.tokenIds) &&
    Array.isArray(v.symbols) &&
    Array.isArray(v.decimals) &&
    Array.isArray(v.amounts)
  );
}

export async function fetchActivity(signal?: AbortSignal): Promise<ActivityPost[]> {
  const response = await fetch("/api/activity/posts", { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`activity feed responded ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  // Static hosts without server.mjs answer with the SPA shell instead.
  if (!contentType.includes("json")) return [];
  const body = (await response.json()) as { posts?: unknown };
  return Array.isArray(body.posts) ? body.posts.filter(isActivityPost) : [];
}

/** Best-effort publish; a feed outage never turns a confirmed transaction into a failure. */
export async function publishActivity(hash: string, accountId: string): Promise<void> {
  const body = JSON.stringify({ hash, accountId });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/activity/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return;
      // 4xx means the server rejected the transaction itself — retrying won't help.
      if (response.status >= 400 && response.status < 500) return;
    } catch {
      /* network hiccup — retry */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000 * (attempt + 1)));
  }
}

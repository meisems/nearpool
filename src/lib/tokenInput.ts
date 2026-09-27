import { isValidAccountId } from "./near";

export type ParsedInput =
  | { kind: "token"; tokenId: string }
  | { kind: "pool"; poolId: number }
  | { kind: "invalid" }
  | { kind: "empty" };

/** Pick the NEP-141 account from a pasted URL (nearblocks, Ref, explorers). */
function accountFromUrl(url: URL): string | null {
  const candidates = [
    ...url.pathname.split("/").map(decodeURIComponent),
    ...["token", "tokenIn", "tokenOut", "address", "id"].map((key) => url.searchParams.get(key) ?? ""),
    // Ref swap links: https://app.ref.finance/#near|usdt.tether-token.near
    ...decodeURIComponent(url.hash.replace(/^#/, "")).split("|"),
  ].map((part) => part.trim().toLowerCase());
  // Prefer the last path segment that is a valid account (e.g. /token/usdt.tether-token.near).
  for (const part of candidates.reverse()) {
    if (part && isValidAccountId(part) && (part.includes(".") || /^[0-9a-f]{64}$/.test(part))) return part;
  }
  return null;
}

function poolFromUrl(url: URL): number | null {
  const match = /\/pool\/(\d{1,9})(?:\/|$)/.exec(url.pathname);
  return match ? Number(match[1]) : null;
}

/**
 * Accepts whatever a user is likely to paste: a token contract ID
 * (`token.near`, 64-hex implicit), a pool ID (`123` / `#123`), or a link
 * from nearblocks / Ref Finance containing either.
 */
export function parseTokenInput(raw: string): ParsedInput {
  const value = raw.trim().replace(/[\s​]+/g, "");
  if (!value) return { kind: "empty" };
  const pool = /^#?(\d{1,9})$/.exec(value);
  if (pool) return { kind: "pool", poolId: Number(pool[1]) };
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const poolId = poolFromUrl(url);
      if (poolId !== null) return { kind: "pool", poolId };
      const tokenId = accountFromUrl(url);
      return tokenId ? { kind: "token", tokenId } : { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
  }
  const lower = value.toLowerCase();
  return isValidAccountId(lower) ? { kind: "token", tokenId: lower } : { kind: "invalid" };
}

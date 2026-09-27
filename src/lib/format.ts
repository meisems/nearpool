/**
 * Fixed-point formatting helpers. All on-chain amounts are `bigint` in the
 * token's smallest unit (yoctoNEAR for NEAR, 10^-decimals for NEP-141), so
 * parsing and formatting never go through a float until the final display
 * string.
 */

const group = (n: number, dp: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 }).format(n);

/** Exact decimal string for a raw amount, e.g. formatUnits(1500000n, 6) === "1.5". */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  if (decimals === 0) return `${negative ? "-" : ""}${abs}`;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/**
 * Parse a user-typed decimal into raw units without floating point.
 * Returns null for malformed input or more fractional digits than the token
 * supports (rather than silently truncating the user's amount).
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!/^\d*\.?\d*$/.test(value) || value === "" || value === ".") return null;
  const [int = "", frac = ""] = value.split(".");
  if (frac.length > decimals) return null;
  const digits = `${int || "0"}${frac.padEnd(decimals, "0")}`;
  return BigInt(digits);
}

/** Human amount with adaptive precision. */
export function fmtAmount(raw: bigint, decimals: number): string {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.0001) return "<0.0001";
  if (Math.abs(n) >= 1_000_000) return group(n, 0);
  if (Math.abs(n) >= 1000) return group(n, 2);
  if (Math.abs(n) >= 1) return group(n, 4);
  return group(n, 6);
}

/** Compact magnitude for pool telemetry — 8.4B, 12.5K. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function toFloat(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/** Trim a raw amount into a clean input string (no trailing zeros). */
export function rawToInput(raw: bigint, decimals: number, maxDp = 6): string {
  const [int, frac = ""] = formatUnits(raw, decimals).split(".");
  const f = frac.slice(0, maxDp).replace(/0+$/, "");
  return f ? `${int}.${f}` : int;
}

/**
 * Display form of a NEAR account ID. Named accounts (`user.near`) are kept
 * whole when short; 64-char implicit accounts and long names are elided.
 */
export function shortAccount(accountId: string | null | undefined, max = 18): string {
  if (!accountId) return "—";
  if (accountId.length <= max) return accountId;
  if (/^[0-9a-f]{64}$/.test(accountId)) return `${accountId.slice(0, 4)}…${accountId.slice(-4)}`;
  const dot = accountId.lastIndexOf(".");
  if (dot > 0) {
    const suffix = accountId.slice(dot);
    const head = accountId.slice(0, Math.max(4, max - suffix.length - 5));
    return `${head}…${suffix}`;
  }
  return `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;
}

/** Short form of a base58 transaction hash. */
export function shortHash(hash: string | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

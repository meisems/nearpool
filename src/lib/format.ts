import { formatUnits } from "viem";

const group = (n: number, dp: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 }).format(n);

/** Human amount from token-wei with adaptive precision. */
export function fmtWei(wei: bigint, decimals: number): string {
  const n = Number(formatUnits(wei, decimals));
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
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

export function toWeiFloat(wei: bigint, decimals: number): number {
  return Number(formatUnits(wei, decimals));
}

/** Trim a wei value into a clean input string (no trailing zeros). */
export function weiToInput(wei: bigint, decimals: number, maxDp = 6): string {
  const raw = formatUnits(wei, decimals);
  const [int, frac = ""] = raw.split(".");
  const f = frac.slice(0, maxDp).replace(/0+$/, "");
  return f ? `${int}.${f}` : int;
}

export function shortAddr(a: string | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function pctOf(wei: bigint, pctBps: number): bigint {
  return (wei * BigInt(pctBps)) / 10_000n;
}

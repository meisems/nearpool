/**
 * Display metadata for the two protocol-native tokens (PONSPOOL and WETH),
 * plus a generic fallback label for any other real on-chain token address.
 *
 * This is display-only: it never stands in for a balance, allowance, or
 * pool read, and it makes no claim about a token's legitimacy.
 */
import { PLATFORM_TOKEN_ADDRESS, WETH_ADDRESS } from "./constants";

export const UNCURATED_ASSET_NAME = "Uncurated Asset";

interface TokenDisplayMeta {
  symbol: string;
  name: string;
  decimals: number;
}

export interface RegistryTokenSummary {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

const KNOWN: Record<string, TokenDisplayMeta> = {
  [PLATFORM_TOKEN_ADDRESS.toLowerCase()]: { symbol: "PONSPOOL", name: "PonsPool", decimals: 18 },
  [WETH_ADDRESS.toLowerCase()]: { symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
};

/**
 * Best-effort display name/symbol/decimals for a token address, used only
 * while a live on-chain read (see useTokenMeta) hasn't resolved yet or
 * isn't available. Anything outside the two protocol-native tokens falls
 * back to a generic placeholder rather than a fabricated name.
 */
export function tokenInfo(address: string): TokenDisplayMeta | null {
  const addrLower = address.toLowerCase();
  const known = KNOWN[addrLower];
  if (known) return known;
  if (!/^0x[0-9a-f]{40}$/.test(addrLower)) return null;
  return { symbol: ("TK" + addrLower.slice(-2)).toUpperCase(), name: UNCURATED_ASSET_NAME, decimals: 18 };
}

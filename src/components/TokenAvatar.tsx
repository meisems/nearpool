import { memo, useState } from "react";
import { getAddress } from "viem";
import { PONSPOOL_LOGO_URL, PLATFORM_TOKEN_ADDRESS, WETH_ADDRESS } from "../lib/constants";
import { IconEth } from "./icons";

const CHAINS: Record<string, string> = { "1": "ethereum", "4663": "robinhood-chain" };
const TRUST = (chain: string, addr: string) =>
  `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${getAddress(addr)}/logo.png`;
const PONSFAMILY_ORIGIN = "https://www.ponsfamily.com";

function launchpadLogo(uri?: string): string | null {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  const cid = uri.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
  return cid ? `${PONSFAMILY_ORIGIN}/api/ipfs/content/${cid}?variant=card` : null;
}

function hueOf(s: string): number {
  let h = 0;
  for (let i = 2; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* Clean on-chain-style identicon — three stacked soft bars. */
function Identicon({ seed, size }: { seed: string; size: number }) {
  const h = hueOf(seed);
  const n1 = hueOf(seed + "a");
  const n2 = hueOf(seed + "b");
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="block">
      <circle cx="20" cy="20" r="20" fill={`hsl(${h} 32% 82%)`} />
      <rect x="7" y="10.5" width={12 + (n1 % 15)} height="5.4" rx="2.7" fill={`hsl(${h} 46% 42%)`} />
      <rect x="7" y="17.5" width={9 + (n2 % 18)} height="5.4" rx="2.7" fill={`hsl(${(h + 42) % 360} 42% 52%)`} />
      <rect x="7" y="24.5" width={14 + (n1 % 11)} height="5.4" rx="2.7" fill={`hsl(${(h + 12) % 360} 38% 34%)`} />
    </svg>
  );
}

function LetterAvatar({ symbol, size }: { symbol: string; size: number }) {
  const h = hueOf(symbol.toLowerCase());
  return (
    <span
      className="flex items-center justify-center rounded-full font-display font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        background: `linear-gradient(135deg, hsl(${h} 42% 84%), hsl(${(h + 40) % 360} 40% 72%))`,
        color: `hsl(${h} 45% 26%)`,
      }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Real token logo with a clean fallback chain:
 * official $PONSPOOL asset -> launchpad URI -> Trust Wallet -> identicon -> lettermark.
 */
export const TokenAvatar = memo(function TokenAvatar({
  address,
    symbol = "?",
  size = 24,
  chainId = "4663",
  className = "",
  logo,
}: {
  address?: string;
  symbol?: string;
  size?: number;
  chainId?: string;
  className?: string;
  /** Logo URI returned by the token contract's logo() method. */
  logo?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const key = `${address ?? ""}|${symbol}|${size}|${logo ?? ""}`;
  const [cacheKey, setCacheKey] = useState(key);
  if (key !== cacheKey) {
    setCacheKey(key);
    setFailed([]);
  }

  const isEth = !address || address.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const isPons = !!address && address.toLowerCase() === PLATFORM_TOKEN_ADDRESS.toLowerCase();

  const wrap = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`;

  if (isEth) {
    return (
      <span
        className={`${wrap} bg-gradient-to-br from-[#8fa8c8] to-[#5f7ba3] text-white dark:from-[#5b7396] dark:to-[#3c5170]`}
        style={{ width: size, height: size }}
      >
        <IconEth size={Math.round(size * 0.6)} />
      </span>
    );
  }

  const addr = address!.toLowerCase();
  const trust = TRUST(CHAINS[chainId] ?? "ethereum", address!);
  const official = isPons ? PONSPOOL_LOGO_URL : null;
  const launchpad = launchpadLogo(logo);
  const src = !failed.includes("official") && official
    ? official
    : !failed.includes("launchpad") && launchpad
      ? launchpad
      : !failed.includes("trust")
        ? trust
        : null;

  if (src) {
    return (
      <span className={wrap} style={{ width: size, height: size, background: "var(--card-2)" }}>
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="block h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            const tag = official && src === official ? "official" : launchpad && src === launchpad ? "launchpad" : "trust";
            setFailed((f) => (f.includes(tag) ? f : [...f, tag]));
          }}
        />
      </span>
    );
  }

  if (symbol && symbol !== "?" && !failed.includes("identicon")) {
    return (
      <span className={wrap} style={{ width: size, height: size }}>
        <Identicon seed={addr} size={size} />
      </span>
    );
  }

  return <LetterAvatar symbol={symbol || "?"} size={size} />;
});

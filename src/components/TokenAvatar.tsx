import { memo, useState } from "react";
import { WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { useFtMetadata } from "../hooks/useRefData";
import { IconNear } from "./icons";

function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* Clean identicon — three stacked soft bars seeded from the token account ID. */
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

/** Only render icons that can't execute script: data:image/* (non-SVG or SVG in <img>) and https URLs. */
function safeIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  if (/^data:image\//i.test(icon)) return icon;
  if (/^https:\/\//i.test(icon)) return icon;
  if (/^ipfs:\/\//i.test(icon)) return `https://ipfs.io/ipfs/${icon.slice(7)}`;
  return null;
}

/**
 * NEP-141 token logo. NEAR / wNEAR renders the NEAR mark; everything else
 * uses the icon from the token's own `ft_metadata`, falling back to a
 * deterministic identicon. Icons are rendered via <img>, which never runs
 * script even for SVG data URIs.
 */
export const TokenAvatar = memo(function TokenAvatar({
  tokenId,
  icon,
  size = 24,
  className = "",
}: {
  /** NEP-141 contract ID. Omit for native NEAR. */
  tokenId?: string;
  /** Icon override; when omitted it is read from `ft_metadata`. */
  icon?: string | null;
  size?: number;
  className?: string;
}) {
  const isNear = !tokenId || tokenId === WRAP_NEAR_CONTRACT_ID;
  const meta = useFtMetadata(!isNear && icon === undefined ? tokenId : null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const wrap = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`;

  if (isNear) {
    return (
      <span className={`${wrap} bg-ink text-canvas`} style={{ width: size, height: size }}>
        <IconNear size={Math.round(size * 0.62)} />
      </span>
    );
  }

  const src = safeIcon(icon === undefined ? meta.data?.icon : icon);
  if (src && src !== failedSrc) {
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
          onError={() => setFailedSrc(src)}
        />
      </span>
    );
  }

  return (
    <span className={wrap} style={{ width: size, height: size }}>
      <Identicon seed={tokenId} size={size} />
    </span>
  );
});

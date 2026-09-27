import type { SVGProps } from "react";
import {
  Sun,
  Moon,
  Wallet,
  Plugs,
  CircleNotch,
  Check,
  WarningCircle,
  Copy,
  ArrowSquareOut,
  SlidersHorizontal,
  CaretDown,
  X,
  ArrowRight,
  ArrowDown,
  ShieldCheck,
  Key,
  Fire,
  Info,
  Coins,
  Drop,
  ArrowsLeftRight,
  Clock,
  Lock,
  Stack,
  MagnifyingGlass,
  Lightning,
  ImageSquare,
  ArrowsHorizontal,
  Atom,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

/*
 * OKX-style icon system, backed by Phosphor Icons.
 *
 * Every icon in this app is exported from here under its original name
 * (IconCheck, IconWallet, ...), so every consuming component keeps working
 * unchanged. Internally each one now renders a Phosphor glyph at a
 * standardized weight for a clean, technical, monochrome aesthetic.
 *
 * Weight standard: "regular" everywhere, "bold" for a handful of glyphs
 * that read as too thin at small sizes (chevrons, close, checks, arrows).
 * Brand marks (the pond emblem, the ETH diamond) stay hand-drawn — they're
 * identity marks, not UI iconography, so they're kept as bespoke SVG
 * rather than swapped for a generic library glyph.
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  /** Kept for backwards compatibility with old call sites; unused by
   *  Phosphor icons (weight is controlled per-glyph below), but accepting
   *  it means nothing breaks if a caller still passes it. */
  strokeWidth?: number;
}

function phosphor(
  PIcon: PhosphorIcon,
  weight: "thin" | "light" | "regular" | "bold" | "fill" | "duotone" = "regular",
) {
  return function Wrapped({ size = 16, strokeWidth: _strokeWidth, ...props }: IconProps) {
    return <PIcon size={size} weight={weight} {...props} />;
  };
}

/* ------------------------------------------------------- brand */

/** Circular pond emblem — ripple rings around the coin core. Bespoke brand
 *  mark, intentionally not a Phosphor glyph. */
export function IconPondMark({ size = 24, strokeWidth = 1.5, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="16" cy="16" r="13.4" opacity="0.35" />
      <circle cx="16" cy="16" r="8.7" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
      <path d="M24.7 7.3 18.6 13.4" />
      <path d="M7.3 24.7 13.4 18.6" />
    </svg>
  );
}

export const IconMark = IconPondMark;

/* ------------------------------------------------------- ui */

export const IconSun = phosphor(Sun);
export const IconMoon = phosphor(Moon);

/** WalletConnect-style pairing glyph, mapped to Phosphor's "Plugs" (connect
 *  / pair) — no 1:1 walletconnect glyph exists in the Phosphor set. */
export const IconWalletConnect = phosphor(Plugs);

export const IconWallet = phosphor(Wallet);

/** Always paired with `animate-spin` at call sites — CircleNotch is
 *  Phosphor's purpose-built spinner glyph. */
export const IconLoader = phosphor(CircleNotch);

export const IconCheck = phosphor(Check, "bold");
export const IconAlert = phosphor(WarningCircle);
export const IconCopy = phosphor(Copy);
export const IconExternal = phosphor(ArrowSquareOut);
export const IconSettings = phosphor(SlidersHorizontal);
export const IconChevronDown = phosphor(CaretDown, "bold");

export const IconClose = phosphor(X, "bold");
export const IconX = IconClose;

export const IconArrowRight = phosphor(ArrowRight, "bold");
export const IconArrowDown = phosphor(ArrowDown, "bold");
export const IconShield = phosphor(ShieldCheck);
export const IconKey = phosphor(Key);
export const IconFlame = phosphor(Fire);
export const IconInfo = phosphor(Info);
export const IconCoins = phosphor(Coins);
export const IconDropletPlus = phosphor(Drop);
export const IconSwap = phosphor(ArrowsLeftRight, "bold");
export const IconClock = phosphor(Clock);
export const IconLock = phosphor(Lock);
export const IconLayers = phosphor(Stack);
export const IconSearch = phosphor(MagnifyingGlass);
export const IconZap = phosphor(Lightning, "fill");
export const IconNft = phosphor(ImageSquare);
export const IconRange = phosphor(ArrowsHorizontal, "bold");
export const IconAtom = phosphor(Atom);

/** Ethereum diamond mark — bespoke brand glyph, kept hand-drawn for
 *  fidelity (no generic "eth" icon in Phosphor matches the real mark). */
export const IconEth = ({ size = 16, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M12 3v6.6l5 2.3Z" opacity="0.55" />
    <path d="M12 3 7 11.9l5-2.3Z" />
    <path d="m12 14 5-2.6-5 9.1Z" opacity="0.55" />
    <path d="m12 20.5-5-9.1 5 2.6Z" />
    <path d="m17 11.4-5 2.6V9.1Z" opacity="0.35" />
    <path d="M7 11.4 12 9.1v4.9Z" opacity="0.8" />
  </svg>
);

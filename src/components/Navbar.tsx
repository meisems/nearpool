import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useNearWallet } from "../context/NearWalletContext";
import { useAccountSnapshot, useNativeBalance } from "../hooks/useRefData";
import { fmtAmount, shortAccount } from "../lib/format";
import { NEAR_DECIMALS, WRAP_NEAR_CONTRACT_ID, explorerAccountUrl } from "../config/near";
import { useTheme } from "./ThemeProvider";
import { useToast } from "./Toasts";
import { Logo } from "./Logo";
import { Button, CopyButton, IconButton } from "./ui";
import { IconDropletPlus, IconExternal, IconMoon, IconStar, IconSun, IconSwap, IconWallet, IconX } from "./icons";

const LINKS: Array<{ to: string; label: string; icon: ReactNode; end?: boolean }> = [
  { to: "/", label: "Add liquidity", icon: <IconDropletPlus size={18} />, end: true },
  { to: "/track", label: "Tracked", icon: <IconStar size={18} /> },
  { to: "/swap", label: "Swap", icon: <IconSwap size={18} /> },
];

function ThemeButton() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <IconButton
      label={dark ? "Light theme" : "Dark theme"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </IconButton>
  );
}

function AccountMenu({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { signOut } = useNearWallet();
  const toast = useToast();
  const native = useNativeBalance();
  const snap = useAccountSnapshot([WRAP_NEAR_CONTRACT_ID]);
  const wNear = snap.data?.tokens[WRAP_NEAR_CONTRACT_ID];

  const rows: Array<[string, bigint | undefined]> = [
    ["NEAR", native.data?.available],
    ["wNEAR", wNear?.walletBalance],
    ["wNEAR in Ref", wNear?.refDeposit],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-card p-3 shadow-(--shadow-pop)"
    >
      <div className="flex items-center gap-1 px-1">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink" title={accountId}>{accountId}</span>
        <CopyButton value={accountId} />
        <a href={explorerAccountUrl(accountId)} target="_blank" rel="noreferrer" aria-label="View on nearblocks" className="rounded-lg p-1.5 text-muted hover:bg-card2 hover:text-ink">
          <IconExternal size={13} />
        </a>
      </div>
      <dl className="mt-2 space-y-1.5 rounded-xl bg-card2 p-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-muted">{label}</dt>
            <dd className="text-ink tabular">{value === undefined ? "…" : fmtAmount(value, NEAR_DECIMALS)}</dd>
          </div>
        ))}
      </dl>
      <Button
        variant="danger"
        size="sm"
        className="mt-2 w-full"
        onClick={async () => {
          onClose();
          try {
            await signOut();
          } catch (e) {
            toast(e instanceof Error ? e.message : "Couldn't disconnect", "warn");
          }
        }}
      >
        <IconX size={13} /> Disconnect
      </Button>
    </motion.div>
  );
}

function WalletButton() {
  const { accountId, signIn, status } = useNearWallet();
  const [open, setOpen] = useState(false);

  if (!accountId) {
    return (
      <Button size="md" onClick={signIn} disabled={status !== "ready"} loading={status === "initializing"}>
        {status !== "initializing" && <IconWallet size={16} />}
        {status === "error" ? "Unavailable" : "Connect"}
      </Button>
    );
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-medium text-ink transition hover:border-faint"
      >
        <span className="h-2 w-2 rounded-full bg-vip" />
        <span className="max-w-[9rem] truncate font-mono text-[13px]">{shortAccount(accountId)}</span>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <AccountMenu accountId={accountId} onClose={() => setOpen(false)} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Navbar() {
  // Token pages are part of the "Add liquidity" flow.
  const onTokenPage = useLocation().pathname.startsWith("/t/");
  const active = (to: string, isActive: boolean) => isActive || (to === "/" && onTokenPage);
  const linkClass = (to: string) => ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${active(to, isActive) ? "bg-card2 text-ink" : "text-muted hover:text-ink"}`;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-linesoft bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="nearpool home" className="flex shrink-0 items-center gap-2 text-ink">
            <span id="nearpool-brand" className="inline-flex">
              <Logo size={30} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">nearpool</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass(l.to)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeButton />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-linesoft bg-canvas/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active(l.to, isActive) ? "text-accent" : "text-muted"}`}
          >
            {l.icon}
            {l.label === "Add liquidity" ? "Add" : l.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

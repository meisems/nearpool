import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { useAccountSnapshot, useNativeBalance } from "../hooks/useRefData";
import { rpcProvider } from "../lib/near";
import { fmtAmount, shortAccount } from "../lib/format";
import { NEAR_DECIMALS, WRAP_NEAR_CONTRACT_ID, explorerAccountUrl } from "../config/near";
import { useTheme } from "./ThemeProvider";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { Logo } from "./Logo";
import {
  IconCheck, IconChevronDown, IconCopy, IconDropletPlus, IconExternal, IconLoader,
  IconMoon, IconSun, IconSwap, IconWallet, IconX,
} from "./icons";

type MainRoute = "/inject" | "/swap";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

function BlockChip() {
  const { data: height } = useQuery({
    queryKey: ["near-block-height"],
    queryFn: async () => (await rpcProvider.block({ finality: "final" })).header.height,
    refetchInterval: 6_000,
  });
  return (
    <div className="hidden items-center gap-2 rounded-full border border-line bg-card/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted lg:flex">
      <span className="h-1.5 w-1.5 rounded-full bg-vip vip-pulse" />
      near · blk {height ? height.toLocaleString() : "…"}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      aria-label={dark ? "switch to light theme" : "switch to dark theme"}
      className="relative h-9 w-[60px] shrink-0 rounded-full border border-line bg-card2 transition-colors hover:border-accent/40"
    >
      <motion.span
        layout
        transition={spring}
        className={`absolute top-[3px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-card text-ink shadow-(--shadow-soft) ${dark ? "left-[27px]" : "left-[3px]"}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={dark ? "moon" : "sun"}
            initial={{ rotate: -70, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 70, opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.22 }}
            className="text-coin"
          >
            {dark ? <IconMoon size={15} /> : <IconSun size={15} />}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </button>
  );
}

function Backdrop({ onTap }: { onTap: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onTap}
      className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[3px] dark:bg-black/45"
    />
  );
}

const TABS: Array<{ id: MainRoute; path: MainRoute; label: string; icon: ReactNode }> = [
  { id: "/inject", path: "/inject", label: "inject lp", icon: <IconDropletPlus size={14} /> },
  { id: "/swap", path: "/swap", label: "swap", icon: <IconSwap size={14} /> },
];

function AccountPanel({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const { signOut } = useNearWallet();
  const toast = useToast();
  const native = useNativeBalance();
  const snapshot = useAccountSnapshot([WRAP_NEAR_CONTRACT_ID]);
  const wNear = snapshot.data?.tokens[WRAP_NEAR_CONTRACT_ID];
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("clipboard said no. select it manually.", "warn");
    }
  };

  const disconnect = async () => {
    onClose();
    try {
      await signOut();
      toast("disconnected. the pool will miss you.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "wallet refused to disconnect", "warn");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={spring}
      className="absolute right-0 z-50 mt-2 w-[300px] rounded-3xl border border-line bg-card p-4 shadow-(--shadow-pop)"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">session</span>
        <button onClick={copyAccount} className="flex max-w-[200px] items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-card2 hover:text-ink">
          {copied ? <IconCheck size={12} className="shrink-0 text-vip" /> : <IconCopy size={12} className="shrink-0" />}
          <span className="truncate">{shortAccount(accountId, 24)}</span>
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-muted"><TokenAvatar size={22} /> NEAR</span>
          <span className="font-mono text-sm font-medium text-ink tabular">
            {native.data ? fmtAmount(native.data.available, NEAR_DECIMALS) : "…"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-muted"><TokenAvatar size={22} /> wNEAR</span>
          <span className="font-mono text-sm font-medium text-ink tabular">
            {wNear ? fmtAmount(wNear.walletBalance, NEAR_DECIMALS) : "…"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">wNEAR in Ref deposits</span>
          <span className="font-mono text-sm font-medium text-ink tabular">
            {wNear ? fmtAmount(wNear.refDeposit, NEAR_DECIMALS) : "…"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-linesoft pt-3">
        <a
          href={explorerAccountUrl(accountId)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-full bg-card2 px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          nearblocks <IconExternal size={11} />
        </a>
        <button
          onClick={() => void disconnect()}
          className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10"
        >
          <IconX size={12} /> disconnect
        </button>
      </div>
    </motion.div>
  );
}

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab: MainRoute | null = location.pathname === "/inject" || location.pathname === "/swap" ? location.pathname : null;
  const { accountId, signIn, status } = useNearWallet();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3">
      <div className="glass mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 rounded-full border border-line pl-3 pr-2 shadow-(--shadow-soft) sm:h-[60px] sm:pl-4">
        {/* brand — the loader docks here */}
        <Link
          id="pp-brand"
          to="/"
          aria-label="nearpool home"
          className="group flex shrink-0 items-center gap-2 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Logo size={28} className="text-ink transition-colors group-hover:text-accent" />
          <span className="font-display text-[17px] font-semibold tracking-tight text-ink">nearpool</span>
        </Link>

        {/* tabs — desktop */}
        <nav className="hidden items-center gap-1 rounded-full bg-card2/70 p-1 md:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(t.path)}
              className={`relative flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors ${
                tab === t.id ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tab === t.id && (
                <motion.span layoutId="tab-pill" transition={spring} className="absolute inset-0 rounded-full bg-card shadow-(--shadow-soft)" />
              )}
              <span className={`relative z-10 ${tab === t.id ? "text-accent" : ""}`}>{t.icon}</span>
              <span className="relative z-10">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <BlockChip />
          <ThemeToggle />

          {!accountId ? (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={signIn}
              disabled={status !== "ready"}
              className="flex h-10 items-center gap-2 rounded-full bg-ink px-3.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-85 disabled:opacity-60 sm:px-4"
            >
              {status === "initializing" ? <IconLoader size={14} className="animate-spin" /> : <IconWallet size={15} />}
              <span className="hidden sm:inline">{status === "error" ? "wallets unavailable" : "connect"}</span>
            </motion.button>
          ) : (
            <div className="relative">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setAccountOpen((v) => !v)}
                className="flex h-10 items-center gap-2 rounded-full border border-line bg-card/70 pr-2.5 pl-2.5 text-[13px] font-medium text-ink hover:border-accent/40"
              >
                <span className="h-2 w-2 rounded-full bg-vip vip-pulse" />
                <span className="max-w-[140px] truncate font-mono text-xs">{shortAccount(accountId)}</span>
                <IconChevronDown size={13} className={`text-faint transition-transform ${accountOpen ? "rotate-180" : ""}`} />
              </motion.button>

              <AnimatePresence>
                {accountOpen && (
                  <>
                    <Backdrop onTap={() => setAccountOpen(false)} />
                    <AccountPanel accountId={accountId} onClose={() => setAccountOpen(false)} />
                  </>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* tabs — mobile segment */}
      <div className="mx-auto mt-2 flex max-w-5xl gap-1 rounded-full border border-line bg-card/60 p-1 shadow-(--shadow-soft) backdrop-blur-md md:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(t.path)}
            className={`relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-medium transition-colors ${
              tab === t.id ? "text-ink" : "text-muted"
            }`}
          >
            {tab === t.id && (
              <motion.span layoutId="tab-pill-m" transition={spring} className="absolute inset-0 rounded-full bg-card2 shadow-(--shadow-soft)" />
            )}
            <span className={`relative z-10 ${tab === t.id ? "text-accent" : ""}`}>{t.icon}</span>
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

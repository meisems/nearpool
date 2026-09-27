import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount, useBalance, useBlockNumber, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useHolderTier } from "../hooks/useHolderTier";
import { fmtWei, shortAddr } from "../lib/format";
import {
  HAS_WALLETCONNECT,
  PLATFORM_TOKEN_ADDRESS,
  PLATFORM_TOKEN_SYMBOL,
  REQUIRED_HOLD_TOKENS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_HEX,
  ROBINHOOD_RPC_URL,
} from "../lib/constants";
import { useTheme } from "./ThemeProvider";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { Logo } from "./Logo";
import {
  IconCheck, IconChevronDown, IconCoins, IconCopy, IconFlame, IconKey, IconLoader,
  IconMoon, IconShield, IconSun, IconWallet, IconWalletConnect, IconX,
} from "./icons";

type MainRoute = "/launch-pool" | "/buy";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

function BlockChip() {
  const { data: block } = useBlockNumber({ chainId: ROBINHOOD_CHAIN_ID, watch: true });
  return (
    <div className="hidden items-center gap-2 rounded-full border border-line bg-card/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted lg:flex">
      <span className="h-1.5 w-1.5 rounded-full bg-vip vip-pulse" />
      4663 · blk {block ? block.toLocaleString() : "…"}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label="toggle theme"
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
  { id: "/launch-pool", path: "/launch-pool", label: "launch pool", icon: <IconCoins size={14} /> },
  { id: "/buy", path: "/buy", label: "buy $ponspool", icon: <IconFlame size={14} /> },
];

export function Navbar({
  connectOpen,
  setConnectOpen,
}: {
  connectOpen: boolean;
  setConnectOpen: (v: boolean) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab: MainRoute | null = location.pathname === "/launch-pool" || location.pathname === "/buy" ? location.pathname : null;
  const { address, isConnected, isConnecting, chainId: accountChainId, connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const tier = useHolderTier();
  const balance = useBalance({ address, chainId: ROBINHOOD_CHAIN_ID, query: { refetchInterval: 6000 } });
  const toast = useToast();

  const [accountOpen, setAccountOpen] = useState(false);
  const [dispensaryOpen, setDispensaryOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"injected" | "wc" | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wrongNetwork = isConnected && accountChainId !== undefined && accountChainId !== ROBINHOOD_CHAIN_ID;
  const hasInjected = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

  const closeAll = () => {
    setAccountOpen(false);
    setDispensaryOpen(false);
  };

  const connectWith = async (kind: "injected" | "wc") => {
    setSheetError(null);
    setBusy(kind);
    try {
      const target =
        kind === "injected"
          ? connectors.find((c) => c.type === "injected")
          : connectors.find((c) => c.type === "walletConnect");
      if (!target) throw new Error("missing");
      await connectAsync({ connector: target });
      setConnectOpen(false);
      toast(
        kind === "wc"
          ? "paired over walletconnect. scan-free since you're here."
          : "wallet linked. keys never left the extension.",
        "ok"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === "wc") {
        setSheetError(
          /user rejected|denied|cancelled/i.test(msg)
            ? "pairing dismissed. the qr code won't take it personally."
            : /project/i.test(msg)
              ? "walletconnect rejected the project id. check VITE_WALLETCONNECT_PROJECT_ID."
              : "pairing timed out or the relay hiccuped. try again."
        );
      } else {
        setSheetError(
          /user rejected|denied/i.test(msg)
            ? "you said no. respect. nothing connected."
            : "no wallet extension here. try walletconnect instead."
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("clipboard said no. select it manually.", "warn");
    }
  };

  const switchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: ROBINHOOD_CHAIN_ID });
      toast("welcome to robinhood chain.", "ok");
    } catch {
      try {
        const provider = (await connector?.getProvider?.()) as
          | { request?: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
          | undefined;
        await provider?.request?.({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ROBINHOOD_CHAIN_HEX,
            chainName: "Robinhood Chain",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [ROBINHOOD_RPC_URL],
          }],
        });
        await switchChainAsync({ chainId: ROBINHOOD_CHAIN_ID });
      } catch {
        toast("your wallet declined the switch. it happens.", "warn");
      }
    }
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3">
      <div className="glass mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 rounded-full border border-line pl-3 pr-2 shadow-(--shadow-soft) sm:h-[60px] sm:pl-4">
        {/* brand — the loader docks here */}
        <Link
          id="pp-brand"
          to="/"
          aria-label="ponspool home"
          className="group flex shrink-0 items-center gap-2 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Logo size={26} />
          <span className="font-display text-[17px] font-semibold tracking-tight text-ink">ponspool</span>
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
                <motion.span
                  layoutId="tab-pill"
                  transition={spring}
                  className="absolute inset-0 rounded-full bg-card shadow-(--shadow-soft)"
                />
              )}
              <span className={`relative z-10 ${tab === t.id ? "text-accent" : ""}`}>{t.icon}</span>
              <span className="relative z-10">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <BlockChip />
          <ThemeToggle />

          {!isConnected ? (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { setSheetError(null); setConnectOpen(true); }}
              className="flex h-10 items-center gap-2 rounded-full bg-ink px-3.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-85 sm:px-4"
            >
              {isConnecting ? <IconLoader size={14} className="animate-spin" /> : <IconWallet size={15} />}
              <span className="hidden sm:inline">connect</span>
            </motion.button>
          ) : (
            <div className="relative">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => { closeAll(); setAccountOpen((v) => !v); }}
                className="flex h-10 items-center gap-2 rounded-full border border-line bg-card/70 pr-2.5 pl-2.5 text-[13px] font-medium text-ink hover:border-accent/40"
              >
                <span className={`h-2 w-2 rounded-full ${wrongNetwork ? "bg-amberish" : "bg-vip vip-pulse"}`} />
                <span className="font-mono text-xs">{shortAddr(address)}</span>
                <IconChevronDown size={13} className={`text-faint transition-transform ${accountOpen ? "rotate-180" : ""}`} />
              </motion.button>

              <AnimatePresence>
                {accountOpen && (
                  <>
                    <Backdrop onTap={() => setAccountOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={spring}
                      className="absolute right-0 z-50 mt-2 w-[300px] rounded-3xl border border-line bg-card p-4 shadow-(--shadow-pop)"
                    >
                      {wrongNetwork && (
                        <div className="mb-3 rounded-2xl bg-ambersoft p-3">
                          <div className="text-xs font-semibold text-amberish">wrong network</div>
                          <p className="mt-1 text-[11px] leading-snug text-muted">the pond lives on robinhood chain · 4663.</p>
                          <button
                            onClick={switchNetwork}
                            className="mt-2 w-full rounded-full bg-amberish py-2.5 text-xs font-semibold text-canvas transition-transform active:scale-[0.98]"
                          >
                            switch to 4663
                          </button>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">session</span>
                        <button onClick={copyAddress} className="flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-card2 hover:text-ink">
                          {copied ? <IconCheck size={12} className="text-vip" /> : <IconCopy size={12} />}
                          {shortAddr(address)}
                        </button>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-xs text-muted"><TokenAvatar size={22} /> ETH</span>
                          <span className="font-mono text-sm font-medium text-ink tabular">
                            {balance.data ? fmtWei(balance.data.value, 18) : "…"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-xs text-muted">
                            <TokenAvatar address={PLATFORM_TOKEN_ADDRESS} size={22} /> ${PLATFORM_TOKEN_SYMBOL}
                          </span>
                          <span className="font-mono text-sm font-medium text-ink tabular">
                            {tier.isLoading ? "…" : fmtWei(tier.userBalance, 18)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-t border-linesoft pt-3">
                        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${tier.isHolder ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tier.isHolder ? "bg-vip" : "bg-faint"}`} />
                          {tier.isHolder ? "holder tier" : "standard tier"}
                        </span>
                        <button
                          onClick={() => { disconnect(); setAccountOpen(false); toast("disconnected. the pond will miss you.", "ok"); }}
                          className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10"
                        >
                          <IconX size={12} /> disconnect
                        </button>
                      </div>
                    </motion.div>
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


      {/* tier strip when non-holder */}
      <AnimatePresence>
        {isConnected && !tier.isHolder && !tier.isLoading && !wrongNetwork && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mx-auto mt-2 flex max-w-5xl items-center justify-center gap-2"
          >
            <button
              onClick={() => { closeAll(); setDispensaryOpen((v) => !v); }}
              className="frost relative flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[11px] font-medium text-muted hover:border-coin/50"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-faint" />
              standard · 1.0% cut burned on-chain · hold {REQUIRED_HOLD_TOKENS.toLocaleString()} ${PLATFORM_TOKEN_SYMBOL} to waive
              <span className="font-semibold text-coin">unlock</span>
            </button>
            <AnimatePresence>
              {dispensaryOpen && (
                <>
                  <Backdrop onTap={() => setDispensaryOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={spring}
                    className="absolute top-24 left-1/2 z-50 w-[280px] -translate-x-1/2 rounded-3xl border border-line bg-card p-4 shadow-(--shadow-pop)"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <TokenAvatar address={PLATFORM_TOKEN_ADDRESS} size={24} /> holder tier
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      hold {REQUIRED_HOLD_TOKENS.toLocaleString()} ${PLATFORM_TOKEN_SYMBOL}. zero protocol tax, forever.
                    </p>
                    <button
                      onClick={() => { setDispensaryOpen(false); navigate("/buy"); }}
                      className="mt-3 w-full text-center text-[11px] text-faint transition-colors hover:text-ink"
                    >
                      or buy some on the swap tab
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* connect sheet */}
      <AnimatePresence>
        {connectOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 backdrop-blur-[4px] sm:items-center sm:p-4 dark:bg-black/50"
            onClick={() => setConnectOpen(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={spring}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-t-3xl border border-line bg-card p-5 shadow-(--shadow-pop) sm:w-[400px] sm:rounded-3xl"
              style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display text-lg font-semibold text-ink">connect</div>
                  <div className="mt-0.5 text-xs text-muted">explicit consent. nothing silent.</div>
                </div>
                <button onClick={() => setConnectOpen(false)} className="rounded-full p-1.5 text-faint transition-colors hover:bg-card2 hover:text-ink">
                  <IconX size={16} />
                </button>
              </div>

              <div className="mt-4 space-y-2.5">
                <button
                  onClick={() => connectWith("injected")}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-card2/50 p-3.5 text-left transition-all hover:border-accent/40 hover:bg-card2 disabled:opacity-60"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accentsoft text-accent">
                    {busy === "injected" ? <IconLoader size={17} className="animate-spin" /> : <IconWallet size={17} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">browser wallet</span>
                    <span className="block text-[11px] text-muted">
                      {hasInjected
                        ? "extension found. keys stay inside it."
                        : "no extension detected — try walletconnect."}
                    </span>
                  </span>
                </button>

                <button
                  onClick={() => connectWith("wc")}
                  disabled={busy !== null || !HAS_WALLETCONNECT}
                  className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-card2/50 p-3.5 text-left transition-all hover:border-accent/40 hover:bg-card2 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accentsoft text-accent">
                    {busy === "wc" ? <IconLoader size={17} className="animate-spin" /> : <IconWalletConnect size={17} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">walletconnect</span>
                    <span className="block text-[11px] text-muted">
                      {HAS_WALLETCONNECT
                        ? "qr code on desktop, deep link on mobile. 300+ wallets."
                        : "offline — set VITE_WALLETCONNECT_PROJECT_ID to arm pairing."}
                    </span>
                  </span>
                  {!HAS_WALLETCONNECT && (
                    <span className="ml-auto shrink-0 rounded-full bg-card2 px-2 py-0.5 font-mono text-[9px] tracking-wide text-faint uppercase">
                      config
                    </span>
                  )}
                </button>

              </div>

              <AnimatePresence>
                {sheetError && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 rounded-2xl bg-ambersoft px-3.5 py-2.5 text-[11px] leading-snug font-medium text-amberish">
                      {sheetError}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-linesoft pt-3.5">
                {[
                  { icon: <IconShield size={11} />, label: "no auto-reconnect" },
                  { icon: <IconKey size={11} />, label: "no key storage" },
                  { icon: <IconCoins size={11} />, label: "pinned to 4663" },
                ].map((c) => (
                  <span key={c.label} className="flex items-center gap-1.5 rounded-full bg-card2 px-2.5 py-1 font-mono text-[9.5px] tracking-wide text-muted">
                    <span className="text-accent">{c.icon}</span>
                    {c.label}
                  </span>
                ))}
                <span className="w-full pt-1 text-[10px] leading-snug text-faint">
                  we only ever ask for balances and the transactions you start.
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

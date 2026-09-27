import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { tokenInfo } from "../lib/tokenRegistry";
import { usePonsLaunchToken } from "../lib/ponsCatalog";
import { useTokenMeta } from "../hooks/useTokenMeta";
import { EXPLORER_URL, PLATFORM_TOKEN_ADDRESS, WETH_ADDRESS } from "../lib/constants";
import {
  cachedLiveActivity,
  subscribeLiveActivity,
  syncLiveActivity,
  type PlatformTx,
} from "../lib/liveActivity";
import { fmtWei, shortAddr } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import {
  IconArrowRight,
  IconChevronDown,
  IconClock,
  IconCoins,
  IconDropletPlus,
  IconExternal,
  IconFlame,
  IconShield,
  IconZap,
} from "./icons";

function txTime(timestamp?: number): string {
  if (!timestamp) return "confirmed on-chain";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

/* ------------------------------------------------ hero */

export function Hero({ onLaunch, onBuy }: { onLaunch: () => void; onBuy: () => void }) {
  return (
    <section className="relative">
      <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200 }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-card/70 px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-vip vip-pulse" />
            robinhood chain · non-custodial
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.06 }}
            className="mt-5 font-display text-[40px] leading-[1.02] font-semibold tracking-tight text-ink sm:text-[56px] lg:text-[62px]"
          >
            Instant LP injection
            <br />
            on <span className="text-accent">Robinhood Chain.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.12 }}
            className="mt-5 max-w-md text-[15px] leading-relaxed text-muted"
          >
            One-click liquidity provisioning. Hold <span className="font-semibold text-coin">$PONSPOOL</span>, seed your
            pool, burn the LP permanently. Clean and non-custodial.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.18 }}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onLaunch}
              className="flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-canvas shadow-(--shadow-soft) transition-opacity hover:opacity-90 dark:text-[#06251a]"
            >
              launch pool <IconArrowRight size={15} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onBuy}
              className="flex h-12 items-center gap-2.5 rounded-full border border-line bg-card/80 px-6 text-sm font-semibold text-ink transition-all hover:border-coin/60"
            >
              <TokenAvatar address={PLATFORM_TOKEN_ADDRESS} size={20} /> buy $PONSPOOL
            </motion.button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] text-faint"
          >
            <span>direct uniswap</span>
            <span>·</span>
            <span>pools burn directly</span>
            <span>·</span>
            <span>devs keep sovereignty</span>
          </motion.div>
        </div>

        {/* the pond */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.15 }}
          className="relative mx-auto hidden aspect-square w-full max-w-[360px] items-center justify-center lg:flex"
        >
          {[0, 1.5, 3].map((d) => (
            <span
              key={d}
              className="pond-ring absolute inset-0 rounded-full border border-accent/20"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
          <div className="absolute inset-[12%] rounded-full border border-line bg-card/40" />
          <div className="absolute inset-[26%] rounded-full border border-linesoft bg-card/60 shadow-(--shadow-soft)" />
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10"
          >
            <TokenAvatar address={PLATFORM_TOKEN_ADDRESS} size={110} className="shadow-(--shadow-pop)" />
          </motion.div>
          <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 rounded-full border border-line bg-card/80 px-3.5 py-1.5 font-mono text-[10.5px] text-muted backdrop-blur-md">
            the pond. it thickens.
          </div>
        </motion.div>
      </div>

    </section>
  );
}

/* ------------------------------------------------ transaction feed */

function useLiveTransactions(limit = 8): PlatformTx[] {
  const [rows, setRows] = useState<PlatformTx[]>(() => cachedLiveActivity()?.rows.slice(0, limit) ?? []);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const snapshot = await syncLiveActivity();
      if (alive && snapshot) setRows(snapshot.rows.slice(0, limit));
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const unsubscribe = subscribeLiveActivity(() => {
      const snapshot = cachedLiveActivity();
      if (snapshot) setRows(snapshot.rows.slice(0, limit));
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [limit]);
  return rows;
}

function TxRow({ tx, delay }: { tx: PlatformTx; delay: number }) {
  // Same resolution the token picker uses when pasting an address: prefer
  // the curated Pons Family launch catalog, fall back to a live on-chain
  // name()/symbol() read for tokens outside it (e.g. a permissionless
  // pasted address), and only show the generic placeholder while both are
  // still loading or unavailable.
  const catalogToken = usePonsLaunchToken(tx.token);
  const live = useTokenMeta(tx.token as `0x${string}`, WETH_ADDRESS as `0x${string}`);
  const fallback = tokenInfo(tx.token);
  const symbol = catalogToken?.symbol ?? live.symbol ?? fallback?.symbol ?? "???";
  const name = catalogToken?.name ?? live.name ?? fallback?.name ?? "unknown token";
  const decimals = catalogToken?.decimals ?? live.decimals ?? fallback?.decimals ?? 18;
  const logo = catalogToken?.logo ?? live.logo;

  return (
    <motion.a
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", damping: 18, stiffness: 220, delay }}
      href={`${EXPLORER_URL}/tx/${tx.hash}`}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-card2/60"
    >
      <TokenAvatar address={tx.token} symbol={symbol} logo={logo} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
          <span className="font-mono text-faint">{shortAddr(tx.user)}</span>
          <span className="text-faint">
            {tx.kind === "buy" ? "bought on PonsFamily / PonsPool" : tx.kind === "sell" ? "sold on PonsFamily / PonsPool" : tx.kind === "zap" ? "zapped on PonsPool" : "liquidity added on PonsPool"}
          </span>
          <span className="truncate">{name}</span>
          <span className="font-mono text-[11px] text-muted">${symbol}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] text-faint">
          {txTime(tx.timestamp)} · {tx.kind === "buy" ? "spent" : tx.kind === "sell" ? "received" : "+"} {fmtWei(tx.ethIn, 18)} ETH · {tx.kind === "sell" ? "−" : "+"}{fmtWei(tx.tokenIn, decimals)} {symbol}
        </div>
      </div>
      <span className="flex items-center gap-1 font-mono text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        view <IconExternal size={11} />
      </span>
    </motion.a>
  );
}

export function TransactionFeed() {
  const rows = useLiveTransactions(40);
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 5);

  return (
    <section className="relative mt-16 sm:mt-20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-accent uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-accent vip-pulse" />
            public ledger
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">platform activity</h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted">Confirmed $PONSPOOL trades and liquidity activity made through PonsPool, visible across every browser.</p>
        </div>
        <span className="flex w-fit items-center gap-1.5 rounded-full border border-line bg-card/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-accent vip-pulse" />
          {rows.length ? `${Math.min(rows.length, 5)} latest ${Math.min(rows.length, 5) === 1 ? "transaction" : "transactions"}` : "awaiting first post"}
        </span>
      </div>

      <div className="frost mt-6 overflow-hidden rounded-3xl border border-line shadow-(--shadow-soft)">
        {rows.length === 0 ? (
          <div className="relative flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accentsoft text-accent">
              <IconDropletPlus size={21} />
            </div>
            <div>
              <p className="font-display text-base font-semibold text-ink">the pond is quiet</p>
              <p className="mt-1 font-mono text-[11px] text-faint">be the first to make a confirmed $PONSPOOL trade or liquidity post.</p>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            <div className="divide-y divide-linesoft/70 p-2">
              {visibleRows.map((tx, i) => <TxRow key={tx.hash} tx={tx} delay={i * 0.03} />)}
            </div>
          </AnimatePresence>
        )}
      </div>
      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mx-auto mt-4 flex items-center gap-2 rounded-full border border-line bg-card/70 px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-accent/40 hover:text-ink"
          aria-expanded={expanded}
        >
          {expanded ? "show latest 5" : `view all ${rows.length}`}
          <IconChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------ protocol strip */

const STEPS = [
  {
    n: "01",
    icon: <IconDropletPlus size={20} />,
    title: "deposit & pair",
    body: "choose the pool token. only Robinhood ETH enters the Uniswap position.",
    accent: "text-accent",
    bg: "bg-accentsoft",
  },
  {
    n: "02",
    icon: <IconFlame size={20} />,
    title: "burn permanently",
    body: "lp goes straight to 0x…dead. no locker and no custody.",
    accent: "text-coin",
    bg: "bg-coinsoft",
  },
  {
    n: "03",
    icon: <IconShield size={20} />,
    title: "holder gated",
    body: "hold the $ponspool tier. zero protocol tax, forever.",
    accent: "text-vip",
    bg: "bg-accentsoft",
  },
];

export function ProtocolStrip() {
  return (
    <section className="relative mt-16 sm:mt-20">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">how the pond works</h2>
        <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">three moves. that's it.</span>
      </div>

      <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
        {/* connector line, desktop */}
        <div className="absolute top-[46px] right-[12%] left-[12%] hidden h-px bg-line sm:block" />
        {STEPS.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: i * 0.08 }}
            whileHover={{ y: -4 }}
            className="group relative rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) transition-shadow hover:shadow-(--shadow-card)"
          >
            <div className="flex items-center justify-between">
              <span className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full ${s.bg} ${s.accent}`}>
                {s.icon}
              </span>
              <span className="font-mono text-[11px] text-faint">{s.n}</span>
            </div>
            <div className="mt-4 font-display text-[15px] font-semibold text-ink">{s.title}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{s.body}</p>
            <div className="mt-4 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-faint uppercase transition-colors group-hover:text-accent">
              {i === 0 ? <IconCoins size={12} /> : i === 1 ? <IconClock size={12} /> : <IconZap size={12} />}
              {i === 0 ? "direct to router" : i === 1 ? "automatic delivery" : "checked on-chain"}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

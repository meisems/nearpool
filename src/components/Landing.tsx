import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { explorerTxUrl } from "../config/near";
import { fetchActivity, type ActivityPost } from "../lib/activity";
import { fmtAmount, shortAccount } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import {
  IconArrowRight,
  IconChevronDown,
  IconClock,
  IconCoins,
  IconDropletPlus,
  IconExternal,
  IconLayers,
  IconShield,
  IconZap,
} from "./icons";

function txTime(timestamp?: number): string {
  if (!timestamp) return "confirmed on-chain";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

/* ------------------------------------------------ hero */

export function Hero({ onInject, onSwap }: { onInject: () => void; onSwap: () => void }) {
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
            near protocol · ref finance · non-custodial
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.06 }}
            className="mt-5 font-display text-[40px] leading-[1.02] font-semibold tracking-tight text-ink sm:text-[56px] lg:text-[62px]"
          >
            Instant LP injection
            <br />
            on <span className="text-accent">NEAR.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.12 }}
            className="mt-5 max-w-md text-[15px] leading-relaxed text-muted"
          >
            One approval: storage registration, NEAR wrapping, Ref deposits and <span className="font-semibold text-coin">add_liquidity</span>,
            batched in order. Straight into Ref Finance pools, no router contract in between.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.18 }}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onInject}
              className="flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-canvas shadow-(--shadow-soft) transition-opacity hover:opacity-90 dark:text-[#06251a]"
            >
              inject liquidity <IconArrowRight size={15} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onSwap}
              className="flex h-12 items-center gap-2.5 rounded-full border border-line bg-card/80 px-6 text-sm font-semibold text-ink transition-all hover:border-coin/60"
            >
              <TokenAvatar size={20} /> swap on Ref
            </motion.button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] text-faint"
          >
            <span>v2.ref-finance.near</span>
            <span>·</span>
            <span>exact bigint math</span>
            <span>·</span>
            <span>you keep the LP shares</span>
          </motion.div>
        </div>

        {/* the pool */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", damping: 15, stiffness: 200, delay: 0.15 }}
          className="relative mx-auto hidden aspect-square w-full max-w-[360px] items-center justify-center lg:flex"
        >
          {[0, 1.5, 3].map((d) => (
            <span key={d} className="pond-ring absolute inset-0 rounded-full border border-accent/20" style={{ animationDelay: `${d}s` }} />
          ))}
          <div className="absolute inset-[12%] rounded-full border border-line bg-card/40" />
          <div className="absolute inset-[26%] rounded-full border border-linesoft bg-card/60 shadow-(--shadow-soft)" />
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} className="relative z-10">
            <TokenAvatar size={110} className="shadow-(--shadow-pop)" />
          </motion.div>
          <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 rounded-full border border-line bg-card/80 px-3.5 py-1.5 font-mono text-[10.5px] text-muted backdrop-blur-md">
            the pool. it deepens.
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------ transaction feed */

function TxRow({ post, delay }: { post: ActivityPost; delay: number }) {
  return (
    <motion.a
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", damping: 18, stiffness: 220, delay }}
      href={explorerTxUrl(post.hash)}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-card2/60"
    >
      <span className="flex shrink-0 -space-x-2">
        {post.tokenIds.slice(0, 2).map((id) => (
          <TokenAvatar key={id} tokenId={id} size={26} />
        ))}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] font-medium text-ink">
          <span className="font-mono text-faint">{shortAccount(post.accountId)}</span>
          <span className="text-faint">added liquidity to</span>
          <span>{post.symbols.join(" / ")}</span>
          <span className="font-mono text-[11px] text-muted">#{post.poolId}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
          {txTime(post.timestamp)} ·{" "}
          {post.amounts.map((amount, i) => `+${fmtAmount(BigInt(amount), post.decimals[i] ?? 24)} ${post.symbols[i] ?? ""}`).join(" · ")}
        </div>
      </div>
      <span className="flex items-center gap-1 font-mono text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        view <IconExternal size={11} />
      </span>
    </motion.a>
  );
}

export function TransactionFeed() {
  const { data: rows = [] } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: ({ signal }) => fetchActivity(signal),
    refetchInterval: 15_000,
  });
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
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted">Liquidity injections made through nearpool, each re-verified against NEAR RPC before it's listed.</p>
        </div>
        <span className="flex w-fit items-center gap-1.5 rounded-full border border-line bg-card/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-accent vip-pulse" />
          {rows.length ? `${Math.min(rows.length, 5)} latest ${Math.min(rows.length, 5) === 1 ? "injection" : "injections"}` : "awaiting first injection"}
        </span>
      </div>

      <div className="frost mt-6 overflow-hidden rounded-3xl border border-line shadow-(--shadow-soft)">
        {rows.length === 0 ? (
          <div className="relative flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accentsoft text-accent">
              <IconDropletPlus size={21} />
            </div>
            <div>
              <p className="font-display text-base font-semibold text-ink">the pool is quiet</p>
              <p className="mt-1 font-mono text-[11px] text-faint">be the first confirmed injection on the ledger.</p>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            <div className="divide-y divide-linesoft/70 p-2">
              {visibleRows.map((post, i) => <TxRow key={post.hash} post={post} delay={i * 0.03} />)}
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
    icon: <IconShield size={20} />,
    title: "storage & wrap",
    body: "missing NEP-145 registrations are added and native NEAR is wrapped to wNEAR — only when needed.",
    accent: "text-accent",
    bg: "bg-accentsoft",
    foot: "checked on-chain",
    footIcon: <IconZap size={12} />,
  },
  {
    n: "02",
    icon: <IconCoins size={20} />,
    title: "deposit to Ref",
    body: "ft_transfer_call moves each leg into your Ref internal balance. existing deposits are spent first.",
    accent: "text-coin",
    bg: "bg-coinsoft",
    foot: "one wallet approval",
    footIcon: <IconClock size={12} />,
  },
  {
    n: "03",
    icon: <IconLayers size={20} />,
    title: "inject LP",
    body: "add_liquidity with slippage-guarded min_amounts. LP shares land in your Ref account.",
    accent: "text-vip",
    bg: "bg-accentsoft",
    foot: "direct to v2.ref-finance.near",
    footIcon: <IconCoins size={12} />,
  },
];

export function ProtocolStrip() {
  return (
    <section className="relative mt-16 sm:mt-20">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">how the pool works</h2>
        <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">three moves. one signature.</span>
      </div>

      <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
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
              <span className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full ${s.bg} ${s.accent}`}>{s.icon}</span>
              <span className="font-mono text-[11px] text-faint">{s.n}</span>
            </div>
            <div className="mt-4 font-display text-[15px] font-semibold text-ink">{s.title}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{s.body}</p>
            <div className="mt-4 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-faint uppercase transition-colors group-hover:text-accent">
              {s.footIcon}
              {s.foot}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

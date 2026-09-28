import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ModuleState, WalletSelector } from "@near-wallet-selector/core";
import { IconClose, IconExternal, IconLoader } from "./icons";

/**
 * Wallet chooser. Browser extensions the page can see are listed first under
 * "Detected"; each is recognized by the object it injects into the page.
 * Extensions that aren't installed get an install link (desktop only).
 */

type W = Record<string, unknown> & {
  near?: { isSender?: boolean };
  okxwallet?: { near?: unknown };
  nightly?: { near?: unknown };
  xfi?: { near?: unknown };
  bitkeep?: { near?: unknown };
};

const EXTENSION_CHECKS: Record<string, (w: W) => boolean> = {
  sender: (w) => !!w.near?.isSender,
  "okx-wallet": (w) => !!w.okxwallet?.near,
  nightly: (w) => !!w.nightly?.near,
  "meteor-wallet": (w) => w.meteorCom != null,
  "hot-wallet": (w) => w.hotExtension != null,
  "coin98-wallet": (w) => !!w.coin98,
  "math-wallet": (w) => !!w.nearWalletApi,
  "welldone-wallet": (w) => !!w.dapp,
  xdefi: (w) => !!w.xfi?.near,
  narwallets: (w) => !!w.narwallets,
  "bitget-wallet": (w) => !!w.bitkeep?.near,
};

/** Wallets that only exist as a browser extension (no web or app fallback). */
const EXTENSION_ONLY = new Set(["sender", "okx-wallet", "coin98-wallet", "math-wallet", "welldone-wallet", "xdefi", "narwallets", "bitget-wallet"]);

const TAGS: Record<string, string> = {
  "my-near-wallet": "Web",
  "intear-wallet": "Web",
  "meteor-wallet": "Web",
  "hot-wallet": "App",
  "here-wallet": "App",
  nightly: "App",
  "wallet-connect": "QR code",
};

export function detectedExtensions(): Set<string> {
  const w = window as unknown as W;
  return new Set(Object.entries(EXTENSION_CHECKS).filter(([, check]) => check(w)).map(([id]) => id));
}

function WalletRow({
  module,
  tag,
  tone,
  busy,
  disabled,
  onClick,
  href,
}: {
  module: ModuleState;
  tag?: string;
  tone?: "accent" | "muted";
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <img src={module.metadata.iconUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink">{module.metadata.name}</span>
      {busy ? (
        <IconLoader size={16} className="animate-spin text-accent" />
      ) : tag ? (
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            tone === "accent" ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted"
          }`}
        >
          {tag}
          {href && <IconExternal size={10} />}
        </span>
      ) : null}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-card2 disabled:opacity-50";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {body}
    </button>
  );
}

export function WalletPicker({ selector, open, onClose }: { selector: WalletSelector | null; open: boolean; onClose: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-detect each time the picker opens, so an extension installed or
  // unlocked after page load still shows up.
  const [detected, setDetected] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!open) return;
    setDetected(detectedExtensions());
    setError(null);
    // A wallet abandoned mid-connect (e.g. a QR window closed) never settles; don't lock the list.
    setPending(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const groups = useMemo(() => {
    if (!selector) return { found: [], wallets: [], install: [], recent: null as string | null };
    const state = selector.store.getState();
    const recent = state.recentlySignedInWallets[0] ?? null;
    const usable = state.modules.filter((m) => !m.metadata.deprecated && m.type !== "hardware" && m.type !== "instant-link");
    const byRecent = (a: ModuleState, b: ModuleState) => Number(b.id === recent) - Number(a.id === recent);
    const found = usable.filter((m) => detected.has(m.id)).sort(byRecent);
    const wallets = usable.filter((m) => !detected.has(m.id) && !EXTENSION_ONLY.has(m.id) && m.metadata.available).sort(byRecent);
    const install = usable.filter((m) => !detected.has(m.id) && EXTENSION_ONLY.has(m.id));
    return { found, wallets, install, recent };
  }, [selector, detected]);

  const connect = async (module: ModuleState) => {
    setPending(module.id);
    setError(null);
    try {
      const wallet = await module.wallet();
      const signIn = wallet.signIn as (params: Record<string, unknown>) => Promise<unknown>;
      if (wallet.type === "bridge") await signIn({ qrCodeModal: true });
      else if (wallet.type === "browser") {
        const meta = wallet.metadata as { successUrl?: string; failureUrl?: string };
        await signIn({ successUrl: meta.successUrl, failureUrl: meta.failureUrl });
      } else await signIn({});
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/reject|cancel|closed/i.test(message)) setError(`${module.metadata.name}: ${message}`);
    } finally {
      setPending(null);
    }
  };

  const tagFor = (m: ModuleState) => (m.id === groups.recent ? "Last used" : TAGS[m.id]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:px-4"
        >
          <motion.div
            role="dialog"
            aria-label="Connect a wallet"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 24, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-[400px] flex-col overflow-hidden rounded-t-3xl border border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-(--shadow-pop) sm:rounded-3xl"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="font-display text-base font-semibold text-ink">Connect a wallet</div>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-faint transition-colors hover:text-ink">
                <IconClose size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {groups.found.length > 0 && (
                <Section title="Detected">
                  {groups.found.map((m) => (
                    <WalletRow key={m.id} module={m} tag={m.id === groups.recent ? "Last used" : "Detected"} tone="accent" busy={pending === m.id} disabled={!!pending} onClick={() => void connect(m)} />
                  ))}
                </Section>
              )}
              {groups.wallets.length > 0 && (
                <Section title={groups.found.length ? "More wallets" : "Wallets"}>
                  {groups.wallets.map((m) => (
                    <WalletRow key={m.id} module={m} tag={tagFor(m)} tone={m.id === groups.recent ? "accent" : "muted"} busy={pending === m.id} disabled={!!pending} onClick={() => void connect(m)} />
                  ))}
                </Section>
              )}
              {groups.install.length > 0 && (
                <Section title="Extensions">
                  {groups.install.map((m) => (
                    <WalletRow key={m.id} module={m} tag="Install" href={(m.metadata as { downloadUrl?: string }).downloadUrl} />
                  ))}
                </Section>
              )}
              {error && <p className="mx-3 mt-2 rounded-lg bg-card2 px-3 py-2 text-xs break-words text-danger">{error}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <div className="px-3 pt-2 pb-1 text-xs font-medium text-faint">{title}</div>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CreatorTerminal } from "../components/CreatorTerminal";
import { Hero, ProtocolStrip, TransactionFeed } from "../components/Landing";
import { SwapCard } from "../components/SwapCard";
import { TokenAvatar } from "../components/TokenAvatar";
import { IconArrowRight, IconDropletPlus, IconShield, IconSwap, IconZap } from "../components/icons";

function PageHeader({ eyebrow, title, body }: { eyebrow: string; title: ReactNode; body: ReactNode }) {
  return (
    <header className="max-w-3xl">
      <div className="inline-flex items-center gap-2 rounded-full border border-line bg-card/70 px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.14em] text-muted uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-vip vip-pulse" />
        {eyebrow}
      </div>
      <h1 className="mt-5 font-display text-[40px] leading-[1.03] font-semibold tracking-tight text-ink sm:text-[56px]">{title}</h1>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">{body}</p>
    </header>
  );
}

export function LandingPage({ onInject, onSwap }: { onInject: () => void; onSwap: () => void }) {
  return (
    <div>
      <Hero onInject={onInject} onSwap={onSwap} />
      <TransactionFeed />
      <ProtocolStrip />

      <section className="relative mt-16 grid gap-3 sm:mt-20 sm:grid-cols-2">
        <Link to="/docs" className="group rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) transition-transform hover:-translate-y-1">
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">start here</span>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">Read the protocol docs</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">Understand storage registration, the Ref deposit model, the exact calls in each batch, and the math behind min_amounts.</p>
          <span className="mt-5 flex items-center gap-2 text-xs font-semibold text-accent">open docs <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
        </Link>
        <Link to="/how-it-works" className="group rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) transition-transform hover:-translate-y-1">
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">three moves</span>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">See how the pool works</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">A short walkthrough from connecting a NEAR wallet to holding Ref LP shares.</p>
          <span className="mt-5 flex items-center gap-2 text-xs font-semibold text-accent">how it works <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
        </Link>
      </section>
    </div>
  );
}

export function InjectPage({ onSwap }: { onSwap: () => void }) {
  return (
    <div>
      <PageHeader
        eyebrow="lp injector · non-custodial"
        title={<>Deepen a pool.<br /><span className="text-accent">One signature.</span></>}
        body={<>Pick a common pair or enter any Ref Finance pool id. nearpool reads the live reserves, sizes the counter asset exactly, and batches storage, wrapping, deposits and <span className="font-mono">add_liquidity</span> into one wallet approval.</>}
      />

      <section className="mt-10 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <CreatorTerminal onSwap={onSwap} />
        <aside className="space-y-3">
          <div className="rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft)">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink"><IconShield size={17} className="text-accent" /> injection pipeline</div>
            <div className="mt-5 space-y-4">
              {[
                ["01", "Checking storage", "Reads NEP-145 registrations for you and Ref on both tokens, plus your Ref account storage."],
                ["02", "Wrapping NEAR", "near_deposit on wrap.near — only when the NEAR leg exceeds your wNEAR and Ref balances."],
                ["03", "Depositing to Ref", "ft_transfer_call per token (50 TGas, 1 yocto). Existing Ref deposits are used first."],
                ["04", "Injecting LP", "add_liquidity with min_amounts at your slippage tolerance (100 TGas)."],
              ].map(([n, label, body]) => (
                <div key={n} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentsoft font-mono text-[10px] font-semibold text-accentstrong">{n}</span>
                  <div><div className="text-xs font-semibold text-ink">{label}</div><p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-line bg-card2/60 p-5">
            <div className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">missing the counter asset?</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Swap for it on Ref first — the output lands in your wallet and the injector picks it up automatically.</p>
            <button onClick={onSwap} className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent">open swap <IconArrowRight size={14} /></button>
          </div>
        </aside>
      </section>
    </div>
  );
}

export function SwapPage({ onInject }: { onInject: () => void }) {
  return (
    <div>
      <PageHeader
        eyebrow="ref instant swap · near mainnet"
        title={<>Source the pair,<br /><span className="text-coin">then fill the pool.</span></>}
        body={<>Single-hop swaps through the deepest Ref simple pool for the pair. Quotes use Ref's exact fee formula on live reserves, your wallet signs, and the output is sent straight back to you.</>}
      />

      <section className="mt-10 grid grid-cols-1 items-start gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <aside className="order-2 space-y-3 lg:order-1">
          <div className="rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft)">
            <div className="flex items-center gap-3">
              <TokenAvatar size={38} />
              <div><div className="text-sm font-semibold text-ink">NEAR in, anything out</div><div className="font-mono text-[10px] text-faint">wrap + swap in one approval</div></div>
            </div>
            <div className="mt-5 grid gap-2 text-xs text-muted">
              <div className="flex items-center gap-2"><IconZap size={14} className="text-coin" /> min_amount_out enforced on-chain</div>
              <div className="flex items-center gap-2"><IconShield size={14} className="text-accent" /> output registration handled for you</div>
              <div className="flex items-center gap-2"><IconSwap size={14} className="text-muted" /> routed through v2.ref-finance.near</div>
            </div>
          </div>
          <button onClick={onInject} className="group block w-full rounded-3xl border border-line bg-card2/60 p-5 text-left transition-colors hover:border-accent/40">
            <div className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">what happens next</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Take both legs to the injector and add them to the pool in one batch.</p>
            <span className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent"><IconDropletPlus size={14} /> open the injector <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
          </button>
        </aside>
        <div className="order-1 lg:order-2"><SwapCard onInject={onInject} /></div>
      </section>
    </div>
  );
}

type InfoKind = "how-it-works" | "docs" | "terms" | "privacy";

const infoContent: Record<InfoKind, { eyebrow: string; title: ReactNode; intro: string; sections: Array<{ heading: string; body: ReactNode }> }> = {
  "how-it-works": {
    eyebrow: "how it works",
    title: <>A clear path from<br /><span className="text-accent">wallet to pool.</span></>,
    intro: "nearpool is a non-custodial interface for adding liquidity to Ref Finance pools on NEAR mainnet. It prepares the exact calls; your wallet signs them.",
    sections: [
      { heading: "1. Connect a NEAR wallet", body: <>Use Meteor, HERE, Nightly or Sender through the NEAR Wallet Selector. nearpool reads balances over public RPC and never receives your keys.</> },
      { heading: "2. Choose a pool", body: <>Open <Link className="font-semibold text-accent" to="/inject">Inject LP</Link> and pick a common pair (resolved on-chain to the deepest Ref simple pool) or type any pool id. Enter one side; the other is computed from live reserves as ΔB = ΔA × ReserveB / ReserveA.</> },
      { heading: "3. Approve one batch", body: <>nearpool checks storage registrations, wraps NEAR if needed, deposits both legs into Ref with ft_transfer_call and calls add_liquidity — ordered transactions behind a single wallet approval. Progress is read back from the chain as each step lands.</> },
      { heading: "4. Hold your LP shares", body: <>Shares are minted to your account inside Ref Finance. Manage or withdraw them any time from Ref's own interface. Need the counter asset first? Use the <Link className="font-semibold text-accent" to="/swap">swap page</Link>.</> },
    ],
  },
  docs: {
    eyebrow: "docs · protocol reference",
    title: <>The pool, in<br /><span className="text-accent">plain language.</span></>,
    intro: "Exact contract calls, storage rules and math used by nearpool.",
    sections: [
      { heading: "Contracts", body: <ul className="list-disc space-y-2 pl-5"><li>Ref Finance exchange: <span className="font-mono">v2.ref-finance.near</span></li><li>Wrapped NEAR: <span className="font-mono">wrap.near</span></li><li>Explorer: nearblocks.io · RPC: rpc.mainnet.near.org with public fallbacks</li></ul> },
      { heading: "Storage (NEP-145)", body: <>Before depositing, nearpool registers you on wrap.near when wrapping for the first time, registers Ref on a token contract that doesn't know it yet (<span className="font-mono">registration_only: true</span>, the token's own minimum), and registers or tops up your Ref account storage. Non-whitelisted tokens are added to your Ref account with <span className="font-mono">register_tokens</span>. Unused storage collateral is refunded or stays withdrawable.</> },
      { heading: "Batch layout", body: <>Calls to the same contract share a transaction: Ref storage → token A (storage, near_deposit, ft_transfer_call at 50 TGas) → token B → add_liquidity at 100 TGas. Every token call attaches 1 yoctoNEAR as NEAR's full-access confirmation. First-time LPs attach 0.01 NEAR to add_liquidity for the new share record; Ref refunds whatever isn't used.</> },
      { heading: "Math", body: <>All amounts are integers in the token's smallest unit (1 NEAR = 10^24 yoctoNEAR). Share previews mirror Ref's own formula — shares = min(amountᵢ × totalShares / reserveᵢ) — and min_amounts reduce the expected used amounts by your slippage tolerance. Leftover rounding dust stays in your Ref deposit.</> },
      { heading: "Safety checklist", body: <ul className="list-disc space-y-2 pl-5"><li>Review every transaction in your wallet before approving.</li><li>Seeding an empty pool sets its price — check the ratio twice.</li><li>Never share a seed phrase or private key.</li><li>Verify confirmed transactions on nearblocks.io.</li></ul> },
    ],
  },
  terms: {
    eyebrow: "terms of use",
    title: <>Use the pool<br /><span className="text-accent">with intention.</span></>,
    intro: "These terms describe the basic rules for using the nearpool interface. They are product terms, not financial, legal, tax, or investment advice.",
    sections: [
      { heading: "The interface", body: <>nearpool provides software that helps users interact with Ref Finance and NEP-141 token contracts on NEAR. You are responsible for the wallet, assets, storage deposits, gas and transactions you initiate.</> },
      { heading: "No custody or guarantee", body: <>nearpool does not custody your assets and cannot reverse, cancel, or guarantee blockchain transactions. Quotes, balances, and availability may change without notice.</> },
      { heading: "Liquidity risk", body: <>Providing liquidity exposes you to price movement between the pooled assets (impermanent loss), smart-contract risk in Ref Finance and the token contracts, and the risks of any token you choose to pool.</> },
      { heading: "Third-party networks", body: <>NEAR, Ref Finance, wallets, RPC providers and explorers are third-party systems. Delays, outages, fee changes, and contract risks may affect your experience.</> },
      { heading: "Changes", body: <>We may update these terms and the interface as the product evolves. Continued use after an update means you accept the revised version. If you do not agree, stop using the interface.</> },
    ],
  },
  privacy: {
    eyebrow: "privacy policy",
    title: <>Minimal data.<br /><span className="text-accent">Maximum clarity.</span></>,
    intro: "nearpool is designed around wallet-based interaction. This policy explains the categories of information the interface may process and why.",
    sections: [
      { heading: "Wallet and transaction data", body: <>When you connect, your public NEAR account ID, balances, storage registrations and Ref deposits are read from public RPC. Confirmed injections may be listed on the public activity feed by transaction hash and account ID. nearpool never requests or stores private keys or seed phrases.</> },
      { heading: "Local preferences", body: <>Theme choice and the wallet selector's session (which wallet you last used) are stored locally in your browser. Clearing site data removes them.</> },
      { heading: "Service providers", body: <>Wallet providers, RPC endpoints, explorers and hosting providers may process technical request data according to their own policies. Review their terms before connecting.</> },
      { heading: "Data choices", body: <>You can disconnect your wallet, clear local site data, and stop using the interface at any time. Because blockchain records are public and distributed, confirmed on-chain data cannot be deleted by nearpool.</> },
      { heading: "Contact and updates", body: <>For privacy questions, use the project contact channel listed in the repository or deployment environment. We may update this policy when the product or integrations change.</> },
    ],
  },
};

export function InfoPage({ kind }: { kind: InfoKind }) {
  const content = infoContent[kind];
  const outline = content.sections.map((section) => section.heading);
  return (
    <div>
      <PageHeader eyebrow={content.eyebrow} title={content.title} body={content.intro} />
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[180px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-32 rounded-3xl border border-line bg-card/70 p-4">
            <div className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">on this page</div>
            <nav className="mt-4 space-y-2">
              {outline.map((heading) => <a key={heading} href={`#${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="block text-[11px] leading-snug text-muted transition-colors hover:text-ink">{heading}</a>)}
            </nav>
          </div>
        </aside>
        <article className="space-y-3">
          {content.sections.map((section, index) => {
            const id = section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            return (
              <section key={section.heading} id={id} className="scroll-mt-32 rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) sm:p-7">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentsoft font-mono text-[10px] font-semibold text-accentstrong">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0"><h2 className="font-display text-lg font-semibold tracking-tight text-ink">{section.heading}</h2><div className="mt-3 text-sm leading-7 text-muted">{section.body}</div></div>
                </div>
              </section>
            );
          })}
        </article>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CreatorTerminal } from "../components/CreatorTerminal";
import { Hero, ProtocolStrip, TransactionFeed } from "../components/Landing";
import { SwapCard } from "../components/SwapCard";
import { TokenAvatar } from "../components/TokenAvatar";
import { IconArrowRight, IconShield, IconZap } from "../components/icons";
import { PONSPOOL_TOKEN_ADDRESS } from "../lib/constants";

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

export function LandingPage({ onLaunch, onBuy }: { onLaunch: () => void; onBuy: () => void }) {
  return (
    <div>
      <Hero onLaunch={onLaunch} onBuy={onBuy} />
      <TransactionFeed />
      <ProtocolStrip />

      <section className="relative mt-16 grid gap-3 sm:mt-20 sm:grid-cols-2">
        <Link to="/docs" className="group rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) transition-transform hover:-translate-y-1">
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">start here</span>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">Read the protocol docs</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">Understand the router, holder tier, liquidity destinations, and the assumptions behind the pond.</p>
          <span className="mt-5 flex items-center gap-2 text-xs font-semibold text-accent">open docs <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
        </Link>
        <Link to="/how-it-works" className="group rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft) transition-transform hover:-translate-y-1">
          <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">three moves</span>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">See how the pond works</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">A short walkthrough for token creators and holders, from connecting a wallet to locking or burning LP.</p>
          <span className="mt-5 flex items-center gap-2 text-xs font-semibold text-accent">how it works <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
        </Link>
      </section>
    </div>
  );
}

export function LaunchPoolPage({ onBuy, onConnect }: { onBuy: () => void; onConnect: () => void }) {
  return (
    <div>
      <PageHeader
        eyebrow="launch pool · non-custodial"
        title={<>Seed a pool.<br /><span className="text-accent">Keep sovereignty.</span></>}
        body={<>The launch pool terminal creates a single-sided Uniswap liquidity position using only Robinhood ETH. The selected token identifies the pool; no creator-token transfer is required. Every LP position is burned permanently.</>}
      />

      <section className="mt-10 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <CreatorTerminal onBuy={onBuy} onConnect={onConnect} />
        <aside className="space-y-3">
          <div className="rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft)">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink"><IconShield size={17} className="text-accent" /> launch flow</div>
            <div className="mt-5 space-y-4">
              {[
                ["01", "Connect", "Use a browser wallet or WalletConnect."],
                ["02", "Configure", "Enter your token, pair amount, and preferred LP destination."],
                ["03", "Confirm", "Review the summary, then sign the direct Uniswap transactions. LP is burned permanently."],
              ].map(([n, label, body]) => (
                <div key={n} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentsoft font-mono text-[10px] font-semibold text-accentstrong">{n}</span>
                  <div><div className="text-xs font-semibold text-ink">{label}</div><p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-line bg-card2/60 p-5">
            <div className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">need the token first?</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Buy $PONSPOOL on the native swap, then return here when you are ready to thicken the pond.</p>
            <button onClick={onBuy} className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent">buy $PONSPOOL <IconArrowRight size={14} /></button>
          </div>
        </aside>
      </section>
    </div>
  );
}

export function BuyPage({ onConnect }: { onConnect: () => void }) {
  return (
    <div>
      <PageHeader
        eyebrow="native swap · robinhood chain"
        title={<>Buy the token that<br /><span className="text-coin">thickens the pond.</span></>}
        body={<>Swap ETH for <span className="font-semibold text-coin">$PONSPOOL</span> through the native route. Quotes are reserve-based, the wallet signs the transaction, and the interface never takes custody of your assets.</>}
      />

      <section className="mt-10 grid grid-cols-1 items-start gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <aside className="order-2 space-y-3 lg:order-1">
          <div className="rounded-3xl border border-line bg-card/80 p-5 shadow-(--shadow-soft)">
            <div className="flex items-center gap-3">
              <TokenAvatar address={PONSPOOL_TOKEN_ADDRESS} size={38} />
              <div><div className="text-sm font-semibold text-ink">$PONSPOOL</div><div className="font-mono text-[10px] text-faint">platform token · holder tier</div></div>
            </div>
            <div className="mt-5 grid gap-2 text-xs text-muted">
              <div className="flex items-center gap-2"><IconZap size={14} className="text-coin" /> unlocks zero protocol tax</div>
              <div className="flex items-center gap-2"><IconShield size={14} className="text-accent" /> routes through the pond contracts</div>
              <div className="flex items-center gap-2"><IconArrowRight size={14} className="text-muted" /> holds on Robinhood Chain</div>
            </div>
          </div>
          <Link to="/how-it-works" className="group block rounded-3xl border border-line bg-card2/60 p-5 transition-colors hover:border-accent/40">
            <div className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">what happens next</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Learn how the holder tier changes launch-pool fees and how liquidity destinations are handled.</p>
            <span className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent">read the walkthrough <IconArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
          </Link>
        </aside>
        <div className="order-1 lg:order-2"><SwapCard onConnect={onConnect} /></div>
      </section>
    </div>
  );
}

type InfoKind = "how-it-works" | "docs" | "terms" | "privacy";

const infoContent: Record<InfoKind, { eyebrow: string; title: ReactNode; intro: string; sections: Array<{ heading: string; body: ReactNode }> }> = {
  "how-it-works": {
    eyebrow: "how it works",
    title: <>A clear path from<br /><span className="text-accent">wallet to pond.</span></>,
    intro: "PonsPool is a non-custodial flow for creating liquidity positions and routing swaps on Robinhood Chain. The interface guides you; your wallet remains the signer.",
    sections: [
      { heading: "1. Connect a wallet", body: <>Connect a browser wallet or use WalletConnect. PonsPool reads balances and network state so it can show an accurate quote; it does not receive your private keys.</> },
      { heading: "2. Launch a pool", body: <>Open <Link className="font-semibold text-accent" to="/launch-pool">Launch pool</Link>, enter your token and ETH amounts, and select the LP destination. Uniswap receives only Robinhood ETH for the selected token pool. Any protocol cut is sent to the fee vault for buyback and burn, and shown as burned in the interface.</> },
      { heading: "3. Burn LP permanently", body: <>After the position is created, the LP position is sent directly to the unrecoverable burn address. There is no locker and no PonsPool custody step in between.</> },
      { heading: "4. Buy and hold $PONSPOOL", body: <>The platform token can be purchased on the <Link className="font-semibold text-accent" to="/buy">buy page</Link>. Holding the required tier waives the protocol cut for eligible pool launches.</> },
    ],
  },
  docs: {
    eyebrow: "docs · protocol reference",
    title: <>The pond, in<br /><span className="text-accent">plain language.</span></>,
    intro: "This reference explains the product surfaces, contract flow, and operational assumptions behind PonsPool.",
    sections: [
      { heading: "Product surfaces", body: <>The landing page shows protocol activity and metrics. Launch pool opens the creator terminal. Buy $PONSPOOL opens the reserve-based swap. All three experiences share the same wallet session and network target.</> },
      { heading: "Holder tier", body: <>The holder tier is determined by the balance of the platform token in the connected wallet. Eligible holders receive the zero-cut route described in the launch terminal. The UI surfaces the required amount before a transaction is prepared.</> },
      { heading: "Network and routing", body: <>PonsPool targets Robinhood Chain, chain ID 4663. Uniswap V3 and V4 receive the ETH-only liquidity injection directly. Every LP position is sent to the burn address, while protocol cuts go to the configured fee vault for buyback and burn. Always confirm the chain, recipient, and ETH amount in your wallet before signing.</> },
      { heading: "Safety checklist", body: <ul className="list-disc space-y-2 pl-5"><li>Verify you are on the intended network.</li><li>Review every wallet prompt before signing.</li><li>Never share a seed phrase or private key.</li><li>Use the explorer link to validate confirmed transactions.</li></ul> },
    ],
  },
  terms: {
    eyebrow: "terms of use",
    title: <>Use the pond<br /><span className="text-accent">with intention.</span></>,
    intro: "These terms describe the basic rules for using the PonsPool interface. They are product terms, not financial, legal, tax, or investment advice.",
    sections: [
      { heading: "The interface", body: <>PonsPool provides software that helps users interact with supported blockchain contracts. You are responsible for the wallet, network, assets, approvals, gas, and transactions you initiate.</> },
      { heading: "No custody or guarantee", body: <>PonsPool does not custody your assets and cannot reverse, cancel, or guarantee blockchain transactions. Quotes, balances, metrics, and availability may change without notice.</> },
      { heading: "Acceptable use", body: <>Do not use the interface to violate applicable law, exploit a contract, interfere with the service, impersonate another person, or upload malicious content. You must be legally permitted to use the service in your jurisdiction.</> },
      { heading: "Third-party networks", body: <>Blockchain networks, wallets, RPC providers, explorers, and token contracts are third-party systems. Delays, outages, forks, fee changes, and smart-contract risks may affect your experience.</> },
      { heading: "Changes", body: <>We may update these terms and the interface as the protocol evolves. Continued use after an update means you accept the revised version. If you do not agree, stop using the interface.</> },
    ],
  },
  privacy: {
    eyebrow: "privacy policy",
    title: <>Minimal data.<br /><span className="text-accent">Maximum clarity.</span></>,
    intro: "PonsPool is designed around wallet-based interaction. This policy explains the categories of information the interface may process and why.",
    sections: [
      { heading: "Wallet and transaction data", body: <>When you connect a wallet, the public address, chain ID, balances, and transaction status may be read from the network or wallet provider. Public blockchain activity is visible by design. PonsPool does not request or store private keys or seed phrases.</> },
      { heading: "Local preferences", body: <>Theme choice, temporary session state, and interface preferences may be stored locally in your browser. Clearing site data removes these local preferences.</> },
      { heading: "Service providers", body: <>Wallet connectors, RPC endpoints, explorers, hosting providers, and analytics or error-monitoring services may process technical request data according to their own policies. Review their terms before connecting.</> },
      { heading: "Data choices", body: <>You can disconnect your wallet, clear local site data, and stop using the interface at any time. Because blockchain records are public and distributed, confirmed on-chain data cannot be deleted by PonsPool.</> },
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

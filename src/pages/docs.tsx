import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  DCL_CONTRACT_ID,
  FEE_AMOUNT,
  FEE_ENABLED,
  FEE_RECEIVER_ID,
  NEAR_DECIMALS,
  REF_FINANCE_CONTRACT_ID,
  RHEA_APP_URL,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { fmtAmount } from "../lib/format";
import { Card } from "../components/ui";

/** User guide at /docs. Mirrors docs/USER_GUIDE.md in the repository. */

const FEE = `${fmtAmount(FEE_AMOUNT, NEAR_DECIMALS)} NEAR`;

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 marker:text-faint">{children}</ol>;
}
function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 marker:text-faint">{children}</ul>;
}
function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-card2 px-3 py-2 text-[13px] text-muted">{children}</p>;
}
function Table({ head, rows }: { head: [string, string, string?]; rows: Array<[ReactNode, ReactNode, ReactNode?]> }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[420px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-linesoft text-faint">
            {head.filter(Boolean).map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-linesoft/60 align-top last:border-0">
              {r.slice(0, head.filter(Boolean).length).map((c, j) => <td key={j} className={`py-1.5 pr-3 ${j === 0 ? "text-ink" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>;
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">{children}</a>
);

const SECTIONS: Array<{ id: string; title: string; body: ReactNode }> = [
  {
    id: "quick-start",
    title: "Quick start",
    body: (
      <Steps>
        <li><B>Connect a wallet.</B> Click <B>Connect</B> (top right). Extensions installed in your browser are listed first under <B>Detected</B>.</li>
        <li><B>Find the token.</B> On the <Link to="/" className="text-accent hover:underline">home page</Link>, paste its contract address (e.g. <code>npaid-831d2b.nearpaid.near</code>), a nearblocks or Rhea link, or a pool ID such as <code>#8728</code>. Click the result.</li>
        <li><B>Pick a pool.</B> The token page lists its pools as chips (e.g. <code>NEAR #8728</code>). No pool yet? It offers <B>Create pool</B>.</li>
        <li><B>Add liquidity.</B> <B>Two tokens</B> if you hold both, <B>NEAR only</B> if you only have NEAR. Enter an amount, check the details, approve once.</li>
        <li><B>Check your position.</B> The token page shows your share. Click the pool number (<code>#8728 ↗</code>) to open it on Rhea.</li>
      </Steps>
    ),
  },
  {
    id: "wallet",
    title: "Connect a wallet",
    body: (
      <>
        <Steps>
          <li>Click <B>Connect</B>.</li>
          <li>
            Choose a wallet:
            <Bullets>
              <li><B>Detected</B>: extensions found in this browser (Sender, Meteor, HOT, Nightly, OKX, Coin98, Math, WELLDONE, Ctrl/XDEFI, Narwallets, Bitget).</li>
              <li><B>More wallets</B>: no extension needed. Web (MyNearWallet, Meteor, Intear), App (HOT, HERE, Nightly), QR code (WalletConnect, scan with a phone wallet).</li>
              <li><B>Extensions</B> (desktop only): wallets you don't have yet, with an <B>Install</B> link.</li>
            </Bullets>
          </li>
          <li>Approve the connection in the wallet.</li>
        </Steps>
        <Bullets>
          <li>On phones only phone-compatible wallets are listed; extensions don't exist there.</li>
          <li>Connecting or disconnecting in one tab updates your other nearpool tabs.</li>
          <li>To disconnect: click your account (top right) → <B>Disconnect</B>.</li>
        </Bullets>
      </>
    ),
  },
  {
    id: "find",
    title: "Find a token",
    body: (
      <>
        <Table
          head={["You paste", "Example"]}
          rows={[
            ["Token contract address", <code key="a">usdt.tether-token.near</code>],
            ["Implicit (64-hex) address", <code key="b" className="break-all">17208628…6133a1</code>],
            ["Pool ID", <code key="c">8728 or #8728</code>],
            ["nearblocks link", <code key="d" className="break-all">nearblocks.io/token/usdt.tether-token.near</code>],
            ["Rhea / Ref pool link", <code key="e">app.rhea.finance/pool/8728</code>],
            ["Rhea / Ref swap link", <code key="f">app.ref.finance/#near|usdt.tether-token.near</code>],
          ]}
        />
        <p>Nothing opens by itself: click the result card or press Enter.</p>
      </>
    ),
  },
  {
    id: "two-tokens",
    title: "Add liquidity with two tokens",
    body: (
      <>
        <Steps>
          <li>Open the token page and select a pool chip.</li>
          <li>Keep the <B>Two tokens</B> tab.</li>
          <li>Type an amount on either side; the other side fills in from the pool's ratio. <B>Max</B> uses everything you can spend.</li>
          <li>
            Optional settings (sliders icon):
            <Bullets>
              <li><B>Max slippage</B>: 0.1%, 0.5% (default) or 1%. If the price moves more before your transaction lands, nothing is added.</li>
              <li><B>Use Ref balance</B>: spend tokens already in your Ref account first.</li>
              <li><B>Wrap NEAR if needed</B>: turn NEAR into wNEAR for the NEAR side.</li>
            </Bullets>
          </li>
          <li>Open <B>Pool share</B> to see LP shares, minimum amounts and every step.</li>
          <li>Click <B>Add liquidity</B> (<B>Create position</B> for an empty pool) and approve once.</li>
        </Steps>
        <p>
          What runs, only as needed: <B>storage</B> (register you on Ref and the tokens) → <B>wrap</B> (NEAR → wNEAR) → <B>deposit</B> (tokens into
          your Ref account) → <B>add</B> (<code>add_liquidity</code>){FEE_ENABLED ? <> → <B>nearpool fee</B> ({FEE}), last</> : null}.
        </p>
        <Note>Empty pool: your two amounts set the starting price. Type both sides.</Note>
      </>
    ),
  },
  {
    id: "near-only",
    title: "Add liquidity with NEAR only",
    body: (
      <>
        <p>For when you don't hold the token: part of your NEAR buys it, then both sides are added. One approval.</p>
        <Steps>
          <li>Open the token page, select a pool chip, switch to <B>NEAR only</B>.</li>
          <li>Enter a NEAR amount.</li>
          <li>Check <B>Buys</B> (how much token, for how much NEAR, and where: Ref pools like <code>#1 → #2</code> or <B>Rhea 1% pool</B>), <B>Adds</B>, <B>LP shares</B> and <B>Transactions</B>.</li>
          <li>Click <B>Add with NEAR</B> (<B>Create position with NEAR</B> for an empty pool) and approve once.</li>
        </Steps>
        <p>
          <B>The split.</B> nearpool spends just enough NEAR on the token for both sides to match the pool's price after the purchase. For an empty pool,
          half the NEAR buys the token at its market price, so the pool starts at that price.
        </p>
        <Bullets>
          <li><B>Bought on Ref pools</B> (direct or two pools in a row): the purchase and the deposit are one transaction. If the price moves past your slippage, nothing is added and your NEAR stays in your Ref balance.</li>
          <li><B>Bought on a Rhea concentrated-liquidity pool</B> (e.g. NearPaid launchpad coins): the token goes to your wallet, then both sides are deposited and added. If the purchase misses its slippage, the later steps fail and your wNEAR stays in your Ref balance.</li>
          <li><B>Leftovers</B> (about your slippage setting) stay in your Ref balance or wallet; nearpool uses Ref balances first next time.</li>
        </Bullets>
        <Note><B>"TOKEN can't be bought yet"</B>: no Ref or Rhea pool holds the token. A holder (usually its creator) must add the first liquidity with Two tokens; then NEAR only works.</Note>
      </>
    ),
  },
  {
    id: "create-pool",
    title: "Create a pool",
    body: (
      <>
        <Steps>
          <li>Open the token page. With no pool, <B>Create pool</B> shows automatically; otherwise click <B>+ New pool</B>.</li>
          <li>Choose the paired token (NEAR by default).</li>
          <li>Choose the swap fee: <B>0.05%</B>, <B>0.2%</B>, <B>0.3%</B> (default) or <B>1%</B>. Traders pay it to the pool's liquidity providers.</li>
          <li>Click <B>Create pool</B> and approve: 0.1 NEAR storage deposit (unused part refunded){FEE_ENABLED ? ` + ${FEE} nearpool fee` : ""}.</li>
          <li>Add the first liquidity: <B>Two tokens</B> (your amounts set the price) or <B>NEAR only</B> if the token already trades on Ref or Rhea.</li>
        </Steps>
        <Note>New pools don't appear in Rhea's pool list or search. Open them by link: <code>app.rhea.finance/pool/&lt;id&gt;</code>.</Note>
      </>
    ),
  },
  {
    id: "swap",
    title: "Swap",
    body: (
      <>
        <Steps>
          <li>Open <Link to="/swap" className="text-accent hover:underline">Swap</Link> (or <B>Swap</B> on a token page).</li>
          <li>Pick the tokens and type the amount you pay.</li>
          <li>Check <B>Rate</B>, <B>Min received</B>, <B>Price impact</B> and <B>Route</B>.</li>
          <li>Click <B>Swap</B> and approve.</li>
        </Steps>
        <p>
          The route is whichever pays most: one Ref pool, two in a row, or a Rhea concentrated-liquidity pool. You're registered on the output token if
          needed. Swapping to NEAR delivers wNEAR.{FEE_ENABLED ? ` Fee: ${FEE} per swap.` : ""}
        </p>
      </>
    ),
  },
  {
    id: "track",
    title: "Track tokens",
    body: (
      <Bullets>
        <li>Click <B>Track</B> (star) on a token page. <Link to="/track" className="text-accent hover:underline">Tracked</Link> shows price, change since you started tracking, pool depth and your position.</li>
        <li>Tracked tokens are saved in this browser only.</li>
      </Bullets>
    ),
  },
  {
    id: "position",
    title: "Your position & withdrawing",
    body: (
      <Bullets>
        <li>LP shares live in your Ref account, not in nearpool.</li>
        <li>To see, manage or remove liquidity, click the pool number (<code>#&lt;id&gt; ↗</code>). It opens <A href={RHEA_APP_URL}>app.rhea.finance/pool/&lt;id&gt;</A> (Rhea is Ref Finance's new name).</li>
        <li>Leftover deposits stay in your Ref account; nearpool spends them first next time, or withdraw them on Rhea.</li>
      </Bullets>
    ),
  },
  {
    id: "fees",
    title: "Fees & costs",
    body: (
      <>
        <Table
          head={["What", "Amount", "Goes to"]}
          rows={[
            ...(FEE_ENABLED
              ? [["nearpool fee", `${FEE} per swap, liquidity add or pool creation`, <span key="f"><code>{FEE_RECEIVER_ID}</code>: buyback-and-burn and platform development</span>] as [ReactNode, ReactNode, ReactNode]]
              : []),
            ["Pool swap fee", "the pool's tier, e.g. 0.3%", "liquidity providers (and Ref)"],
            ["Rhea pool fee", "e.g. 1% on NearPaid coins", "per the pool's rules"],
            ["Token registration", "≈0.00125 NEAR per token (up to 0.0125)", "refundable storage"],
            ["Ref account (first time)", "0.1 NEAR", "your Ref storage"],
            ["Ref storage top-up", "0.01 NEAR when needed", "your Ref storage"],
            ["First position in a pool", "0.01 NEAR", "LP storage, unused refunded"],
            ["Pool creation", "0.1 NEAR", "pool storage, unused refunded"],
            ["Gas", "small; 0.05 NEAR kept back", "network"],
          ]}
        />
        {FEE_ENABLED && <p>The nearpool fee is a plain NEAR transfer, listed before you sign and sent last. It's charged by this website, not by a contract.</p>}
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    body: (
      <Table
        head={["Problem", "What to do"]}
        rows={[
          ["\"TOKEN can't be bought yet\"", "No pool holds the token. The first deposit needs it (Two tokens), usually from its creator."],
          ["Pool not found on Rhea", <span key="r">Rhea's list hides small pools. Open <code>app.rhea.finance/pool/&lt;id&gt;</code> directly.</span>],
          ["\"Not enough NEAR\"", `Includes storage, ${FEE_ENABLED ? `the ${FEE} fee and ` : ""}a 0.05 NEAR gas reserve. Lower the amount.`],
          ["Slippage error", "The price moved. Retry, or raise Max slippage in settings."],
          ["A step failed midway", "Deposits that landed stay in your Ref balance. Retry; Use Ref balance spends them first."],
          ["Wallet missing on my phone", "Extensions are desktop-only. Use HOT, Meteor, MyNearWallet, Intear, HERE, Nightly or WalletConnect."],
          ["Only one side fills in", "That's the pool ratio. For an empty pool, type both amounts."],
        ]}
      />
    ),
  },
  {
    id: "contracts",
    title: "Contracts",
    body: (
      <Table
        head={["Contract", "Role"]}
        rows={[
          [<code key="r">{REF_FINANCE_CONTRACT_ID}</code>, "Ref pools: deposits, swaps, add_liquidity, pool creation"],
          [<code key="d">{DCL_CONTRACT_ID}</code>, "Rhea concentrated-liquidity pools (e.g. NearPaid coins)"],
          [<code key="w">{WRAP_NEAR_CONTRACT_ID}</code>, "wrapped NEAR (wNEAR)"],
          ...(FEE_ENABLED ? [[<code key="f">{FEE_RECEIVER_ID}</code>, "nearpool fee receiver"] as [ReactNode, ReactNode]] : []),
        ]}
      />
    ),
  },
  {
    id: "safety",
    title: "Safety",
    body: (
      <Bullets>
        <li>Non-custodial: nearpool never holds your tokens or keys; your wallet signs every transaction.</li>
        <li>Read what your wallet shows before approving; the details panel lists every step.</li>
        <li>Liquidity carries impermanent-loss and smart-contract risk. Not financial advice.</li>
      </Bullets>
    ),
  },
];

export function DocsPage() {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="font-display text-3xl font-semibold text-ink">Docs</h1>
        <p className="mt-1 text-sm text-muted">Step by step.</p>
        <ul className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 text-sm lg:flex-col lg:gap-0.5 lg:overflow-visible">
          {SECTIONS.map((s) => (
            <li key={s.id} className="shrink-0">
              <a href={`#${s.id}`} className="block rounded-lg bg-card2 px-3 py-1.5 whitespace-nowrap text-muted hover:text-ink lg:bg-transparent lg:px-2 lg:py-1">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-4">
        {SECTIONS.map((s) => (
          <Card key={s.id} className="scroll-mt-24 p-4 sm:p-5" id={s.id}>
            <h2 className="font-display text-lg font-semibold text-ink">{s.title}</h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-ink">{s.body}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

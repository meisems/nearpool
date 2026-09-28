# nearpool user guide

nearpool is a non-custodial interface for adding liquidity to Ref Finance
(now **Rhea**) pools on NEAR mainnet. Paste a token, pick or create its pool,
and add liquidity in one wallet approval, with both tokens or with NEAR only.
nearpool never holds your funds: every action is a transaction you sign in
your own wallet.

The same content is on the site at `/docs`.

---

## 1. Quick start

1. **Connect a wallet.** Click **Connect** (top right). Wallet extensions
   installed in your browser are listed first under **Detected**.
2. **Find the token.** On the home page, paste the token's contract address
   (for example `npaid-831d2b.nearpaid.near`), a nearblocks or Rhea link, or
   a pool ID such as `#8728`. Click the result.
3. **Pick a pool.** The token page lists its Ref pools as chips (for example
   `NEAR #8728`). No pool yet? The page offers **Create pool**.
4. **Add liquidity.** Use **Two tokens** if you hold both, or **NEAR only**
   if you only have NEAR. Enter an amount, check the details, and click
   **Add liquidity**, then approve once in your wallet.
5. **Check your position.** The token page shows your share of the pool.
   Click the pool number (`#8728 ↗`) to open it on Rhea.

---

## 2. Connect a wallet

1. Click **Connect**.
2. Choose a wallet:
   - **Detected**: extensions found in this browser (Sender, Meteor, HOT,
     Nightly, OKX, Coin98, Math, WELLDONE, Ctrl/XDEFI, Narwallets, Bitget).
   - **More wallets**: work without an extension. **Web** (MyNearWallet,
     Meteor, Intear), **App** (HOT, HERE, Nightly), **QR code**
     (WalletConnect: scan with a phone wallet).
   - **Extensions** (desktop only): wallets you don't have yet, with an
     **Install** link.
3. Approve the connection in the wallet.

Notes:
- On phones, only wallets that work on phones are listed; browser extensions
  don't exist there.
- Your last wallet is marked **Last used**.
- Connecting or disconnecting in one browser tab updates your other
  nearpool tabs automatically.
- To disconnect, click your account name (top right) → **Disconnect**.

---

## 3. Find a token

The home page search accepts:

| You paste | Example |
| --- | --- |
| Token contract address | `usdt.tether-token.near`, `npaid-831d2b.nearpaid.near` |
| 64-character implicit address | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (USDC) |
| Pool ID | `8728` or `#8728` |
| nearblocks link | `https://nearblocks.io/token/usdt.tether-token.near` |
| Rhea / Ref pool link | `https://app.rhea.finance/pool/8728` |
| Rhea / Ref swap link | `https://app.ref.finance/#near\|usdt.tether-token.near` |

Nothing opens automatically: click the result card (or press Enter).

---

## 4. Add liquidity with two tokens

Use this when you hold both tokens of the pool.

1. Open the token page and select a pool chip.
2. In **Add liquidity**, keep the **Two tokens** tab.
3. Type an amount on either side. The other side is filled in from the
   pool's current ratio. **Max** uses everything you can spend.
4. Optional: open **settings** (sliders icon):
   - **Max slippage**: 0.1%, 0.5% (default) or 1%. If the price moves more
     than this before your transaction lands, nothing is added.
   - **Use Ref balance**: spend tokens already sitting in your Ref account
     first (on by default).
   - **Wrap NEAR if needed**: turn NEAR into wNEAR for the NEAR side (on by
     default).
5. Open **Pool share** to see your LP shares, the minimum amounts and every
   step of the batch.
6. Click **Add liquidity** (or **Create position** for an empty pool) and
   approve once in your wallet.

What runs, in order (only the steps you need):
1. **Storage**: register you on Ref and on the tokens; register tokens that
   Ref hasn't whitelisted in your Ref account.
2. **Wrap**: NEAR → wNEAR.
3. **Deposit**: send each token into your Ref account.
4. **Add**: `add_liquidity` on the pool.
5. **nearpool fee**: 0.1 NEAR transfer, last.

**Empty pool:** your two amounts set the starting price. Type both sides
yourself; nothing is filled in.

---

## 5. Add liquidity with NEAR only

Use this when you don't hold the token. nearpool buys it for you with part
of your NEAR, then adds both sides. One approval.

1. Open the token page and select a pool chip.
2. Switch to **NEAR only**.
3. Enter a NEAR amount.
4. Check the details:
   - **Buys**: how much of the token you get, for how much NEAR, and where
     (Ref pool numbers such as `#1 → #2`, or **Rhea 1% pool**).
   - **Adds**: what goes into the pool.
   - **LP shares** and **Transactions**.
5. Click **Add with NEAR** (or **Create position with NEAR** for an empty
   pool) and approve once.

How the NEAR is split: nearpool calculates how much NEAR to spend on the
token so both sides match the pool's price after the purchase, including
how the purchase itself moves prices. For an **empty pool**, half the NEAR
buys the token at its market price, so the pool starts at that price.

Where the token is bought:
- **Ref pools** (direct, or two pools in a row such as NEAR → USDC → token).
  The purchase and the deposit run in **one transaction**: if the price
  moves past your slippage limit, nothing is added and your NEAR stays in
  your Ref balance.
- **Rhea concentrated-liquidity pools** (`dclv2.ref-labs.near`), used when
  the token doesn't trade in Ref pools, for example coins from the NearPaid
  launchpad. The token is bought into your wallet, then both sides are
  deposited and added. If the purchase misses its slippage limit, the
  later steps fail and your wNEAR stays in your Ref balance.

Leftovers: the token side uses the purchase's minimum amount, so a small
remainder (about your slippage setting) is normal. It stays in your Ref
balance (Ref routes) or your wallet (Rhea route). nearpool uses Ref balances
first next time.

**"TOKEN can't be bought yet"** means no Ref or Rhea pool holds any of the
token. Someone who holds it (usually its creator) must make the first
deposit with **Two tokens**; after that, NEAR only works.

---

## 6. Create a pool

1. Open the token page. If the token has no pool, **Create pool** shows
   automatically; otherwise click **+ New pool** next to the pool chips.
2. Choose the paired token (NEAR by default).
3. Choose the swap fee: **0.05%**, **0.2%**, **0.3%** (default) or **1%**.
   Traders pay it; it goes to the pool's liquidity providers.
4. Click **Create pool** and approve.
   - 0.1 NEAR storage deposit to Ref (the unused part is refunded).
   - 0.1 NEAR nearpool fee.
5. The new pool opens. Add the first liquidity:
   - with **Two tokens** if you hold both (your amounts set the price), or
   - with **NEAR only** if the token already trades somewhere (Ref or Rhea).

New pools don't appear in Rhea's pool list or search, which hide small
pools and unlisted tokens. Open them by link: `https://app.rhea.finance/pool/<id>`.

---

## 7. Swap

1. Open **Swap** (or click **Swap** on a token page).
2. Pick the tokens and type the amount you pay.
3. Check **Rate**, **Min received**, **Price impact** (Ref routes) and
   **Route**.
4. Click **Swap** and approve.

Routes: direct Ref pool, two Ref pools in a row, or a Rhea
concentrated-liquidity pool, whichever pays the most. You're registered on
the output token automatically if needed. Swapping *to* NEAR delivers
wNEAR. Fee: 0.1 NEAR per swap.

---

## 8. Track tokens

- Click **Track** (star) on a token page. **Tracked** lists them with price,
  change since you started tracking, pool depth and your position.
- Tracked tokens are saved **in this browser only**.

---

## 9. Your position and withdrawing

- LP shares live in your Ref account, not in nearpool.
- To see, manage or remove liquidity, click the pool number (`#<id> ↗`) on
  the token page. It opens `https://app.rhea.finance/pool/<id>`.
- Leftover deposits stay in your Ref account; nearpool spends them first
  next time (**Use Ref balance**), or you can withdraw them on Rhea.

---

## 9a. Lock liquidity (forever)

Locking shows traders the liquidity can't be pulled. It is **permanent**:
there is no unlock date and no way back.

1. On the token page, with a position in the pool, click **Lock
   liquidity**. Or, right after adding liquidity, click **Lock these shares
   forever**.
2. Pick how much: **25%**, **50%**, **100%** of your shares, or **Just
   added**.
3. Check what it's worth now and its share of the pool.
4. Tick **I understand this can't be undone**, click **Lock forever** and
   approve.

How it works:
- Your LP shares are transferred (Ref `mft_transfer`, token id `:<pool_id>`)
  to `0000000000000000000000000000000000000000000000000000000000000000`, the
  all-zero implicit account. Its key would have to match a public key of
  all zeros, which nobody holds, so no one can ever withdraw the shares.
- Trading fees earned by locked shares stay in the pool, locked with them.
- The pool card shows **X% locked forever**. Anyone can verify it on-chain
  with Ref `get_pool_shares` for that account.
- No nearpool fee. The first lock in a pool registers the lock account
  there (`mft_register`): 0.01 NEAR storage, unused part refunded.

Timed locks (unlock after a date) need a dedicated locker contract;
nearpool doesn't offer one yet.

---

## 10. Fees and costs

| What | Amount | Goes to |
| --- | --- | --- |
| nearpool fee | **0.1 NEAR** per swap, liquidity add or pool creation | `nearpoolpf.near`, used for **buyback-and-burn and platform development** |
| Pool swap fee | the pool's fee tier (e.g. 0.3%) | the pool's liquidity providers (and Ref) |
| Rhea pool fee | e.g. 1% on NearPaid coins | per the pool's rules |
| Token registration | about 0.00125 NEAR per token (up to 0.0125) | refundable storage |
| Ref account registration (first time) | 0.1 NEAR | stays as your Ref storage |
| Ref storage top-up | 0.01 NEAR (when needed) | your Ref storage |
| First position in a pool | 0.01 NEAR | LP storage, unused part refunded |
| Pool creation | 0.1 NEAR | pool storage, unused part refunded |
| Liquidity lock (first in a pool) | 0.01 NEAR, no nearpool fee | lock account's LP storage, unused part refunded |
| Gas | small; nearpool keeps 0.05 NEAR back | network |

The nearpool fee is a plain NEAR transfer shown in the transaction list
before you sign, sent as the last transaction of each batch. It's charged by
this website, not by a contract.

---

## 11. Troubleshooting

| Problem | What to do |
| --- | --- |
| **"TOKEN can't be bought yet"** | No pool has any of the token. The first deposit needs the token (**Two tokens**), usually from its creator. |
| **Pool not found on Rhea** | Rhea's list hides small pools. Open `https://app.rhea.finance/pool/<id>` directly. |
| **"Not enough NEAR"** | The total includes storage deposits, the 0.1 NEAR fee and a 0.05 NEAR gas reserve. Lower the amount. |
| **Slippage error** | The price moved. Try again, or raise **Max slippage** in settings. |
| **A step failed midway** | Deposits that landed stay in your Ref balance. Retry: **Use Ref balance** spends them first. |
| **My wallet isn't listed on my phone** | Extension wallets are desktop-only. Use HOT, Meteor, MyNearWallet, Intear, HERE, Nightly or WalletConnect. |
| **Only one side fills in** | That's the pool ratio. For an empty pool, type both amounts. |

---

## 12. Contracts

| Contract | Role |
| --- | --- |
| `v2.ref-finance.near` | Ref pools: deposits, swaps, `add_liquidity`, pool creation |
| `dclv2.ref-labs.near` | Rhea concentrated-liquidity pools (e.g. NearPaid coins) |
| `wrap.near` | wrapped NEAR (wNEAR) |
| `nearpoolpf.near` | nearpool fee receiver |
| `000…000` (64 zeros) | unowned account holding locked LP shares |

---

## 13. Safety

- Non-custodial: nearpool never holds your tokens or keys; your wallet
  signs every transaction.
- Read what your wallet shows before approving; the details panel lists
  every step.
- Providing liquidity carries impermanent-loss and smart-contract risk.
  Not financial advice.

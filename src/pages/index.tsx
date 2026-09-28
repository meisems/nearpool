import { useEffect, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { explorerAccountUrl, FEE_AMOUNT, FEE_ENABLED, FEE_RECEIVER_ID, NEAR_DECIMALS, refPoolUrl, REF_FINANCE_CONTRACT_ID, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { useNearWallet } from "../context/NearWalletContext";
import { useFtMetadata, usePool, useTokenPools } from "../hooks/useRefData";
import { useTokenMarket } from "../hooks/useTokenMarket";
import { useWatchlist } from "../hooks/useWatchlist";
import { isValidAccountId } from "../lib/near";
import { counterToken, displaySymbol, type RefPool } from "../lib/refFinance";
import { fmtAmount, shortAccount } from "../lib/format";
import { ActivityList } from "../components/ActivityList";
import { InjectPanel } from "../components/InjectPanel";
import { CreatePoolPanel } from "../components/CreatePoolPanel";
import { QuickTokens, TokenSearch } from "../components/TokenSearch";
import { TrackedList } from "../components/TrackedList";
import { SwapCard } from "../components/SwapCard";
import { TokenAvatar } from "../components/TokenAvatar";
import { Button, Card, CopyButton, fmtPrice, Skeleton, Stat } from "../components/ui";
import { IconArrowUpRight, IconExternal, IconPlus, IconStar, IconStarFill, IconSwap } from "../components/icons";

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}

/* ================================================================ home */

export function HomePage() {
  return (
    <div>
      <section className="mx-auto max-w-2xl pt-4 sm:pt-12">
        <h1 className="text-center font-display text-[34px] leading-tight font-semibold tracking-tight text-ink sm:text-5xl">
          Add liquidity to any <span className="text-accent">NEAR</span> token
        </h1>
        <div className="mt-8">
          <TokenSearch autoFocus />
        </div>
        <div className="mt-4 flex justify-center">
          <QuickTokens />
        </div>
      </section>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Tracked" action={<Link to="/track" className="text-sm text-muted hover:text-ink">View all</Link>} />
          <div className="mt-2">
            <TrackedList limit={5} empty={<p className="py-6 text-center text-sm text-faint">Star a token to track it here</p>} />
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Recent" />
          <div className="mt-2">
            <ActivityList />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ================================================================ token */

function PoolChip({ pool, tokenId, active, onClick }: { pool: RefPool; tokenId: string; active: boolean; onClick: () => void }) {
  const counterId = counterToken(pool, tokenId);
  const meta = useFtMetadata(counterId);
  return (
    <button
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-xl border pr-3 pl-1.5 text-sm transition ${
        active ? "border-accent bg-accentsoft text-ink" : "border-line bg-card text-muted hover:text-ink"
      }`}
    >
      <TokenAvatar tokenId={counterId} size={22} />
      <span className="font-medium">{displaySymbol(counterId, meta.data)}</span>
      <span className="text-xs text-faint">#{pool.id}</span>
    </button>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="mx-auto max-w-xl p-6 text-center">
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

export function TokenPage() {
  const { tokenId: raw = "" } = useParams();
  const tokenId = raw.trim().toLowerCase();
  const valid = isValidAccountId(tokenId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { accountId } = useNearWallet();
  const watch = useWatchlist();
  const { setPool } = watch;

  const meta = useFtMetadata(valid ? tokenId : null);
  const pools = useTokenPools(valid && meta.data ? tokenId : null);
  const poolParam = params.get("pool");
  const requestedPool = poolParam !== null && /^\d{1,9}$/.test(poolParam) ? Number(poolParam) : null;
  const poolId = requestedPool ?? pools.data?.[0]?.id ?? null;
  const m = useTokenMarket(tokenId, poolId);
  const tracked = watch.isTracked(tokenId);
  const symbol = displaySymbol(tokenId, meta.data);
  const poolHoldsToken = !!m.pool && m.pool.tokenIds.includes(tokenId) && m.pool.tokenIds.length === 2;

  useEffect(() => {
    document.title = meta.data ? `${symbol} · nearpool` : "Token · nearpool";
  }, [meta.data, symbol]);

  // Keep a tracked token pointed at the pool the user is looking at.
  useEffect(() => {
    if (tracked && poolId !== null && m.price > 0) setPool(tokenId, poolId, m.price);
  }, [tracked, poolId, m.price, tokenId, setPool]);

  if (!valid) {
    return (
      <Notice title="That's not a NEAR address">
        <TokenSearch size="md" />
      </Notice>
    );
  }
  if (tokenId === WRAP_NEAR_CONTRACT_ID) return <Navigate to="/" replace />;
  if (meta.isError) {
    return (
      <Notice title="Couldn't read this token">
        <p className="mb-4 font-mono text-sm break-all text-muted">{tokenId}</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => void meta.refetch()}>Retry</Button>
          <Button variant="ghost" onClick={() => navigate("/")}>Back</Button>
        </div>
      </Notice>
    );
  }

  const toggleTrack = () => {
    if (tracked) watch.untrack(tokenId);
    else if (poolId !== null) watch.track({ tokenId, poolId, priceAtAdd: m.price });
  };

  const noPools = pools.isSuccess && pools.data.length === 0 && requestedPool === null;
  // Pool creation: shown automatically when the token has no pool, or via "New pool".
  const creating = noPools || params.get("new") === "1";
  const openPool = (id: number) => setParams({ pool: String(id) }, { replace: true });

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* identity */}
        <Card className="min-w-0 p-4 sm:p-5 lg:col-start-1 lg:row-start-1">
          <div className="flex items-start gap-3.5">
            {meta.data ? <TokenAvatar tokenId={tokenId} size={52} /> : <Skeleton className="h-[52px] w-[52px] rounded-full" />}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-semibold text-ink sm:text-2xl">{meta.data ? symbol : <Skeleton className="h-7 w-24" />}</h1>
              <div className="truncate text-sm text-muted">{meta.data?.name}</div>
              <div className="mt-1.5 flex items-center gap-0.5 text-xs text-faint">
                <span className="truncate font-mono" title={tokenId}>{shortAccount(tokenId, 36)}</span>
                <CopyButton value={tokenId} />
                <a href={explorerAccountUrl(tokenId)} target="_blank" rel="noreferrer" aria-label="View on nearblocks" title="nearblocks" className="rounded-lg p-1.5 hover:bg-card2 hover:text-ink">
                  <IconExternal size={13} />
                </a>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="md" onClick={() => navigate(`/swap?out=${encodeURIComponent(tokenId)}`)} title={`Swap for ${symbol}`}>
                <IconSwap size={15} /> <span className="hidden sm:inline">Swap</span>
              </Button>
              <Button variant="secondary" onClick={toggleTrack} disabled={!tracked && poolId === null} aria-pressed={tracked}>
                {tracked ? <IconStarFill size={15} className="text-accent" /> : <IconStar size={15} />}
                <span className="hidden sm:inline">{tracked ? "Tracked" : "Track"}</span>
              </Button>
            </div>
          </div>

          {(pools.data?.length ?? 0) > 0 && (
            <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {pools.data!.slice(0, 8).map((p) => (
                <PoolChip key={p.id} pool={p} tokenId={tokenId} active={!creating && p.id === poolId} onClick={() => openPool(p.id)} />
              ))}
              <button
                onClick={() => setParams(poolId !== null ? { pool: String(poolId), new: "1" } : { new: "1" }, { replace: true })}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-dashed px-3 text-sm transition ${
                  creating ? "border-accent text-ink" : "border-line text-muted hover:text-ink"
                }`}
              >
                <IconPlus size={13} /> New pool
              </button>
            </div>
          )}
        </Card>

      {/* action */}
      <div className="min-w-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        {creating ? (
          <CreatePoolPanel
            tokenId={tokenId}
            onCreated={openPool}
            onCancel={noPools ? undefined : () => setParams(poolId !== null ? { pool: String(poolId) } : {}, { replace: true })}
          />
        ) : m.pool && poolHoldsToken ? (
          <InjectPanel pool={m.pool} tokenId={tokenId} tracked={tracked} onTrack={toggleTrack} />
        ) : !noPools ? (
          <Card className="p-5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-4 h-[74px] w-full rounded-xl" />
            <Skeleton className="mt-2 h-[74px] w-full rounded-xl" />
            <Skeleton className="mt-4 h-12 w-full rounded-xl" />
          </Card>
        ) : null}
      </div>
        {/* market + position */}
        {noPools ? (
          <Card className="min-w-0 p-6 text-center lg:col-start-1 lg:row-start-2">
            <p className="text-ink">No pool for {symbol} yet</p>
            <p className="mt-1 text-sm text-muted">Create one, then add the first liquidity.</p>
          </Card>
        ) : (
          <Card className="min-w-0 p-4 sm:p-5 lg:col-start-1 lg:row-start-2">
            {m.loading || pools.isLoading ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <div key={i}><Skeleton className="h-3 w-14" /><Skeleton className="mt-2 h-6 w-20" /></div>)}
              </div>
            ) : m.pool && poolHoldsToken ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                {m.pool.sharesTotalSupply === 0n ? (
                  <>
                    <Stat label="Price" value="Not set" sub="set by the first deposit" />
                    <Stat label="Liquidity" value="Empty" sub="no deposits yet" />
                  </>
                ) : (
                  <>
                    <Stat label="Price" value={`${fmtPrice(m.price)} ${m.counterSymbol}`} sub={`per ${symbol}`} />
                    <Stat label="Liquidity" value={`${fmtAmount(m.counterReserve, m.counterDecimals)} ${m.counterSymbol}`} sub={`${fmtAmount(m.tokenReserve, m.decimals)} ${symbol}`} />
                  </>
                )}
                <Stat
                  label="Pool"
                  value={
                    <a href={refPoolUrl(m.pool.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                      #{m.pool.id} <IconArrowUpRight size={13} />
                    </a>
                  }
                  sub={`${(m.pool.totalFeeBps / 100).toFixed(2)}% fee`}
                />
                <Stat
                  label="Your position"
                  value={!accountId ? "—" : m.shares > 0n ? `${(m.shareBps / 100).toFixed(2)}%` : "None"}
                  sub={m.shares > 0n ? `${fmtAmount(m.positionToken, m.decimals)} ${symbol} + ${fmtAmount(m.positionCounter, m.counterDecimals)} ${m.counterSymbol}` : undefined}
                />
              </div>
            ) : (
              <p className="py-2 text-center text-sm text-muted">{m.error || m.pool ? `Pool #${poolId} doesn't hold ${symbol}` : "Pool unavailable"}</p>
            )}
          </Card>
        )}

        <Card className="min-w-0 p-4 sm:p-5 lg:col-start-1 lg:row-start-3">
          <SectionHeader title="Recent" />
          <div className="mt-2">
            <ActivityList tokenId={tokenId} limit={8} />
          </div>
        </Card>

    </div>
  );
}

/** `/pool/:id` — open the pool on its non-NEAR token's page. */
export function PoolRedirect() {
  const { poolId: raw = "" } = useParams();
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const pool = usePool(id);
  if (id === null) return <Navigate to="/" replace />;
  if (pool.data) {
    if (pool.data.tokenIds.length !== 2) return <Notice title={`Pool #${id} has ${pool.data.tokenIds.length} tokens — only pairs are supported`} />;
    const lead = pool.data.tokenIds.find((t) => t !== WRAP_NEAR_CONTRACT_ID) ?? pool.data.tokenIds[0];
    return <Navigate to={`/t/${lead}?pool=${id}`} replace />;
  }
  if (pool.isError) return <Notice title={`Pool #${id} not found`}><TokenSearch size="md" /></Notice>;
  return <Notice title={`Opening pool #${id}…`} />;
}

/* ================================================================ tracked */

export function TrackPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-3xl font-semibold text-ink">Tracked</h1>
      <TokenSearch size="md" />
      <Card className="p-4 sm:p-5">
        <TrackedList
          detailed
          empty={
            <div className="py-8 text-center">
              <p className="text-sm text-faint">Nothing tracked yet</p>
              <div className="mt-4 flex justify-center"><QuickTokens /></div>
            </div>
          }
        />
      </Card>
    </div>
  );
}

/* ================================================================ swap */

export function SwapPage() {
  const [params] = useSearchParams();
  const out = params.get("out");
  return (
    <div className="mx-auto max-w-[460px]">
      <SwapCard initialOut={out && isValidAccountId(out.toLowerCase()) ? out.toLowerCase() : undefined} />
    </div>
  );
}

/* ================================================================ legal (docs: ./docs.tsx) */

type InfoKind = "terms" | "privacy";

const INFO: Record<InfoKind, { title: string; sections: Array<[string, ReactNode]> }> = {
  terms: {
    title: "Terms",
    sections: [
      ["Software only", <p key="s">nearpool is an interface to Ref Finance and token contracts on NEAR. It never holds your funds and can't reverse transactions.</p>],
      ["Fees", <p key="fee">{FEE_ENABLED ? `A ${fmtAmount(FEE_AMOUNT, NEAR_DECIMALS)} NEAR interface fee is added to each swap, injection and pool creation and shown before you sign. All fees go to ${FEE_RECEIVER_ID} and fund buyback-and-burn and platform development. Ref Finance pool fees apply separately.` : "nearpool charges no interface fee. Ref Finance pool fees apply."}</p>],
      ["Your responsibility", <p key="r">You choose the tokens, amounts and transactions you sign. Liquidity carries impermanent-loss and smart-contract risk. Not financial advice.</p>],
      ["Availability", <p key="a">Prices, balances and third-party services (RPC, wallets, explorers) can change or fail without notice.</p>],
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      ["What's read", <p key="w">Your public account ID and balances, from public NEAR RPC. No keys, no seed phrases.</p>],
      ["What's stored", <p key="s">Theme, wallet session and tracked tokens — in your browser. Confirmed injections appear in the public activity feed by account ID and transaction hash.</p>],
    ],
  },
};

export function InfoPage({ kind }: { kind: InfoKind }) {
  const page = INFO[kind];
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold text-ink">{page.title}</h1>
      <Card className="mt-5 divide-y divide-linesoft">
        {page.sections.map(([heading, body]) => (
          <section key={heading} className="p-4 sm:p-5">
            <h2 className="font-semibold text-ink">{heading}</h2>
            <div className="mt-1.5 text-sm leading-relaxed text-muted [&_code]:font-mono [&_code]:text-ink">{body}</div>
          </section>
        ))}
      </Card>
    </div>
  );
}

export { DocsPage } from "./docs";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useNearWallet } from "../context/NearWalletContext";
import { useQuery } from "@tanstack/react-query";
import { REF_QUERY_ROOT, useAccountSnapshot, useDclPools, useFtMetadata, usePlatformFee, useSwapRoutes } from "../hooks/useRefData";
import { bestDclQuote } from "../lib/dcl";
import { useRefSwap } from "../hooks/useRefSwap";
import {
  explorerTxUrl,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_OPTIONS_BPS,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { bestRoute, displaySymbol, PlanError, planDclSwap, planSwap, quoteRoute, spotQuoteRoute } from "../lib/refFinance";
import { fmtAmount, parseUnits, rawToInput, shortHash } from "../lib/format";
import { applySlippage, maxBig } from "../utils/zapMath";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelectModal } from "./TokenSelectModal";
import { Button, Card, IconButton } from "./ui";
import { IconArrowDown, IconChevronDown, IconExternal, IconSettings } from "./icons";

const STORAGE_HEADROOM = 50_000_000_000_000_000_000_000n; // 0.05 NEAR for registrations
const DEFAULT_OUT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function TokenButton({ tokenId, onClick }: { tokenId: string; onClick: () => void }) {
  const meta = useFtMetadata(tokenId);
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-2 rounded-full bg-card py-1 pr-2.5 pl-1 text-sm font-semibold text-ink transition hover:bg-line">
      <TokenAvatar tokenId={tokenId} size={22} />
      {tokenId === WRAP_NEAR_CONTRACT_ID ? "NEAR" : displaySymbol(tokenId, meta.data)}
      <IconChevronDown size={12} className="text-faint" />
    </button>
  );
}

/** Single-hop Ref Finance swap: NEAR is wrapped on the fly; NEAR output arrives as wNEAR. */
export function SwapCard({ initialOut }: { initialOut?: string }) {
  const { accountId, signIn } = useNearWallet();
  const toast = useToast();

  const [tokenIn, setTokenIn] = useState(WRAP_NEAR_CONTRACT_ID);
  const [tokenOut, setTokenOut] = useState(initialOut && initialOut !== WRAP_NEAR_CONTRACT_ID ? initialOut : DEFAULT_OUT);
  const [picker, setPicker] = useState<"in" | "out" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (initialOut && initialOut !== WRAP_NEAR_CONTRACT_ID) {
      setTokenIn(WRAP_NEAR_CONTRACT_ID);
      setTokenOut(initialOut);
    }
  }, [initialOut]);

  const metaIn = useFtMetadata(tokenIn);
  const metaOut = useFtMetadata(tokenOut);
  const decIn = metaIn.data?.decimals ?? NEAR_DECIMALS;
  const decOut = metaOut.data?.decimals ?? NEAR_DECIMALS;
  const symIn = displaySymbol(tokenIn, metaIn.data);
  const symOut = tokenOut === WRAP_NEAR_CONTRACT_ID ? "wNEAR" : displaySymbol(tokenOut, metaOut.data);

  const routes = useSwapRoutes(tokenIn, tokenOut);
  const snapshot = useAccountSnapshot([tokenIn, tokenOut]);
  const swap = useRefSwap();
  const feeQ = usePlatformFee();
  const fee = feeQ.data ?? null;

  const amountIn = useMemo(() => (metaIn.data ? parseUnits(amountInput, decIn) ?? 0n : 0n), [amountInput, decIn, metaIn.data]);
  // Best route for the typed amount (or for 1 unit, to show a rate before typing).
  const unit = 10n ** BigInt(decIn);
  const probeIn = amountIn > 0n ? amountIn : unit;
  const best = useMemo(() => bestRoute(routes.data ?? [], probeIn), [routes.data, probeIn]);
  // Rhea DCL pools for the pair (launchpad coins such as NearPaid's trade only there).
  const dclPoolsQ = useDclPools(tokenIn, tokenOut);
  const dclPools = useMemo(() => dclPoolsQ.data ?? [], [dclPoolsQ.data]);
  const dclQ = useQuery({
    queryKey: [REF_QUERY_ROOT, "dcl-quote", tokenIn, tokenOut, probeIn.toString(), dclPools.map((p) => p.id)],
    queryFn: () => bestDclQuote(dclPools, tokenIn, tokenOut, probeIn),
    enabled: dclPools.length > 0,
    staleTime: 10_000,
    retry: 1,
  });
  // Use the DCL pool when it pays more than the best Ref route (or Ref has none).
  const dcl = dclQ.data && dclQ.data.out > (best?.out ?? 0n) ? dclQ.data : null;
  const route = dcl ? null : (best?.route ?? null);
  const ready = !!route || !!dcl;
  const expectedOut = amountIn > 0n ? (dcl ? dcl.out : route ? best!.out : 0n) : 0n;
  const minOut = expectedOut > 0n ? applySlippage(expectedOut, slipBps) : 0n;
  const spotOut = route && amountIn > 0n ? spotQuoteRoute(route, amountIn) : 0n;
  const impactBps = spotOut > expectedOut && spotOut > 0n ? Number(((spotOut - expectedOut) * 10_000n) / spotOut) : 0;
  const unitOut = dcl ? (dcl.out * unit) / probeIn : route ? quoteRoute(route, unit) : 0n;
  const middleId = route && route.path.length === 3 ? route.path[1] : null;
  const middleMeta = useFtMetadata(middleId);

  const inState = snapshot.data?.tokens[tokenIn];
  const native = snapshot.data?.native.available ?? 0n;
  const spendable = inState
    ? inState.walletBalance + (tokenIn === WRAP_NEAR_CONTRACT_ID ? maxBig(native - NEAR_GAS_RESERVE - STORAGE_HEADROOM - (fee?.amount ?? 0n), 0n) : 0n)
    : 0n;

  const planError = useMemo(() => {
    if (!snapshot.data || !ready || amountIn <= 0n) return null;
    try {
      if (dcl) {
        planDclSwap(snapshot.data, { tokenIn, tokenOut, poolId: dcl.pool.id, poolFee: dcl.pool.fee, amountIn, expectedOut, slippageBps: slipBps, payWithNative: true, fee });
      } else if (route) {
        planSwap(snapshot.data, { pools: route.pools, path: route.path, amountIn, slippageBps: slipBps, payWithNative: true, fee });
      }
      return null;
    } catch (e) {
      return e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e);
    }
  }, [snapshot.data, ready, dcl, route, tokenIn, tokenOut, expectedOut, amountIn, slipBps, fee]);

  useEffect(() => {
    if (swap.phase === "success") setAmountInput("");
    if (swap.phase === "error" && swap.error) toast(swap.error, "warn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.phase]);

  const blocker = routes.isLoading || dclPoolsQ.isLoading || (dclPools.length > 0 && dclQ.isLoading)
    ? "Finding route…"
    : routes.isError && !dcl
      ? "Couldn't load pools"
      : !ready
      ? "No route for this pair"
      : amountIn <= 0n
        ? "Enter an amount"
        : !snapshot.data || feeQ.isLoading
          ? "Checking balances…"
          : amountIn > spendable
            ? `Not enough ${symIn}`
            : expectedOut <= 0n
              ? "Not enough liquidity"
              : planError;

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountInput("");
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold text-ink">Swap</h1>
        <div className="relative">
          <IconButton label="Settings" onClick={() => setSettingsOpen((v) => !v)} className={settingsOpen ? "bg-card2 text-ink" : ""}>
            <IconSettings size={17} />
          </IconButton>
          <AnimatePresence>
            {settingsOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line bg-card p-3.5 shadow-(--shadow-pop)"
              >
                <div className="text-xs text-muted">Max slippage</div>
                <div className="mt-1.5 grid grid-cols-3 gap-1">
                  {SLIPPAGE_OPTIONS_BPS.map((b) => (
                    <button
                      key={b}
                      onClick={() => setSlipBps(b)}
                      className={`h-8 rounded-lg text-xs font-semibold ${slipBps === b ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted hover:text-ink"}`}
                    >
                      {b / 100}%
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-card2 px-3.5 py-3 ring-1 ring-transparent focus-within:ring-accent/50">
        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amountInput}
            aria-label={`${symIn} amount`}
            onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.]/g, ""))}
            className="w-full min-w-0 bg-transparent font-display text-2xl font-semibold text-ink outline-none placeholder:text-faint"
          />
          <TokenButton tokenId={tokenIn} onClick={() => setPicker("in")} />
        </div>
        {accountId && (
          <div className="mt-1.5 flex items-center justify-between text-xs text-faint tabular">
            <span>Balance {inState ? fmtAmount(spendable, decIn) : "…"}</span>
            <button
              onClick={() => setAmountInput(spendable > 0n ? rawToInput(spendable, decIn, 6) : "")}
              disabled={!inState}
              className="font-semibold text-accent hover:underline disabled:opacity-40"
            >
              Max
            </button>
          </div>
        )}
      </div>

      <div className="relative z-10 -my-3 flex justify-center">
        <button
          onClick={flip}
          aria-label="Flip direction"
          className="flex h-8 w-8 items-center justify-center rounded-lg border-4 border-card bg-card2 text-muted transition hover:text-ink"
        >
          <IconArrowDown size={13} />
        </button>
      </div>

      <div className="rounded-xl bg-card2 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className={`w-full min-w-0 truncate font-display text-2xl font-semibold tabular ${expectedOut > 0n ? "text-ink" : "text-faint"}`}>
            {expectedOut > 0n ? fmtAmount(expectedOut, decOut) : "0"}
          </div>
          <TokenButton tokenId={tokenOut} onClick={() => setPicker("out")} />
        </div>
      </div>

      {ready && (
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex justify-between"><dt className="text-muted">Rate</dt><dd className="text-ink tabular">1 {symIn} = {unitOut > 0n ? fmtAmount(unitOut, decOut) : "—"} {symOut}</dd></div>
          {expectedOut > 0n && (
            <>
              <div className="flex justify-between"><dt className="text-muted">Min received</dt><dd className="text-ink tabular">{fmtAmount(minOut, decOut)} {symOut}</dd></div>
              {route && <div className="flex justify-between"><dt className="text-muted">Price impact</dt><dd className={`tabular ${impactBps > 300 ? "text-danger" : "text-ink"}`}>{(impactBps / 100).toFixed(2)}%</dd></div>}
            </>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Route</dt>
            <dd className="truncate text-right text-ink tabular">
              {middleId ? `${symIn} → ${displaySymbol(middleId, middleMeta.data)} → ${symOut}` : `${symIn} → ${symOut}`}
              <span className="text-faint"> · {dcl ? `Rhea ${dcl.pool.fee / 10_000}% pool` : route!.pools.map((p) => `#${p.id}`).join(", ")}</span>
            </dd>
          </div>
          {fee && <div className="flex justify-between"><dt className="text-muted">Fee</dt><dd className="text-ink tabular">{fmtAmount(fee.amount, NEAR_DECIMALS)} NEAR</dd></div>}
        </dl>
      )}

      {swap.phase === "success" && swap.receipt && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-accentsoft px-3 py-2 text-xs text-accentstrong">
          <span>Swapped · ≥{fmtAmount(swap.receipt.minAmountOut, decOut)} {symOut}</span>
          <span className="flex items-center gap-3">
            {swap.receipt.txHash && (
              <a href={explorerTxUrl(swap.receipt.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                {shortHash(swap.receipt.txHash)} <IconExternal size={10} />
              </a>
            )}
            {tokenOut !== WRAP_NEAR_CONTRACT_ID && (
              <Link to={`/t/${tokenOut}`} className="font-semibold hover:underline">Add liquidity →</Link>
            )}
          </span>
        </div>
      )}

      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={!!accountId && (swap.busy || !!blocker)}
        loading={swap.busy}
        onClick={accountId ? () => ready && void swap.run({
          pools: route?.pools ?? [],
          path: route?.path ?? [tokenIn, tokenOut],
          amountIn,
          slippageBps: slipBps,
          payWithNative: true,
          dcl: dcl ? { poolId: dcl.pool.id, fee: dcl.pool.fee } : undefined,
        }) : signIn}
      >
        {!accountId ? "Connect wallet" : swap.busy ? (swap.phase === "checking-storage" ? "Checking…" : "Confirm in wallet") : blocker ?? "Swap"}
      </Button>

      <TokenSelectModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        excludeTokenId={picker === "in" ? tokenOut : tokenIn}
        onSelect={(id) => {
          if (picker === "in") setTokenIn(id);
          else setTokenOut(id);
          setAmountInput("");
        }}
      />
    </Card>
  );
}

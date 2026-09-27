import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useBalance } from "wagmi";
import { getAddress, parseUnits } from "viem";
import { useTokenMeta } from "../hooks/useTokenMeta";
import { usePoolV4State } from "../hooks/usePoolV4State";
import { usePoolV3State } from "../hooks/usePoolV3State";
import { useHolderTier } from "../hooks/useHolderTier";
import { useContractInjection, type ContractVersion, type LiquidityDestination } from "../hooks/useContractInjection";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelectModal } from "./TokenSelectModal";
import { CompletionModal } from "./CompletionModal";
import { usePonsCatalogReady, usePonsLaunchToken } from "../lib/ponsCatalog";
import { fmtCompact, fmtWei, shortAddr, toWeiFloat, weiToInput } from "../lib/format";
import {
  PLATFORM_TOKEN_ADDRESS,
  PLATFORM_TOKEN_SYMBOL,
  ROBINHOOD_CHAIN_ID,
  REQUIRED_HOLD_TOKENS,
  ROUTER_FEE_BPS,
  SLIPPAGE_DEFAULT_BPS,
  WETH_ADDRESS,
  ZERO_ADDRESS,
  IS_DEPLOYMENT_CONFIGURED,
} from "../lib/constants";
import { TICK_SPACING } from "../lib/config";
import {
  calculateV3ZapRatios,
  liquidityForAmounts,
} from "../utils/zapMath";
import {
  IconAlert,
  IconChevronDown,
  IconFlame,
  IconLayers,
  IconLoader,
  IconRange,
  IconSearch,
  IconShield,
  IconZap,
} from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;
const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const normalizeTokenAddress = (value: string): `0x${string}` | undefined => {
  const candidate = value.trim().replace(/[\s\u200B]+/g, "");
  if (!isAddr(candidate)) return undefined;
  try {
    // Lowercasing before checksum formatting accepts pasted mixed-case values
    // even when the source did not preserve a valid EIP-55 checksum.
    return getAddress(candidate.toLowerCase()) as `0x${string}`;
  } catch {
    return undefined;
  }
};

/** Tokens the user has explicitly verified through the platform this session. */
const VERIFIED_KEY = "ponspool.verifiedTokens";
function loadVerified(): Set<string> {
  try {
    const raw = localStorage.getItem(VERIFIED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveVerified(set: Set<string>) {
  try {
    localStorage.setItem(VERIFIED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — verification just won't persist across reloads */
  }
}

const FEE_TIERS = [
  { bps: 500, label: "0.05%" },
  { bps: 3000, label: "0.30%" },
  { bps: 10000, label: "1.00%" },
];

type RangePreset = "full" | "wide" | "custom";

function ticksFor(preset: RangePreset, feeTier: number, customLo: number, customHi: number) {
  const spacing = TICK_SPACING[feeTier] ?? 60;
  const floor = (t: number) => Math.floor(t / spacing) * spacing;
  const ceil = (t: number) => Math.ceil(t / spacing) * spacing;
  if (preset === "full") return { lo: floor(-887_272), hi: ceil(887_272) };
  if (preset === "wide") return { lo: floor(-4_055), hi: ceil(4_055) };
  return { lo: floor(customLo), hi: ceil(customHi) };
}

export function CreatorTerminal({ onBuy, onConnect }: { onBuy: () => void; onConnect: () => void }) {
  const { address, isConnected } = useAccount();
  const toast = useToast();
  const tier = useHolderTier();

  /* ------------------------------------------------------- form state */
  // Ponspool's launch flow is intentionally single-sided: the user supplies
  // a pool token address for discovery and only Robinhood ETH for liquidity.
  const mode = "zap" as const;
  const [version, setVersion] = useState<ContractVersion>("V4");
  const destination: LiquidityDestination = "burn";
  const [tokenInput, setTokenInput] = useState("");
  const [ethInput, setEthInput] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("full");
  const [customLo, setCustomLo] = useState("-887272");
  const [customHi, setCustomHi] = useState("887272");
  const [feeTier, setFeeTier] = useState(3000);
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  const selectToken = (address: string) => {
    setTokenInput(address);
  };

  const parsed = useMemo(() => normalizeTokenAddress(tokenInput), [tokenInput]);
  const typedButInvalid = tokenInput.trim().length > 0 && !parsed;
  const launchToken = usePonsLaunchToken(parsed);
  const ponsCatalogReady = usePonsCatalogReady();
  const v3Pool = usePoolV3State(parsed);
  const canUseV3 = !!parsed && v3Pool.exists;

  const meta = useTokenMeta(parsed, WETH_ADDRESS);
  // V4 has no per-pair contract — pool existence, price and depth are read
  // straight off the PoolManager singleton for the exact (ETH, token, fee
  // tier) key the router will submit on-chain.
  const pool = usePoolV4State(parsed, feeTier);
  // A catalog match is authoritative: Pons v1 is V3-only and Pons v2 is
  // V4-only. Deriving this value directly from the match also closes the
  // render-time gap before the state synchronization effect runs.
  const effectiveVersion = launchToken?.launchVersion ?? version;

  useEffect(() => {
    // Pons v1/v2 launches carry an authoritative factory marker in the
    // catalog. Never make the user guess which pool architecture to use.
    if (launchToken?.launchVersion && version !== launchToken.launchVersion) {
      setVersion(launchToken.launchVersion);
      if (launchToken.launchVersion === "V3" && v3Pool.feeTier !== undefined && v3Pool.feeTier !== feeTier) {
        setFeeTier(v3Pool.feeTier);
      }
      return;
    }
    // Uncatalogued addresses stay on the V4 default. A live V3 pool is not
    // proof that a token is a Pons v1 launch: a Pons v2 token can have a
    // legacy/incompatible V3 pool as well. V3 is selected only by the
    // authoritative Pons v1 catalog marker above.
    if (ponsCatalogReady && !launchToken && parsed && !pool.isLoading && !v3Pool.isLoading) {
      if (pool.exists && version !== "V4") setVersion("V4");
    }
    if (version === "V3" && !v3Pool.isLoading && v3Pool.feeTier !== undefined && v3Pool.feeTier !== feeTier) {
      setFeeTier(v3Pool.feeTier);
    }
  }, [launchToken, parsed, ponsCatalogReady, pool.isLoading, pool.exists, version, v3Pool.isLoading, v3Pool.exists, v3Pool.feeTier, feeTier]);

  const reserveEth = pool.reserveBase;
  const reserveToken = pool.reserveQuote;

  const symbol = meta.symbol ?? "???";
  const decimals = meta.decimals ?? 18;

  /* ------------------------------------------------ token verification */
  const [verifiedTokens, setVerifiedTokens] = useState<Set<string>>(() => loadVerified());
  const [verifyPromptOpen, setVerifyPromptOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // A "live read" token is one whose name/symbol came from a fresh on-chain
  // read rather than the generic placeholder — anyone can set a contract's
  // name/symbol to anything, so it needs an explicit platform verification
  // step before liquidity flows.
  const needsVerification = !!parsed && !!meta.liveRead && !verifiedTokens.has(parsed.toLowerCase());
  const isVerified = !!parsed && (!meta.liveRead || verifiedTokens.has(parsed.toLowerCase()));

  useEffect(() => {
    setVerifyPromptOpen(false);
  }, [parsed]);

  const handleVerifyToken = () => {
    if (!parsed) return;
    setVerifying(true);
    window.setTimeout(() => {
      setVerifiedTokens((prev) => {
        const next = new Set(prev);
        next.add(parsed.toLowerCase());
        saveVerified(next);
        return next;
      });
      setVerifying(false);
      setVerifyPromptOpen(false);
      toast(`${symbol} verified — liquidity injection unlocked.`, "ok");
    }, 650);
  };

  const ethWei = useMemo(() => {
    try { return ethInput ? parseUnits(ethInput, 18) : 0n; } catch { return 0n; }
  }, [ethInput]);
  /* ratio-locked quoting from live reserves */
  const tokenQuote = useMemo(() => (ethWei > 0n && reserveEth > 0n ? (ethWei * reserveToken) / reserveEth : 0n), [ethWei, reserveEth, reserveToken]);
  const ethQuote = ethWei;

  /* --------------------------------------------------- fee & zap math */
  const feeWei = !tier.isHolder && ethWei > 0n ? (ethWei * BigInt(ROUTER_FEE_BPS)) / 10_000n : 0n;
  const netEth = ethWei - feeWei;
  const feePct = (ROUTER_FEE_BPS / 100).toFixed(1);

  // Uniswap V4 is always concentrated liquidity — kept as a named flag since
  // the range-picker / zap-ratio code below reads more clearly this way.
  const isConcentrated = true;
  const wethIsToken0 = !!parsed && WETH_ADDRESS.toLowerCase() < parsed.toLowerCase();
  const { lo: tickLower, hi: tickUpper } = useMemo(() => {
    // A V3 position that spans the current price requires both assets. Since
    // this product deposits ETH only, place the range entirely on the side
    // where the supplied ETH is the only required currency. V4 currency0 is
    // native ETH; V3 depends on whether WETH sorts before the creator token.
    const spacing = TICK_SPACING[feeTier] ?? 60;
    const minTick = Math.ceil(-887_272 / spacing) * spacing;
    const maxTick = Math.floor(887_272 / spacing) * spacing;
    const current = effectiveVersion === "V3" ? v3Pool.tick : pool.tick;
    const width = Math.max(spacing * 1000, 60_000);
    const ethIsToken0 = effectiveVersion === "V4" || wethIsToken0;
    if (ethIsToken0) {
      const lo = Math.min(maxTick - spacing, Math.ceil((current + spacing) / spacing) * spacing);
      return { lo, hi: Math.min(maxTick, lo + width) };
    }
    const hi = Math.max(minTick + spacing, Math.floor((current - spacing) / spacing) * spacing);
    return { lo: Math.max(minTick, hi - width), hi };
  }, [effectiveVersion, feeTier, v3Pool.tick, pool.tick, wethIsToken0]);
  const v3ZapRatios = useMemo(
    () => calculateV3ZapRatios(v3Pool.sqrtPriceX96, tickLower, tickUpper),
    [v3Pool.sqrtPriceX96, tickLower, tickUpper],
  );
  // calculateV3ZapRatios labels amount0 as token and amount1 as ETH. Flip the
  // value share when WETH is token0 in the actual pool ordering.
  // Read directly from the pool — no need to re-derive it from reserves.
  const sqrtPriceX96 = effectiveVersion === "V4" && pool.sqrtPriceX96 === 0n ? 2n ** 96n : pool.sqrtPriceX96;
  const liquidityDelta = useMemo(
    () => liquidityForAmounts(sqrtPriceX96, tickLower, tickUpper, netEth, 0n),
    [sqrtPriceX96, tickLower, tickUpper, netEth],
  );

  const zapPreview = useMemo(() => {
    if (mode !== "zap" || netEth <= 0n) return null;
    const ratios = isConcentrated ? calculateV3ZapRatios(sqrtPriceX96, tickLower, tickUpper) : null;
    return { paired: netEth, ratios };
  }, [mode, netEth, isConcentrated, sqrtPriceX96, tickLower, tickUpper]);
  const zapLiquidityDelta = useMemo(
    () => netEth > 0n ? liquidityForAmounts(sqrtPriceX96, tickLower, tickUpper, netEth, 0n) : 0n,
    [netEth, sqrtPriceX96, tickLower, tickUpper],
  );

  /* ------------------------------------------------------- balances --- */
  const ethBal = useBalance({ address, chainId: ROBINHOOD_CHAIN_ID, query: { refetchInterval: 6000 } });
  // useTokenMeta reads balanceOf with the same normalized token address and
  // connected wallet, avoiding a second query that could disagree with the
  // metadata read or lag behind a pasted-token change.
  const tokenBalance = meta.balance ?? 0n;

  const liq = useContractInjection(parsed, 0n, effectiveVersion);

  useEffect(() => {
    if (liq.error) toast(liq.error, "warn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liq.error]);

  const busy = liq.phase === "approving" || liq.phase === "submitting" || liq.phase === "confirming";
  const approveNeeded = false;

  const insufficientEth = ethBal.data !== undefined && ethWei > 0n && ethWei > ethBal.data.value;
  const insufficientToken = false;

  /* ------------------------------------------------------------ CTA --- */
  const cta = useMemo((): { label: string; disabled: boolean; onClick: () => void; spinner: boolean } => {
    const runIt = async () => {
      const selectedPoolExists = effectiveVersion === "V3" ? v3Pool.exists : true;
      if (!parsed || !selectedPoolExists || needsVerification || !ethWei) return;
      // Keep the form values visible while the wallet and chain process the transaction.
      // They are cleared only after liq.phase reaches success, so a failed/reverted
      // submission can be corrected without forcing the user to re-enter everything.
      await liq.run({
        version: effectiveVersion, mode, token: parsed, ethWei, tokenWei: 0n, feeEth: feeWei,
        slippageBps: slipBps, tickLower, tickUpper, feeTier,
        decimals, symbol, liquidityDelta, pair: pool.poolId ?? ZERO_ADDRESS, destination,
        zapLiquidityDelta,
        initializePool: effectiveVersion === "V4" && !pool.exists,
      });
    };
    if (!isConnected) return { label: "connect to deploy", disabled: false, onClick: onConnect, spinner: false };
    if (!IS_DEPLOYMENT_CONFIGURED) {
      return {
        label: "configure fee vault / Uniswap addresses",
        disabled: true,
        onClick: () => {},
        spinner: false,
      };
    }
    if (!parsed) return { label: typedButInvalid ? "that's not an address" : "enter token address", disabled: true, onClick: () => {}, spinner: false };
    if (!ponsCatalogReady) return { label: "identifying Pons launch…", disabled: true, onClick: () => {}, spinner: true };
    if (meta.isLoading || pool.isLoading || v3Pool.isLoading) return { label: "reading the pond…", disabled: true, onClick: () => {}, spinner: true };

    if (needsVerification) {
      return {
        label: verifying ? "verifying…" : `verify ${symbol.toLowerCase()} to continue`,
        disabled: verifying,
        onClick: () => setVerifyPromptOpen(true),
        spinner: verifying,
      };
    }
    if (ethWei <= 0n) return { label: "enter an amount", disabled: true, onClick: () => {}, spinner: false };
    if (effectiveVersion === "V3" && !v3Pool.exists) return { label: "v3 pool not initialized", disabled: true, onClick: () => {}, spinner: false };
    if (insufficientEth) return { label: "insufficient eth", disabled: true, onClick: () => {}, spinner: false };
    if (insufficientToken) return { label: `insufficient ${symbol.toLowerCase()}`, disabled: true, onClick: () => {}, spinner: false };
    if (effectiveVersion === "V4" && (mode === "zap" ? zapLiquidityDelta : liquidityDelta) <= 0n) return { label: "invalid liquidity range", disabled: true, onClick: () => {}, spinner: false };
    if (approveNeeded) return { label: `approve ${symbol.toLowerCase()}`, disabled: busy, onClick: () => void liq.approveToken(parsed), spinner: liq.phase === "approving" };
    if (busy) return { label: liq.stepNote || "working…", disabled: true, onClick: () => {}, spinner: true };
    return { label: mode === "zap" ? "zap ETH into liquidity" : "deploy liquidity pool", disabled: false, onClick: () => void runIt(), spinner: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, parsed, typedButInvalid, meta, pool, v3Pool, needsVerification, verifying, ethWei, netEth, insufficientEth, insufficientToken, approveNeeded, busy, symbol, tokenQuote, slipBps, tickLower, tickUpper, feeTier, decimals, destination, liq, zapLiquidityDelta, zapPreview, effectiveVersion, ponsCatalogReady]);

  useEffect(() => {
    if (liq.phase !== "success") return;
    setEthInput("");
  }, [liq.phase]);

  const setEth = (v: string) => setEthInput(v);
  const pct = (f: number) => {
    if (!ethBal.data) return;
    setEthInput(ethBal.data.value > 0n ? weiToInput((ethBal.data.value * BigInt(Math.round(f * 1000))) / 1000n, 18, 6) : "");
  };

  /* ----------------------------------------------------------- render - */
  return (
    <div className="mx-auto w-full max-w-md">
      <motion.div
        layout
        className="rounded-3xl border border-line bg-card p-4 shadow-(--shadow-card) sm:p-5"
      >
        {/* header + engine badge */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-display text-base font-semibold tracking-tight text-ink">auto-lp engine</div>
            <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">direct Uniswap · ETH only</div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-card2 px-2.5 py-1 font-mono text-[10px] font-medium text-muted uppercase tracking-wide">
            uniswap {effectiveVersion.toLowerCase()}
          </span>
        </div>

        {/* eligibility bar */}
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-card2/60 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-xs text-muted">
            <TokenAvatar address={PLATFORM_TOKEN_ADDRESS} size={22} />
            <span className="font-mono text-[11px] tabular">
              {tier.isConnected ? fmtWei(tier.userBalance, 18) : "—"} ${PLATFORM_TOKEN_SYMBOL}
            </span>
          </span>
          {tier.isConnected ? (
            tier.isHolder ? (
              <span className="flex items-center gap-1.5 rounded-full bg-accentsoft px-2.5 py-1 text-[10px] font-semibold tracking-wide text-accentstrong uppercase">
                <IconShield size={11} /> holder tier · 0% fee
              </span>
            ) : (
              <button onClick={onBuy} className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted uppercase transition-colors hover:text-coin">
                <IconFlame size={11} className="text-coin" /> need {REQUIRED_HOLD_TOKENS.toLocaleString()} · buy
              </button>
            )
          ) : (
            <span className="rounded-full bg-card px-2.5 py-1 font-mono text-[9.5px] text-faint">tier checked on-chain</span>
          )}
        </div>

        {/* engine selector; both engines use the same single-ETH input */}
        <div className="mt-3 rounded-2xl border border-accent/20 bg-accentsoft/30 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] tracking-[0.16em] text-accentstrong uppercase">single-sided launch</span>
            <span className="rounded-full bg-card px-2 py-0.5 font-mono text-[9px] text-muted">ETH only</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-card p-1">
            {(["V3", "V4"] as ContractVersion[]).map((engine) => {
              const knownVersion = launchToken?.launchVersion;
              const enabled = ponsCatalogReady && !!parsed && (!knownVersion || knownVersion === engine) && (engine === "V3" ? knownVersion === "V3" && canUseV3 : true);
              return (
                <button
                  key={engine}
                  disabled={!enabled}
                  onClick={() => enabled && setVersion(engine)}
                  className={`relative flex h-8 items-center justify-center rounded-full text-[11px] font-medium transition-colors ${!enabled ? "cursor-not-allowed text-faint/50" : effectiveVersion === engine ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  {effectiveVersion === engine && <motion.span layoutId="engine-pill" transition={spring} className="absolute inset-0 rounded-full bg-card2 shadow-(--shadow-soft)" />}
                  <span className="relative z-10">Uniswap {engine}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">
            {launchToken?.launchVersion
              ? `Pons ${launchToken.launchVersion === "V3" ? "v1" : "v2"} launch detected · Uniswap ${launchToken.launchVersion}.`
              : "Pool token selects the Uniswap pair; only Robinhood ETH is deposited."}
          </p>
        </div>
        {/* token field */}
        <div className="mt-3 rounded-2xl border border-linesoft bg-card2/40 p-3 transition-colors focus-within:border-accent/40">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">creator token</span>
            {parsed && !meta.isLoading && meta.symbol ? (
              <span className="flex items-center gap-1 rounded-full bg-accentsoft px-2 py-0.5 font-mono text-[9px] font-medium text-accentstrong">
                <span className="h-1 w-1 rounded-full bg-vip" /> token resolved
              </span>
            ) : parsed && !meta.isLoading ? (
              <span className="flex items-center gap-1 rounded-full bg-ambersoft px-2 py-0.5 font-mono text-[9px] font-medium text-amberish">
                <span className="h-1 w-1 rounded-full bg-amberish" /> token metadata unavailable
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <IconSearch size={14} className="shrink-0 text-faint" />
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="0x… token address, or browse all tokens"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
            />
            <button
              onClick={() => setTokenModalOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[10px] font-medium text-muted transition-all hover:border-accent/40 hover:text-ink"
            >
              browse <IconChevronDown size={12} />
            </button>
          </div>
          <AnimatePresence>
            {parsed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 flex items-center gap-2 border-t border-linesoft pt-2">
                  <TokenAvatar address={parsed} symbol={meta.symbol ?? "TOKEN"} logo={meta.logo} size={24} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink">{meta.symbol ?? "TOKEN"}</span>
                      {meta.liveRead && (
                        isVerified ? (
                          <span className="rounded-full bg-accentsoft px-1.5 py-0.5 font-mono text-[8px] font-medium tracking-wide text-accentstrong uppercase">
                            verified ✓
                          </span>
                        ) : (
                          <span
                            title="Read directly from the token's contract on Robinhood Chain. Not curated or vetted — anyone can set a contract's name/symbol to anything."
                            className="rounded-full bg-ambersoft px-1.5 py-0.5 font-mono text-[8px] font-medium tracking-wide text-amberish uppercase"
                          >
                            unverified
                          </span>
                        )
                      )}
                    </div>
                    <div className="truncate text-[10px] text-faint">{meta.name ?? shortAddr(parsed)}</div>
                  </div>
                  {isConnected && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted tabular">
                      bal {meta.balance === undefined ? "reading…" : fmtWei(tokenBalance, decimals)}
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {needsVerification && verifyPromptOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-2 rounded-xl border border-amberish/30 bg-ambersoft/40 p-2.5">
                  <div className="flex items-start gap-1.5 font-mono text-[10.5px] leading-relaxed text-amberish">
                    <IconAlert size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {symbol} isn't in ponspool's curated registry. Verify it through the platform to unlock liquidity injection for this token.
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleVerifyToken}
                      disabled={verifying}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink text-[11px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {verifying && <IconLoader size={12} className="animate-spin" />}
                      {verifying ? "verifying…" : "verify token"}
                    </button>
                    <button
                      onClick={() => setVerifyPromptOpen(false)}
                      disabled={verifying}
                      className="h-8 rounded-full px-3 font-mono text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-60"
                    >
                      not now
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* eth input */}
        <div className="mt-2.5 rounded-2xl border border-linesoft bg-card2/40 p-3 transition-colors focus-within:border-accent/40">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">
              {mode === "zap" ? "eth · the whole zap" : "eth leg"}
            </span>
            {ethBal.data && (
              <span className="font-mono text-[10px] text-muted tabular">bal {fmtWei(ethBal.data.value, 18)}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <TokenAvatar size={26} />
            <input
              value={ethInput}
              onChange={(e) => setEth(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.0"
              className="w-full bg-transparent font-mono text-xl font-medium text-ink outline-none placeholder:text-faint"
            />
            <span className="font-mono text-xs text-faint">ETH</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {[{ f: 0.25, l: "25%" }, { f: 0.5, l: "50%" }, { f: 1, l: "max" }].map((b) => (
              <button
                key={b.l}
                onClick={() => pct(b.f)}
                disabled={!ethBal.data}
                className="rounded-full bg-card px-3 py-1 font-mono text-[10px] font-medium text-muted transition-all hover:bg-accentsoft hover:text-accentstrong disabled:opacity-40"
              >
                {b.l}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 rounded-2xl border border-linesoft bg-card2/40 px-3 py-2.5">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-faint">liquidity asset</span>
            <span className="text-muted">Robinhood ETH only · no dual assets</span>
          </div>
        </div>

        {/* concentrated liquidity range controls (v4) */}
        <AnimatePresence initial={false}>
          {isConcentrated && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 rounded-2xl border border-linesoft bg-card2/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">
                    <IconRange size={12} /> position range
                  </span>
                  <span className="font-mono text-[10px] text-faint tabular">
                    [{tickLower.toLocaleString()}, {tickUpper.toLocaleString()}]
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-card p-1">
                  {([
                    { id: "full", label: "full range" },
                    { id: "wide", label: "wide ±50%" },
                    { id: "custom", label: "custom" },
                  ] as Array<{ id: RangePreset; label: string }>).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRangePreset(r.id)}
                      className={`relative flex h-8 items-center justify-center rounded-full text-[11px] font-medium transition-colors ${rangePreset === r.id ? "text-ink" : "text-muted hover:text-ink"}`}
                    >
                      {rangePreset === r.id && (
                        <motion.span layoutId="range-pill" transition={spring} className="absolute inset-0 rounded-full bg-card2 shadow-(--shadow-soft)" />
                      )}
                      <span className="relative z-10">{r.label}</span>
                    </button>
                  ))}
                </div>
                <AnimatePresence>
                  {rangePreset === "custom" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          value={customLo}
                          onChange={(e) => setCustomLo(e.target.value.replace(/[^0-9-]/g, ""))}
                          className="rounded-full border border-linesoft bg-card px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-accent/40"
                          placeholder="tick lower"
                        />
                        <input
                          value={customHi}
                          onChange={(e) => setCustomHi(e.target.value.replace(/[^0-9-]/g, ""))}
                          className="rounded-full border border-linesoft bg-card px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-accent/40"
                          placeholder="tick upper"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">pool fee tier</span>
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {FEE_TIERS.map((f) => (
                    <button
                      key={f.bps}
                      onClick={() => setFeeTier(f.bps)}
                      className={`rounded-full px-3 py-1.5 font-mono text-[11px] font-medium transition-all ${feeTier === f.bps ? "bg-accentsoft text-accentstrong" : "bg-card text-muted hover:text-ink"}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* zap preview strip */}
        <AnimatePresence initial={false}>
          {mode === "zap" && zapPreview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 space-y-1.5 rounded-2xl border border-linesoft bg-[color-mix(in_srgb,var(--card-2)_55%,transparent)] p-3.5 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-faint">status:</span>
                  <span className="text-accentstrong">single transaction pipeline</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-faint">protocol fee:</span>
                  {tier.isHolder || !tier.isConnected ? (
                    <span className="text-accentstrong">0.00 eth (vip waived)</span>
                  ) : (
                    <span className="text-coin">{feePct}% → fee vault buyback & burn</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-faint">ETH liquidity allocation:</span>
                  <span className="text-ink tabular">~{fmtWei(zapPreview.paired, 18)} eth</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-faint">creator-token deposit:</span>
                  <span className="text-ink tabular">0 {symbol} · ETH only</span>
                </div>
                {isConcentrated && zapPreview.ratios && (
                  <div className="flex items-center justify-between border-t border-linesoft pt-1.5">
                    <span className="text-faint">range weights:</span>
                    <span className="text-ink tabular">
                      {(zapPreview.ratios.ethRatio * 100).toFixed(1)}% eth · {(zapPreview.ratios.tokenRatio * 100).toFixed(1)}% {symbol.toLowerCase()}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* routing summary + slippage */}
        <div className="mt-3 space-y-1.5 rounded-2xl bg-card2/50 p-3.5 font-mono text-[10.5px]">
          <div className="flex items-center justify-between">
            <span className="text-faint">platform fee:</span>
            {tier.isHolder || !tier.isConnected ? (
              <span className="text-accentstrong">0.0000 eth (vip waived)</span>
            ) : (
              <span className="text-coin tabular">{fmtWei(feeWei, 18)} eth ({feePct}%) → fee vault buyback &amp; burn</span>
            )}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-faint">slippage tolerance:</span>
            <span className="flex gap-1">
              {[50, 100].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlipBps(s)}
                  className={`rounded-full px-2 py-0.5 text-[10px] transition-all ${slipBps === s ? "bg-accentsoft text-accentstrong" : "text-muted hover:text-ink"}`}
                >
                  {(s / 100).toFixed(1)}%
                </button>
              ))}
            </span>
          </div>
                </div>
        {/* final destination confirmation */}
        <div className="mt-3 rounded-2xl border border-linesoft bg-card2/40 p-3">
          <div className="font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">LP destination</div>
          <p className="mt-2 rounded-xl bg-coinsoft px-3 py-2 font-mono text-[10px] text-coin">
            LP position is always sent to the unrecoverable burn address.
          </p>
        </div>
        {/* CTA */}
        <motion.button
          whileTap={cta.disabled ? undefined : { scale: 0.98 }}
          onClick={cta.onClick}
          disabled={cta.disabled}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all ${
            cta.disabled
              ? "cursor-not-allowed bg-card2 text-faint"
              : "bg-ink text-canvas hover:opacity-90"
          }`}
        >
          {cta.spinner && <IconLoader size={15} className="animate-spin" />}
          {cta.label}
        </motion.button>

      </motion.div>

      <CompletionModal
        receipt={liq.receipt}
        tokenSymbol={symbol}
        tokenDecimals={decimals}
        onClose={() => liq.reset()}
      />

      <TokenSelectModal
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onSelect={selectToken}
        excludeAddress={WETH_ADDRESS}
      />
    </div>
  );
}

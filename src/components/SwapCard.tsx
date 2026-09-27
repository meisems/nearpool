import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi, formatUnits, parseEther } from "viem";
import { config } from "../lib/wagmi";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { fmtWei, shortAddr, weiToInput } from "../lib/format";
import {
  EXPLORER_URL,
  PONSFAMILY_CURVE_ABI,
  PONSFAMILY_FACTORY_ABI,
  PONSFAMILY_FACTORY_ADDRESS,
  PONSPOOL_TOKEN_ADDRESS,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_OPTIONS_BPS,
} from "../lib/constants";
import { IconArrowDown, IconCheck, IconExternal, IconLoader, IconSettings, IconZap } from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

function getOut(amountIn: bigint, quoteReserve: bigint, tokenReserve: bigint, feeBps: bigint, creatorTaxBps: bigint, snipeTaxBps: bigint, sellable: bigint): bigint {
  if (quoteReserve <= 0n || tokenReserve <= 0n || amountIn <= 0n) return 0n;
  const net = amountIn - (amountIn * (feeBps + creatorTaxBps + snipeTaxBps)) / 10_000n;
  if (net <= 0n) return 0n;
  const quoted = (net * tokenReserve) / (quoteReserve + net);
  return sellable > 0n ? (quoted > sellable ? sellable : quoted) : quoted;
}

function getSellOut(amountIn: bigint, quoteReserve: bigint, tokenReserve: bigint, feeBps: bigint, creatorTaxBps: bigint): bigint {
  if (quoteReserve <= 0n || tokenReserve <= 0n || amountIn <= 0n) return 0n;
  const gross = (amountIn * quoteReserve) / (tokenReserve + amountIn);
  const fees = (gross * (feeBps + creatorTaxBps)) / 10_000n;
  return gross > fees ? gross - fees : 0n;
}

export function SwapCard({ onConnect }: { onConnect: () => void }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const qc = useQueryClient();
  const toast = useToast();

  const balance = useBalance({ address, query: { refetchInterval: 6000 } });
  const tokenBalance = useReadContract({ address: PONSPOOL_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 6000 } });
  const launch = useReadContract({ address: PONSFAMILY_FACTORY_ADDRESS, abi: PONSFAMILY_FACTORY_ABI, functionName: "getLaunchedToken", args: [PONSPOOL_TOKEN_ADDRESS], query: { enabled: PONSPOOL_TOKEN_ADDRESS !== "0x0000000000000000000000000000000000000000", refetchInterval: 12_000 } });
  const curve = launch.data?.curve;
  const reserves = useReadContract({ address: curve, abi: PONSFAMILY_CURVE_ABI, functionName: "getReserves", query: { enabled: !!curve, refetchInterval: 6_000 } });
  const sellable = useReadContract({ address: curve, abi: PONSFAMILY_CURVE_ABI, functionName: "sellableTokens", query: { enabled: !!curve, refetchInterval: 6_000 } });
  const feeBps = useReadContract({ address: curve, abi: PONSFAMILY_CURVE_ABI, functionName: "feeBps", query: { enabled: !!curve, refetchInterval: 30_000 } });
  const creatorTaxBps = useReadContract({ address: curve, abi: PONSFAMILY_CURVE_ABI, functionName: "creatorTaxBps", query: { enabled: !!curve, refetchInterval: 30_000 } });
  const snipeTaxBps = useReadContract({ address: curve, abi: PONSFAMILY_CURVE_ABI, functionName: "currentSnipeTaxBps", args: address ? [address] : undefined, query: { enabled: !!curve && !!address, refetchInterval: 6_000 } });
  const allowance = useReadContract({ address: PONSPOOL_TOKEN_ADDRESS, abi: erc20Abi, functionName: "allowance", args: address && curve ? [address, curve] : undefined, query: { enabled: !!address && !!curve, refetchInterval: 6_000 } });

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amountInput, setAmountInput] = useState("");
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [customSlip, setCustomSlip] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [stepNote, setStepNote] = useState("");
  const [receipt, setReceipt] = useState<{ out: bigint; hash: string } | null>(null);
  const amountRef = useRef(0n);

  const amountWei = useMemo(() => {
    try {
      return amountInput ? parseEther(amountInput) : 0n;
    } catch {
      return 0n;
    }
  }, [amountInput]);
  amountRef.current = amountWei;

  const outWei = useMemo(
    () => mode === "buy"
      ? getOut(amountWei, reserves.data?.[0] ?? 0n, reserves.data?.[1] ?? 0n, feeBps.data ?? 0n, creatorTaxBps.data ?? 0n, snipeTaxBps.data ?? 0n, sellable.data ?? 0n)
      : getSellOut(amountWei, reserves.data?.[0] ?? 0n, reserves.data?.[1] ?? 0n, feeBps.data ?? 0n, creatorTaxBps.data ?? 0n),
    [mode, amountWei, reserves.data, feeBps.data, creatorTaxBps.data, snipeTaxBps.data, sellable.data],
  );
  const minOut = (outWei * BigInt(10_000 - slipBps)) / 10_000n;

  const priceOneEth = useMemo(
    () => getOut(parseEther("1"), reserves.data?.[0] ?? 0n, reserves.data?.[1] ?? 0n, feeBps.data ?? 0n, creatorTaxBps.data ?? 0n, snipeTaxBps.data ?? 0n, sellable.data ?? 0n),
    [reserves.data, feeBps.data, creatorTaxBps.data, snipeTaxBps.data, sellable.data],
  );

  const activeSlip = customSlip ? Math.max(1, Math.min(5000, Math.round(parseFloat(customSlip) * 100) || 0)) : slipBps;

  const ethBal = balance.data?.value ?? 0n;
  const ponsBal = tokenBalance.data ?? 0n;

  const disabledReason = !isConnected
    ? null
    : buying
      ? null
        : !launch.data?.exists || !curve
          ? "the PonsFamily launch is unavailable…"
          : launch.data.phase !== 0
            ? "the PonsFamily curve is closed…"
          : amountWei <= 0n
          ? "enter an amount"
          : mode === "buy" && amountWei > ethBal
            ? "not enough eth. the pond is thirsty."
            : mode === "sell" && amountWei > ponsBal
              ? "not enough $ponspool in your wallet"
            : outWei <= 0n
              ? "the launch has no buyable depth yet"
              : null;

  async function swap() {
    if (!address || disabledReason || !isConnected) return;
    setBuying(true);
    setReceipt(null);
    setStepNote("fetching quote…");
    try {
      const out = mode === "buy"
        ? getOut(amountRef.current, reserves.data?.[0] ?? 0n, reserves.data?.[1] ?? 0n, feeBps.data ?? 0n, creatorTaxBps.data ?? 0n, snipeTaxBps.data ?? 0n, sellable.data ?? 0n)
        : getSellOut(amountRef.current, reserves.data?.[0] ?? 0n, reserves.data?.[1] ?? 0n, feeBps.data ?? 0n, creatorTaxBps.data ?? 0n);
      const min = (out * BigInt(10_000 - activeSlip)) / 10_000n;
      let hash: `0x${string}`;
      if (mode === "sell") {
        if ((allowance.data ?? 0n) < amountRef.current) {
          setStepNote("approve $ponspool…");
          const approvalHash = await writeContractAsync({ address: PONSPOOL_TOKEN_ADDRESS, abi: erc20Abi, functionName: "approve", args: [curve!, amountRef.current] });
          await waitForTransactionReceipt(config, { hash: approvalHash });
          await qc.invalidateQueries({ queryKey: ["readContract"] });
        }
        setStepNote("signing sell…");
        hash = await writeContractAsync({ address: curve!, abi: PONSFAMILY_CURVE_ABI, functionName: "sell", args: [amountRef.current, min, address] });
      } else {
        setStepNote("signing buy…");
        hash = await writeContractAsync({ address: curve!, abi: PONSFAMILY_CURVE_ABI, functionName: "buy", args: [amountRef.current, min, address], value: amountRef.current });
      }
      setStepNote("swap sealing on-chain…");
      await waitForTransactionReceipt(config, { hash });
      await qc.invalidateQueries({ queryKey: ["readContract"] });
      await qc.invalidateQueries({ queryKey: ["balance"] });
      setReceipt({ out, hash });
      setAmountInput("");
      toast(mode === "buy" ? `+${fmtWei(out, 18)} $ponspool. the pond thanks you.` : `${fmtWei(out, 18)} ETH received. the pond thanks you.`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(/user rejected|denied/i.test(msg) ? "swap rejected. no harm done." : "the router said no. try a smaller bite.", "warn");
    } finally {
      setBuying(false);
      setStepNote("");
    }
  }

  const setPct = (pct: number) => {
    const reserve = pct === 100 ? (ethBal * 98n) / 100n : (ethBal * BigInt(pct)) / 100n;
    setAmountInput(reserve > 0n ? weiToInput(reserve, 18, 6) : "");
  };

  return (
    <div className="mx-auto w-full max-w-[440px]">
      <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-(--shadow-card)">
        {/* header */}
        <div className="flex items-center justify-between border-b border-linesoft px-5 py-4">
          <div>
            <div className="font-display text-[17px] font-semibold tracking-tight text-ink">{mode === "buy" ? "buy" : "sell"} $ponspool</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wide text-faint">PonsFamily curve · {mode === "buy" ? "eth → $ponspool" : "$ponspool → eth"}</div>
          </div>
          <div className="relative">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="slippage settings"
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-all hover:border-accent/40 hover:text-ink ${settingsOpen ? "border-accent/40 text-ink" : ""}`}
            >
              <IconSettings size={16} />
            </button>
            <AnimatePresence>
              {settingsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={spring}
                  className="absolute right-0 z-30 mt-2 w-[230px] rounded-2xl border border-line bg-card p-3.5 shadow-(--shadow-pop)"
                >
                  <div className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">slippage tolerance</div>
                  <div className="mt-2 flex gap-1.5">
                    {SLIPPAGE_OPTIONS_BPS.map((b) => (
                      <button
                        key={b}
                        onClick={() => { setSlipBps(b); setCustomSlip(""); }}
                        className={`h-9 flex-1 rounded-full border text-xs font-semibold transition-all ${
                          !customSlip && slipBps === b ? "border-accent bg-accentsoft text-accentstrong" : "border-line text-muted hover:border-accent/40"
                        }`}
                      >
                        {(b / 100).toFixed(1)}%
                      </button>
                    ))}
                    <div className="relative h-9 flex-1">
                      <input
                        inputMode="decimal"
                        placeholder="custom"
                        value={customSlip}
                        onChange={(e) => setCustomSlip(e.target.value.replace(/[^\d.]/g, ""))}
                        className={`h-9 w-full rounded-full border bg-transparent px-3 pr-6 text-xs font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint ${
                          customSlip ? "border-accent" : "border-line"
                        }`}
                      />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-faint">%</span>
                    </div>
                  </div>
                  <div className="mt-2 font-mono text-[9.5px] text-faint">
                    min received guards the swap. {(activeSlip / 100).toFixed(2)}% today.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 rounded-full border border-line bg-card2/50 p-1">
            {(["buy", "sell"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => { setMode(tab); setAmountInput(""); setReceipt(null); }} className={`h-9 rounded-full text-xs font-semibold transition-colors ${mode === tab ? "bg-coin text-canvas" : "text-muted hover:text-ink"}`}>
                {tab} $PONSPOOL
              </button>
            ))}
          </div>
          {/* eth in */}
          <div className="rounded-2xl border border-linesoft bg-card2/50 p-3.5 transition-colors focus-within:border-accent/40">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>you pay</span>
              <span className="font-mono tabular">
                bal {isConnected ? fmtWei(mode === "buy" ? ethBal : ponsBal, 18) : "—"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent font-display text-[26px] font-semibold tracking-tight text-ink outline-none placeholder:text-faint/60"
              />
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-card py-1.5 pr-3.5 pl-1.5">
                <TokenAvatar address={mode === "buy" ? undefined : PONSPOOL_TOKEN_ADDRESS} size={24} />
                <span className="text-sm font-semibold text-ink">{mode === "buy" ? "ETH" : "$PONSPOOL"}</span>
              </div>
            </div>
            {isConnected && mode === "buy" && (
              <div className="mt-2 flex gap-1.5">
                {[25, 50, 100].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPct(p)}
                    className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-muted transition-all hover:border-accent/50 hover:text-accent"
                  >
                    {p === 100 ? "max" : `${p}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* connector node */}
          <div className="relative z-10 -my-2.5 flex justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent shadow-(--shadow-soft)">
              <IconArrowDown size={15} />
            </span>
          </div>

          {/* pons out */}
          <div className="rounded-2xl border border-linesoft bg-card2/50 p-3.5">
            <div className="flex items-center justify-between text-[11px] text-muted">
                <span>you receive · est.</span>
                <span className="font-mono tabular">curve {curve ? "live" : "loading"}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="min-w-0 flex-1 font-display text-[26px] font-semibold tracking-tight text-ink tabular">
                {reserves.isLoading ? "…" : outWei > 0n ? fmtWei(outWei, 18) : "0.0"}
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-coin/40 bg-coinsoft/60 py-1.5 pr-3.5 pl-1.5">
                <TokenAvatar address={PONSPOOL_TOKEN_ADDRESS} size={24} />
                <span className="text-sm font-semibold text-ink">{mode === "buy" ? "$PONSPOOL" : "ETH"}</span>
              </div>
            </div>
          </div>

          {/* quote lines */}
          <div className="mt-3 space-y-1.5 px-1 font-mono text-[10.5px] text-muted">
            <div className="flex justify-between">
              <span>rate</span>
              <span className="text-ink tabular">{mode === "buy" ? `1 ETH ≈ ${priceOneEth > 0n ? fmtWei(priceOneEth, 18) : "—"} $PONSPOOL` : "curve quote"}</span>
            </div>
            <div className="flex justify-between">
              <span>min received · {(activeSlip / 100).toFixed(2)}%</span>
              <span className="text-ink tabular">{outWei > 0n ? fmtWei(minOut, 18) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>route</span>
              <span className="text-ink">PonsFamily · curve</span>
            </div>
          </div>

          {/* last swap receipt */}
          <AnimatePresence>
            {receipt && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-accentsoft/70 px-3.5 py-3">
                  <span className="flex items-center gap-2 text-xs font-semibold text-accentstrong">
                    <IconCheck size={14} /> {mode === "buy" ? "+" : ""}{fmtWei(receipt.out, 18)} {mode === "buy" ? "$PONSPOOL" : "ETH"}
                  </span>
                  <a
                    href={`${EXPLORER_URL}/tx/${receipt.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[10.5px] text-accentstrong underline-offset-2 hover:underline"
                  >
                    tx {shortAddr(receipt.hash)} <IconExternal size={11} />
                  </a>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* action */}
          <motion.button
            whileTap={disabledReason || buying ? undefined : { scale: 0.98 }}
            onClick={isConnected ? swap : onConnect}
            disabled={!!disabledReason && isConnected}
            className={`mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-all ${
              disabledReason && isConnected
                ? "cursor-not-allowed bg-card2 text-faint"
                : "bg-coin text-canvas shadow-(--shadow-soft) hover:opacity-90 dark:text-[#241a06]"
            }`}
          >
            {buying ? (
              <>
                <IconLoader size={17} className="animate-spin" /> {stepNote}
              </>
            ) : !isConnected ? (
              <>
                <IconZap size={16} /> connect to {mode}
              </>
            ) : (
              <>{mode} $ponspool</>
            )}
          </motion.button>
          {disabledReason && isConnected && (
            <div className="mt-2 text-center font-mono text-[10.5px] text-faint">{disabledReason}</div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center font-mono text-[9.5px] text-faint">
        quotes refresh from PonsFamily curve reserves. Your wallet signs the direct on-chain buy.
      </p>
    </div>
  );
}
